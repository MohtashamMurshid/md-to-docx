import JSZip from "jszip";
import { Document, Packer } from "docx";
import type { IPropertiesOptions } from "docx";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/**
 * Pack after registering lists that docx otherwise discovers too late in
 * footnotes, then renumber the IDs docx draws from process-wide counters.
 */
export async function packDocumentWithRepairs(
  options: IPropertiesOptions,
): Promise<Blob> {
  const document = new Document(options);
  const hasFootnotes = Object.keys(options.footnotes ?? {}).length > 0;
  if (hasFootnotes)
    for (const { reference } of options.numbering?.config ?? [])
      document.Numbering.createConcreteNumberingInstance(reference, 0);
  const blob = await Packer.toBlob(document);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  let changed = hasFootnotes && (await repairFootnoteNumbering(zip, document));
  changed = (await renumberProcessWideIds(zip)) || changed;
  changed = (await renumberHyperlinkRelationships(zip)) || changed;
  if (!changed) return blob;
  return new Blob(
    [await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })],
    { type: blob.type },
  );
}

async function repairFootnoteNumbering(
  zip: JSZip,
  document: Document,
): Promise<boolean> {
  let changed = false;
  const footnotes = new DOMParser().parseFromString(
    await zip.file("word/footnotes.xml")!.async("string"),
    "application/xml",
  );
  const numberingIds = new Map(
    document.Numbering.ConcreteNumbering.map(
      ({ reference, instance, numId }) => [
        `{${reference}-${instance}}`,
        String(numId),
      ],
    ),
  );
  for (const reference of Array.from(
    footnotes.getElementsByTagNameNS(W, "numId"),
  )) {
    const id = numberingIds.get(reference.getAttributeNS(W, "val")!);
    if (id !== undefined) {
      reference.setAttributeNS(W, "w:val", id);
      changed = true;
    }
  }
  if (changed)
    zip.file(
      "word/footnotes.xml",
      new XMLSerializer().serializeToString(footnotes),
    );
  return changed;
}

// One start tag, with quoted attribute values that may themselves contain ">".
// docx names each hyperlink relationship with a random 21-character ID.
const RANDOM_RELATIONSHIP_ID = /^rId[A-Za-z0-9_-]{21}$/;
const RELATIONSHIP_TAG = /<Relationship\b[^>]*>/g;
const HYPERLINK_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";

/** The random hyperlink relationship IDs in one `.rels` part, in part order. */
function randomHyperlinkIds(rels: string): Set<string> {
  const ids = new Set<string>();
  for (const [tag] of rels.matchAll(RELATIONSHIP_TAG)) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    if (id && tag.includes(`Type="${HYPERLINK_TYPE}"`) && RANDOM_RELATIONSHIP_ID.test(id))
      ids.add(id);
  }
  return ids;
}

/** Replaces each `attribute="old"` with its new ID; IDs are unique tokens. */
function replaceIds(xml: string, attribute: string, renamed: Map<string, string>): string {
  return xml.replace(
    new RegExp(`(\\s${attribute}=")(rId[A-Za-z0-9_-]{21})"`, "g"),
    (match, prefix: string, id: string) => {
      const next = renamed.get(id);
      return next === undefined ? match : `${prefix}${next}"`;
    },
  );
}

/**
 * Renames docx's random hyperlink relationship IDs to `rIdLink<n>`, numbered
 * in the order the part first uses them, so the same input gives the same
 * package. Relationships the template or other code wrote keep their IDs.
 */
async function renumberHyperlinkRelationships(zip: JSZip): Promise<boolean> {
  let changed = false;
  for (const relsName of Object.keys(zip.files).filter((name) =>
    /^word\/_rels\/[^/]+\.xml\.rels$/.test(name),
  )) {
    const partName = relsName.replace("_rels/", "").replace(/\.rels$/, "");
    const part = zip.file(partName);
    const rels = await zip.file(relsName)!.async("string");
    const random = randomHyperlinkIds(rels);
    if (!part || random.size === 0) continue;
    const xml = await part.async("string");
    const used = [...xml.matchAll(/\br:id="([^"]+)"/g)].map((match) => match[1]!);
    const ordered = [...new Set([...used.filter((id) => random.has(id)), ...random])];
    const taken = new Set([...rels.matchAll(/\bId="([^"]+)"/g)].map((match) => match[1]!));
    const renamed = new Map<string, string>();
    let next = 1;
    for (const id of ordered) {
      while (taken.has(`rIdLink${next}`)) next++;
      renamed.set(id, `rIdLink${next}`);
      taken.add(`rIdLink${next++}`);
    }
    zip.file(relsName, replaceIds(rels, "Id", renamed));
    zip.file(partName, replaceIds(xml, "r:id", renamed));
    changed = true;
  }
  return changed;
}

const ATTRIBUTES = String.raw`(?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*/?>`;
const BOOKMARK_TAG = new RegExp(`<w:bookmark(?:Start|End)${ATTRIBUTES}`, "g");
const DRAWING_TAG = new RegExp(
  `<(?:wp:docPr|wps:cNvPr|wpg:cNvPr)${ATTRIBUTES}`,
  "g",
);
// Connectors name the shapes they join by those shapes' drawing IDs.
const CONNECTION_TAG = new RegExp(`<a:(?:stCxn|endCxn)${ATTRIBUTES}`, "g");
const ATTRIBUTE = /(\s)([^\s=/>]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/g;
const MAIN_PART = "word/document.xml";

/**
 * docx takes bookmark and drawing IDs from counters shared by the whole
 * process, so converting the same Markdown twice gives different IDs, and
 * parts copied from a reference DOCX bring IDs of their own. Renumber both
 * from 1 across every part under word/, in document order, so output depends
 * only on the input and no two parts share an ID. Bookmark start/end pairs and
 * any drawing docx repeats within one part keep one new ID; IDs never link
 * across parts, so equal IDs in different parts get different new IDs.
 * Connector ends (`a:stCxn`, `a:endCxn`) follow their shapes. Only the ID
 * values are edited, leaving every other byte as it was.
 */
export async function renumberProcessWideIds(zip: JSZip): Promise<boolean> {
  const bookmarkIds = new Map<string, string>();
  const drawingIds = new Map<string, string>();
  const parts = Object.keys(zip.files)
    .filter((name) => /^word\/.+\.xml$/.test(name))
    .sort((a, b) =>
      a === MAIN_PART ? -1 : b === MAIN_PART ? 1 : a < b ? -1 : a > b ? 1 : 0,
    );
  let changed = false;
  for (const name of parts) {
    const source = await zip.file(name)!.async("string");
    const output = source
      .replace(BOOKMARK_TAG, (tag) =>
        renumberAttribute(tag, "w:id", { part: name, ids: bookmarkIds }),
      )
      .replace(DRAWING_TAG, (tag) =>
        renumberAttribute(tag, "id", { part: name, ids: drawingIds }),
      )
      // After every shape in the part has its new ID, wherever it appears.
      .replace(CONNECTION_TAG, (tag) =>
        renumberAttribute(tag, "id", {
          part: name,
          ids: drawingIds,
          lookupOnly: true,
        }),
      );
    if (output !== source) {
      zip.file(name, output);
      changed = true;
    }
  }
  return changed;
}

/** New IDs, keyed by part and old ID; the map's size is the last ID given out. */
interface IdScope {
  part: string;
  ids: Map<string, string>;
  /** Rewrite only IDs that already have a new one, leaving the rest as they are. */
  lookupOnly?: boolean;
}

function renumberAttribute(
  tag: string,
  attribute: string,
  { part, ids, lookupOnly = false }: IdScope,
): string {
  return tag.replace(
    ATTRIBUTE,
    (match: string, ...groups: (string | undefined)[]) => {
      const [space, key, equals, doubleQuoted, singleQuoted] = groups;
      if (key !== attribute) return match;
      const old = `${part}\u0000${doubleQuoted ?? singleQuoted ?? ""}`;
      let id = ids.get(old);
      if (id === undefined) {
        if (lookupOnly) return match;
        ids.set(old, (id = String(ids.size + 1)));
      }
      return `${space ?? ""}${key}${equals ?? ""}"${id}"`;
    },
  );
}
