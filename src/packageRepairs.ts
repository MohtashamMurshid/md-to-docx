import JSZip from "jszip";
import { Document, Packer } from "docx";
import type { IPropertiesOptions } from "docx";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Pack after registering lists that docx otherwise discovers too late in footnotes. */
export async function packDocumentWithRepairs(
  options: IPropertiesOptions,
): Promise<Blob> {
  const document = new Document(options);
  const hasFootnotes = Object.keys(options.footnotes ?? {}).length > 0;
  if (hasFootnotes)
    for (const { reference } of options.numbering?.config ?? [])
      document.Numbering.createConcreteNumberingInstance(reference, 0);
  const blob = await Packer.toBlob(document);
  if (!hasFootnotes) return blob;

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
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
  if (!changed) return blob;
  zip.file(
    "word/footnotes.xml",
    new XMLSerializer().serializeToString(footnotes),
  );
  return new Blob(
    [await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })],
    { type: blob.type },
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
