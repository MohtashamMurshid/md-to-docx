import { repairFootnoteImages } from "./packageRepairs.js";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type {
  Document as XmlDocument,
  Element as XmlElement,
} from "@xmldom/xmldom";
import type { ReferenceDocxInput, PatchMarkdownOptions } from "./types.js";
import { loadReferenceDocx } from "./referenceDocx.js";
import { throwIfAborted } from "./processingLimits.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const serializer = new XMLSerializer();
const xml = (document: XmlDocument | XmlElement): string =>
  serializer.serializeToString(document);
const parse = (text: string): XmlDocument =>
  new DOMParser({
    onError: (level) => {
      if (level !== "warning") throw new Error("Malformed package XML");
    },
  }).parseFromString(text, "application/xml");
const elements = (
  root: XmlDocument | XmlElement,
  local: string,
  ns = W,
): XmlElement[] => Array.from(root.getElementsByTagNameNS(ns, local));
const empty = (root: string, ns = W): XmlDocument =>
  parse(`<w:${root} xmlns:w="${ns}" xmlns:r="${R}"/>`);
const maxId = (text: string, pattern: RegExp): number => {
  let maximum = 0;
  for (const match of text.matchAll(pattern))
    maximum = Math.max(maximum, Number(match[1]));
  return maximum;
};

export async function loadPatchPackage(
  input: ReferenceDocxInput,
  signal?: AbortSignal,
): Promise<JSZip> {
  if (
    input instanceof Uint8Array ||
    input instanceof ArrayBuffer ||
    input instanceof Blob
  )
    return (await loadReferenceDocx(input, {}, signal)).zip;
  if (typeof input === "string" || Array.isArray(input)) {
    const bytes =
      typeof input === "string"
        ? Uint8Array.from(input, (char) => char.charCodeAt(0))
        : Uint8Array.from(input);
    return (await loadReferenceDocx(bytes, {}, signal)).zip;
  }
  if (input instanceof JSZip)
    return (
      await loadReferenceDocx(
        await input.generateAsync({
          type: "uint8array",
          compression: "DEFLATE",
        }),
        {},
        signal,
      )
    ).zip;
  throw new Error("Patch reference must contain in-memory DOCX bytes");
}

/** Merge generated package dependencies before inserting already-rendered XML. */
export async function mergePatchPackage(
  base: JSZip,
  donorBytes: Uint8Array,
  markers: string[],
  names: string[],
  options: PatchMarkdownOptions,
): Promise<Uint8Array> {
  throwIfAborted(options.signal);
  const donor = await JSZip.loadAsync(donorBytes);
  await repairFootnoteImages(donor);
  const documents = new Map<string, XmlDocument>();
  for (const [name, file] of Object.entries(base.files))
    if (!file.dir && (name.endsWith(".xml") || name.endsWith(".rels")))
      documents.set(name, parse(await file.async("string")));
  const originalParagraphs = new Map(
    [...documents].map(([part, document]) => [part, elements(document, "p")]),
  );
  const baseText = [...documents.values()].map(xml).join("");
  let prefixIndex = 1;
  while (
    baseText.includes(`mdp${prefixIndex}_`) ||
    Object.keys(base.files).some((name) => name.includes(`mdp${prefixIndex}_`))
  )
    prefixIndex++;
  const prefix = `mdp${prefixIndex}_`;
  const offsets = {
    numId:
      maxId(baseText, /w:numId="(\d+)"/g) +
      maxId(baseText, /<w:numId\b[^>]*w:val="(\d+)"/g) +
      1,
    abstractNumId: maxId(baseText, /w:abstractNumId="(\d+)"/g) + 1,
    footnote: maxId(baseText, /<w:footnote\b[^>]*w:id="(\d+)"/g) + 1,
    comment: maxId(baseText, /<w:comment\b[^>]*w:id="(\d+)"/g) + 1,
  };
  const donorDocuments = new Map<string, XmlDocument>();
  const bookmarks = new Map<string, string>();
  for (const [name, file] of Object.entries(donor.files)) {
    if (file.dir || !name.endsWith(".xml")) continue;
    const document = parse(await file.async("string"));
    donorDocuments.set(name, document);
    for (const bookmark of elements(document, "bookmarkStart")) {
      const old = bookmark.getAttributeNS(W, "name")!;
      bookmarks.set(old, `${prefix}${old.slice(0, 24)}_${bookmarks.size}`);
    }
  }
  for (const document of donorDocuments.values()) {
    for (const element of Array.from(document.getElementsByTagName("*"))) {
      const local = element.localName;
      if (element.namespaceURI === W) {
        for (const attr of ["numId", "abstractNumId"] as const) {
          if (element.hasAttributeNS(W, attr))
            element.setAttributeNS(
              W,
              `w:${attr}`,
              String(Number(element.getAttributeNS(W, attr)) + offsets[attr]),
            );
          if (local === attr && element.hasAttributeNS(W, "val"))
            element.setAttributeNS(
              W,
              "w:val",
              String(Number(element.getAttributeNS(W, "val")) + offsets[attr]),
            );
        }
        if (
          [
            "footnote",
            "footnoteReference",
            "comment",
            "commentReference",
            "commentRangeStart",
            "commentRangeEnd",
          ].includes(local ?? "")
        ) {
          const id = Number(element.getAttributeNS(W, "id"));
          if (id > 0 || local?.startsWith("comment"))
            element.setAttributeNS(
              W,
              "w:id",
              String(
                id +
                  (local?.startsWith("footnote")
                    ? offsets.footnote
                    : offsets.comment),
              ),
            );
        }
        for (const attr of ["name", "anchor"]) {
          const old = element.getAttributeNS(W, attr);
          if (old && bookmarks.has(old))
            element.setAttributeNS(W, `w:${attr}`, bookmarks.get(old)!);
        }
        if (local === "fldSimple" || local === "instrText") {
          let instruction =
            local === "fldSimple"
              ? (element.getAttributeNS(W, "instr") ?? "")
              : (element.textContent ?? "");
          instruction = instruction.replace(
            /\b(REF|PAGEREF|NOTEREF)\s+(\S+)/g,
            (_match, field: string, name: string) =>
              `${field} ${bookmarks.get(name) ?? name}`,
          );
          if (local === "fldSimple")
            element.setAttributeNS(W, "w:instr", instruction);
          else element.textContent = instruction;
        }
      }
      for (const attr of ["id", "embed", "link"])
        if (element.hasAttributeNS(R, attr))
          element.setAttributeNS(
            R,
            `r:${attr}`,
            prefix + element.getAttributeNS(R, attr),
          );
    }
  }
  const donorRels = new Map<string, XmlElement[]>();
  for (const [name, file] of Object.entries(donor.files)) {
    if (!name.startsWith("word/_rels/") || !name.endsWith(".rels")) continue;
    const relationships = parse(await file.async("string"));
    const imported: XmlElement[] = [];
    for (const rel of elements(relationships, "Relationship", REL)) {
      const type = rel.getAttribute("Type") ?? "";
      if (!type.endsWith("/image") && !type.endsWith("/hyperlink")) continue;
      rel.setAttribute("Id", prefix + rel.getAttribute("Id"));
      if (rel.getAttribute("TargetMode") !== "External") {
        const target = rel.getAttribute("Target")!;
        const media = donor.file(`word/${target}`);
        if (!media || !target.startsWith("media/"))
          throw new Error("Missing generated media dependency");
        const renamed = `media/${prefix}${target.slice(6)}`;
        base.file(`word/${renamed}`, await media.async("uint8array"));
        rel.setAttribute("Target", renamed);
      }
      imported.push(rel);
    }
    donorRels.set(name, imported);
  }
  function appendRelationships(
    part: string,
    relationships: XmlElement[],
  ): void {
    const key = `word/_rels/${part.split("/").pop()}.rels`;
    const target =
      documents.get(key) ?? parse(`<Relationships xmlns="${REL}"/>`);
    const ids = new Set(
      elements(target, "Relationship", REL).map((rel) =>
        rel.getAttribute("Id"),
      ),
    );
    for (const rel of relationships)
      if (!ids.has(rel.getAttribute("Id")))
        target.documentElement!.appendChild(target.importNode(rel, true));
    documents.set(key, target);
  }
  function addPartRelationship(local: string): void {
    const key = "word/_rels/document.xml.rels";
    const relationships =
      documents.get(key) ?? parse(`<Relationships xmlns="${REL}"/>`);
    if (
      !elements(relationships, "Relationship", REL).some(
        (rel) => rel.getAttribute("Type") === `${R}/${local}`,
      )
    ) {
      const rel = relationships.createElementNS(REL, "Relationship");
      rel.setAttribute("Id", `${prefix}${local}`);
      rel.setAttribute("Type", `${R}/${local}`);
      rel.setAttribute("Target", `${local}.xml`);
      relationships.documentElement!.appendChild(rel);
    }
    documents.set(key, relationships);
  }
  for (const [part, child, id] of [
    ["numbering", "abstractNum", "abstractNumId"],
    ["numbering", "num", "numId"],
    ["footnotes", "footnote", "id"],
    ["comments", "comment", "id"],
    ["styles", "style", "styleId"],
  ]) {
    const source = donorDocuments.get(`word/${part}.xml`);
    if (!source) continue;
    const target = documents.get(`word/${part}.xml`) ?? empty(part);
    const ids = new Set(
      elements(target, child).map((el) => el.getAttributeNS(W, id)),
    );
    for (const element of elements(source, child)) {
      if (!ids.has(element.getAttributeNS(W, id)))
        target.documentElement!.appendChild(target.importNode(element, true));
    }
    const attrs = source.documentElement!.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs.item(i)!;
      if (attr.name.startsWith("xmlns:"))
        target.documentElement!.setAttribute(attr.name, attr.value);
    }
    documents.set(`word/${part}.xml`, target);
    addPartRelationship(part);
    appendRelationships(
      `word/${part}.xml`,
      donorRels.get(`word/_rels/${part}.xml.rels`) ?? [],
    );
  }
  // Split the donor body at generated marker paragraphs, excluding section geometry.
  const fragments = new Map<string, XmlElement[]>();
  let current: string | undefined;
  const donorMain = donorDocuments.get("word/document.xml")!;
  for (const child of Array.from(elements(donorMain, "body")[0].childNodes)) {
    if (child.nodeType !== 1) continue;
    const element = child as XmlElement;
    const text = elements(element, "t")
      .map((el) => el.textContent)
      .join("");
    const marker = markers.indexOf(text);
    if (marker !== -1) {
      current = names[marker];
      fragments.set(current, []);
      continue;
    }
    if (!current || element.localName === "sectPr") continue;
    for (const section of elements(element, "sectPr"))
      section.parentNode?.removeChild(section);
    fragments.get(current)!.push(element);
  }
  const delimiters = options.placeholderDelimiters ?? {
    start: "{{",
    end: "}}",
  };
  const used = new Set<string>();
  let copyIndex = 0;
  const footnoteDocument = documents.get("word/footnotes.xml");
  let nextFootnote =
    Math.max(
      0,
      ...elements(footnoteDocument!, "footnote").map((el) =>
        Number(el.getAttributeNS(W, "id")),
      ),
    ) + 1;
  function repeatedFragments(originals: XmlElement[]): XmlElement[] {
    const clones = originals.map((el) => el.cloneNode(true) as XmlElement);
    const localNames = new Map<string, string>();
    const footnoteIds = new Map<string, string>();
    const copy = ++copyIndex;
    for (const clone of clones) {
      for (const bookmark of elements(clone, "bookmarkStart")) {
        const old = bookmark.getAttributeNS(W, "name")!;
        const renamed = `${old.slice(0, 27)}_copy${copy}_${localNames.size}`;
        localNames.set(old, renamed);
        bookmark.setAttributeNS(W, "w:name", renamed);
      }
      for (const reference of elements(clone, "footnoteReference")) {
        const old = reference.getAttributeNS(W, "id")!;
        if (!footnoteIds.has(old)) {
          const source = elements(footnoteDocument!, "footnote").find(
            (el) => el.getAttributeNS(W, "id") === old,
          );
          if (!source) throw new Error("Missing generated footnote");
          const note = source.cloneNode(true) as XmlElement;
          const id = String(nextFootnote++);
          note.setAttributeNS(W, "w:id", id);
          footnoteDocument!.documentElement!.appendChild(note);
          footnoteIds.set(old, id);
        }
        reference.setAttributeNS(W, "w:id", footnoteIds.get(old)!);
      }
    }
    for (const clone of clones) {
      for (const link of elements(clone, "hyperlink")) {
        const anchor = link.getAttributeNS(W, "anchor");
        if (anchor && localNames.has(anchor))
          link.setAttributeNS(W, "w:anchor", localNames.get(anchor)!);
      }
      for (const field of elements(clone, "fldSimple")) {
        const instruction = field.getAttributeNS(W, "instr") ?? "";
        field.setAttributeNS(
          W,
          "w:instr",
          instruction.replace(
            /\b(REF|PAGEREF|NOTEREF)\s+(\S+)/g,
            (_match, kind: string, name: string) =>
              `${kind} ${localNames.get(name) ?? name}`,
          ),
        );
      }
    }
    return clones;
  }
  for (const [part, document] of [...documents]) {
    if (
      !/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(
        part,
      )
    )
      continue;
    let changed = false;
    // Snapshot original paragraphs: inserted Markdown never gets interpreted as another patch.
    for (const paragraph of originalParagraphs.get(part) ?? []) {
      const text = elements(paragraph, "t")
        .map((el) => el.textContent)
        .join("");
      const name = names.find(
        (name) =>
          text.includes(`${delimiters.start}${name}${delimiters.end}`) &&
          (options.recursive !== false || !used.has(name)),
      );
      if (!name || !paragraph.parentNode) continue;
      const content = used.has(name)
        ? repeatedFragments(fragments.get(name) ?? [])
        : (fragments.get(name) ?? []);
      for (const fragment of content)
        paragraph.parentNode.insertBefore(
          document.importNode(fragment, true),
          paragraph,
        );
      paragraph.parentNode.removeChild(paragraph);
      used.add(name);
      changed = true;
    }
    if (changed) {
      appendRelationships(
        part,
        donorRels.get("word/_rels/document.xml.rels") ?? [],
      );
      const attrs = donorMain.documentElement!.attributes;
      for (let i = 0; i < attrs.length; i++) {
        const attr = attrs.item(i)!;
        if (attr.name.startsWith("xmlns:"))
          document.documentElement!.setAttribute(attr.name, attr.value);
      }
    }
  }
  // Cached caption numbers follow actual document order, including repeated patches.
  const counts = new Map<string, number>();
  const referenceValues = new Map<string, string>();
  let footnoteNumber = 0;
  const bodyDocument = documents.get("word/document.xml")!;
  for (const paragraph of elements(bodyDocument, "p")) {
    const active = new Map<string, { name: string; text: string }>();
    for (const child of Array.from(paragraph.childNodes)) {
      if (child.nodeType !== 1) continue;
      const element = child as XmlElement;
      if (element.localName === "bookmarkStart")
        active.set(element.getAttributeNS(W, "id")!, {
          name: element.getAttributeNS(W, "name")!,
          text: "",
        });
      if (element.localName === "fldSimple") {
        const match = /\bSEQ\s+(MdToDocxFigure|MdToDocxTable)\b/.exec(
          element.getAttributeNS(W, "instr") ?? "",
        );
        if (match) {
          const count = (counts.get(match[1]) ?? 0) + 1;
          counts.set(match[1], count);
          const value = elements(element, "t")[0];
          if (value) value.textContent = String(count);
        }
      }
      let value = elements(element, "t")
        .map((el) => el.textContent)
        .join("");
      if (elements(element, "footnoteReference").length)
        value = String(++footnoteNumber);
      for (const entry of active.values()) entry.text += value;
      if (element.localName === "bookmarkEnd") {
        const id = element.getAttributeNS(W, "id")!;
        const entry = active.get(id);
        if (entry) referenceValues.set(entry.name, entry.text);
        active.delete(id);
      }
    }
  }
  for (const document of documents.values())
    for (const field of elements(document, "fldSimple")) {
      const match = /^\s*(?:REF|NOTEREF)\s+(\S+)/.exec(
        field.getAttributeNS(W, "instr") ?? "",
      );
      if (match && referenceValues.has(match[1])) {
        const value = elements(field, "t")[0];
        if (value) value.textContent = referenceValues.get(match[1])!;
      }
    }
  // Bookmark numeric IDs must be unique, including repeated placeholder copies.
  let bookmarkId = 0;
  let drawingId = 1;
  const bookmarkNames = new Set<string>();
  for (const document of documents.values()) {
    const open = new Map<string, number[]>();
    for (const element of Array.from(document.getElementsByTagName("*"))) {
      if (element.namespaceURI === W && element.localName === "bookmarkStart") {
        const old = element.getAttributeNS(W, "id")!;
        const id = bookmarkId++;
        open.set(old, [...(open.get(old) ?? []), id]);
        element.setAttributeNS(W, "w:id", String(id));
        const name = element.getAttributeNS(W, "name")!;
        if (bookmarkNames.has(name))
          element.setAttributeNS(W, "w:name", `${name.slice(0, 28)}_${id}`);
        bookmarkNames.add(element.getAttributeNS(W, "name")!);
      } else if (
        element.namespaceURI === W &&
        element.localName === "bookmarkEnd"
      ) {
        const id = open.get(element.getAttributeNS(W, "id")!)?.shift();
        if (id !== undefined) element.setAttributeNS(W, "w:id", String(id));
      } else if (element.localName === "docPr")
        element.setAttribute("id", String(drawingId++));
    }
  }
  const types = documents.get("[Content_Types].xml")!;
  const donorTypes = donorDocuments.get("[Content_Types].xml")!;
  for (const element of Array.from(donorTypes.documentElement!.childNodes)) {
    if (element.nodeType !== 1) continue;
    const entry = element as XmlElement;
    const key = entry.localName === "Default" ? "Extension" : "PartName";
    const value = entry.getAttribute(key);
    if (key === "PartName" && !documents.has(value!.slice(1))) continue;
    if (
      !Array.from(types.documentElement!.childNodes).some(
        (node) =>
          node.nodeType === 1 &&
          (node as XmlElement).getAttribute(key) === value,
      )
    )
      types.documentElement!.appendChild(types.importNode(entry, true));
  }
  if (
    (counts.size > 0 && options.captions?.updateFieldsOnOpen !== false) ||
    (elements(bodyDocument, "instrText").some((el) =>
      /\bTOC\b/.test(el.textContent ?? ""),
    ) &&
      options.toc?.updateFieldsOnOpen !== false)
  ) {
    const settings = documents.get("word/settings.xml") ?? empty("settings");
    if (!elements(settings, "updateFields").length) {
      const field = settings.createElementNS(W, "w:updateFields");
      field.setAttributeNS(W, "w:val", "true");
      settings.documentElement!.appendChild(field);
    }
    documents.set("word/settings.xml", settings);
    addPartRelationship("settings");
    const ns = "http://schemas.openxmlformats.org/package/2006/content-types";
    if (
      !elements(types, "Override", ns).some(
        (el) => el.getAttribute("PartName") === "/word/settings.xml",
      )
    ) {
      const entry = types.createElementNS(ns, "Override");
      entry.setAttribute("PartName", "/word/settings.xml");
      entry.setAttribute(
        "ContentType",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
      );
      types.documentElement!.appendChild(entry);
    }
  }
  for (const [name, document] of documents) {
    throwIfAborted(options.signal);
    base.file(name, xml(document));
  }
  return base.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
