import type JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";

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
