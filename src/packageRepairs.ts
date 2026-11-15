import JSZip from "jszip";
import { Document, Packer } from "docx";
import type { IPropertiesOptions } from "docx";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Note parts whose lists docx numbers before their numbering is registered. */
const NOTE_PARTS = [
  ["footnotes", "word/footnotes.xml"],
  ["endnotes", "word/endnotes.xml"],
] as const;

/**
 * Pack after registering lists that docx otherwise discovers too late in
 * footnotes and endnotes, then renumber the IDs docx draws from process-wide
 * counters or at random.
 */
export async function packDocumentWithRepairs(
  options: IPropertiesOptions,
): Promise<Blob> {
  const document = new Document(options);
  const noteParts = NOTE_PARTS.filter(
    ([key]) => Object.keys(options[key] ?? {}).length > 0,
  ).map(([, part]) => part);
  if (noteParts.length > 0)
    for (const { reference } of options.numbering?.config ?? [])
      document.Numbering.createConcreteNumberingInstance(reference, 0);
  const blob = await Packer.toBlob(document);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  let changed = false;
  for (const part of noteParts)
    changed = (await repairNoteNumbering(zip, document, part)) || changed;
  changed = (await renumberProcessWideIds(zip)) || changed;
  changed = (await renumberHyperlinkRelationships(zip)) || changed;
  changed = (await normalizeChartParts(zip)) || changed;
  changed = (await renumberWatermarkShapes(zip)) || changed;
  if (!changed) return blob;
  return new Blob(
    [await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })],
    { type: blob.type },
  );
}

async function repairNoteNumbering(
  zip: JSZip,
  document: Document,
  part: string,
): Promise<boolean> {
  let changed = false;
  const notes = new DOMParser().parseFromString(
    await zip.file(part)!.async("string"),
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
    notes.getElementsByTagNameNS(W, "numId"),
  )) {
    const id = numberingIds.get(reference.getAttributeNS(W, "val")!);
    if (id !== undefined) {
      reference.setAttributeNS(W, "w:val", id);
      changed = true;
    }
  }
  if (changed) zip.file(part, new XMLSerializer().serializeToString(notes));
  return changed;
}

// docx/watermarks names each shape with this prefix and a random suffix.
const WATERMARK_SHAPE_ID = /\bid="PowerPlusWaterMarkObject[^"]*"/g;

/**
 * Give generated watermark shapes IDs from 1, in header-part order. Word's
 * Remove Watermark command finds them by the prefix, so it stays. Only new
 * documents need this: reference and patch packages keep their own shapes.
 */
async function renumberWatermarkShapes(zip: JSZip): Promise<boolean> {
  const headers = Object.keys(zip.files)
    .filter((name) => /^word\/header\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  let next = 0;
  let changed = false;
  for (const name of headers) {
    const source = await zip.file(name)!.async("string");
    const output = source.replace(
      WATERMARK_SHAPE_ID,
      () => `id="PowerPlusWaterMarkObject${String(++next)}"`,
    );
    if (output !== source) {
      zip.file(name, output);
      changed = true;
    }
  }
  return changed;
}

// One start tag, with quoted attribute values that may themselves contain ">".
// docx names each hyperlink relationship with a random 21-character ID.
const RANDOM_RELATIONSHIP_ID = /^rId[A-Za-z0-9_-]{21}$/;
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

const CHART_PART = /^word\/charts\/(chart(\d+))\.xml$/;
const RELATIONSHIP_TAG = new RegExp(`<Relationship${ATTRIBUTES}`, "g");
/** The earliest date a ZIP entry can carry, so workbook bytes never depend on the clock. */
const FIXED_ZIP_DATE = new Date(Date.UTC(1980, 0, 1));

/**
 * docx gives each chart's relationships random IDs and zips each chart's
 * workbook with the current time, so the same chart came out different on
 * every conversion. Name each chart relationship after its chart part
 * (`rIdChart3` for `charts/chart3.xml`) and each chart's workbook
 * relationship `rIdWorkbook`, and rezip every embedded workbook with a fixed
 * date. Packages without charts are left alone.
 */
async function normalizeChartParts(zip: JSZip): Promise<boolean> {
  const charts = Object.keys(zip.files).filter((name) => CHART_PART.test(name));
  if (charts.length === 0) return false;
  const relationshipParts = Object.keys(zip.files).filter((name) =>
    /^word\/_rels\/[^/]+\.rels$/.test(name),
  );
  for (const rels of relationshipParts)
    await renameRelationships(zip, rels, (type, target) => {
      const chart = /^charts\/chart(\d+)\.xml$/.exec(target);
      return type.endsWith("/chart") && chart ? `rIdChart${chart[1]!}` : undefined;
    });
  for (const chart of charts)
    await renameRelationships(
      zip,
      chart.replace(CHART_PART, "word/charts/_rels/$1.xml.rels"),
      (type) => (type.endsWith("/package") ? "rIdWorkbook" : undefined),
    );
  for (const name of Object.keys(zip.files))
    if (/^word\/embeddings\/[^/]+\.xlsx$/.test(name))
      await rezipWithFixedDates(zip, name);
  return true;
}

/**
 * Give the relationships `newId` names new IDs in a `.rels` part, and in the
 * part that owns it (`dir/_rels/name.rels` belongs to `dir/name`).
 */
async function renameRelationships(
  zip: JSZip,
  relsPath: string,
  newId: (type: string, target: string) => string | undefined,
): Promise<void> {
  const rels = zip.file(relsPath);
  const owner = zip.file(relsPath.replace(/_rels\/([^/]+)\.rels$/, "$1"));
  if (!rels || !owner) return;
  const renamed = new Map<string, string>();
  const relsXml = (await rels.async("string")).replace(RELATIONSHIP_TAG, (tag) => {
    const id = attributeValue(tag, "Id");
    const replacement = newId(
      attributeValue(tag, "Type") ?? "",
      attributeValue(tag, "Target") ?? "",
    );
    if (id === undefined || replacement === undefined) return tag;
    renamed.set(id, replacement);
    return tag.replace(`Id="${id}"`, `Id="${replacement}"`);
  });
  if (renamed.size === 0) return;
  let ownerXml = await owner.async("string");
  for (const [id, replacement] of renamed)
    ownerXml = ownerXml.split(`r:id="${id}"`).join(`r:id="${replacement}"`);
  zip.file(relsPath, relsXml);
  zip.file(owner.name, ownerXml);
}

function attributeValue(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

async function rezipWithFixedDates(zip: JSZip, name: string): Promise<void> {
  const source = await JSZip.loadAsync(await zip.file(name)!.async("uint8array"), {
    createFolders: false,
  });
  const output = new JSZip();
  for (const entry of Object.values(source.files))
    if (!entry.dir)
      output.file(entry.name, await entry.async("uint8array"), {
        date: FIXED_ZIP_DATE,
        createFolders: false,
      });
  zip.file(
    name,
    await output.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
}
