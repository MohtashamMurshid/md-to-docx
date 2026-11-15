import JSZip from "jszip";
import { Document, Packer } from "docx";
import type { IPropertiesOptions } from "docx";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
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
  let changed = await repairFootnoteImages(zip);
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
const ATTRIBUTES = String.raw`(?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*/?>`;
const BOOKMARK_TAG = new RegExp(`<w:bookmark(?:Start|End)${ATTRIBUTES}`, "g");
const DRAWING_TAG = new RegExp(
  `<(?:wp:docPr|wps:cNvPr|wpg:cNvPr)${ATTRIBUTES}`,
  "g",
);
const ATTRIBUTE = /(\s)([^\s=/>]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/g;
const MAIN_PART = "word/document.xml";

/**
 * docx takes bookmark and drawing IDs from counters shared by the
 * whole process, so converting the same Markdown twice gives different IDs.
 * Renumber both from 1 in document order so output depends only on the input.
 * Each distinct old ID keeps one new ID, so bookmark start/end pairs (and any
 * drawing docx deliberately repeats) stay linked. Only the ID values are
 * edited, leaving every other byte docx wrote as it was.
 */
export async function renumberProcessWideIds(zip: JSZip): Promise<boolean> {
  const bookmarkIds = new Map<string, string>();
  const drawingIds = new Map<string, string>();
  const parts = Object.keys(zip.files)
    .filter((name) => /^word\/[^/]+\.xml$/.test(name))
    .sort((a, b) =>
      a === MAIN_PART ? -1 : b === MAIN_PART ? 1 : a < b ? -1 : a > b ? 1 : 0,
    );
  let changed = false;
  for (const name of parts) {
    const source = await zip.file(name)!.async("string");
    const output = source
      .replace(BOOKMARK_TAG, (tag) =>
        renumberAttribute(tag, "w:id", bookmarkIds),
      )
      .replace(DRAWING_TAG, (tag) => renumberAttribute(tag, "id", drawingIds));
    if (output !== source) {
      zip.file(name, output);
      changed = true;
    }
  }
  return changed;
}

function renumberAttribute(
  tag: string,
  attribute: string,
  ids: Map<string, string>,
): string {
  return tag.replace(
    ATTRIBUTE,
    (match, space: string, key: string, equals: string, ...values) => {
      if (key !== attribute) return match;
      const old = (values[0] ?? values[1]) as string;
      let id = ids.get(old);
      if (id === undefined) ids.set(old, (id = String(ids.size + 1)));
      return `${space}${key}${equals}"${id}"`;
    },
  );
}

/** docx leaves unresolved media tokens in footnotes; give those drawings real relationships. */
export async function repairFootnoteImages(zip: JSZip): Promise<boolean> {
  const file = zip.file("word/footnotes.xml");
  if (!file) return false;
  const source = await file.async("string");
  if (!source.includes("rId{")) return false;
  const parser = new DOMParser();
  const document = parser.parseFromString(source, "application/xml");
  const relPath = "word/_rels/footnotes.xml.rels";
  const relationships = parser.parseFromString(
    (await zip.file(relPath)?.async("string")) ??
      `<Relationships xmlns="${REL}"/>`,
    "application/xml",
  );
  const ids = new Set(
    Array.from(
      relationships.getElementsByTagNameNS(REL, "Relationship"),
      (rel) => rel.getAttribute("Id"),
    ),
  );
  const media = new Map<string, string>();
  let nextId = 1;
  let changed = false;
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    const token = element.getAttributeNS(R, "embed");
    const match = token && /^rId\{([^}]+)\}$/.exec(token);
    if (!match) continue;
    const name = match[1];
    if (!zip.file(`word/media/${name}`))
      throw new Error("Generated footnote image is missing from the package");
    if (!media.has(name)) {
      while (ids.has(`mdImage${nextId}`)) nextId++;
      const id = `mdImage${nextId++}`;
      ids.add(id);
      media.set(name, id);
      const rel = relationships.createElementNS(REL, "Relationship");
      rel.setAttribute("Id", id);
      rel.setAttribute("Type", `${R}/image`);
      rel.setAttribute("Target", `media/${name}`);
      relationships.documentElement!.appendChild(rel);
    }
    element.setAttributeNS(R, "r:embed", media.get(name)!);
    changed = true;
  }
  if (changed) {
    const serializer = new XMLSerializer();
    zip.file("word/footnotes.xml", serializer.serializeToString(document));
    zip.file(relPath, serializer.serializeToString(relationships));
  }
  return changed;
}
