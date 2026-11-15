import type { Element as XmlElement } from "@xmldom/xmldom";
import {
  addPartRelationship,
  appendRelationships,
  type PatchMergeState,
} from "./state.js";
import {
  BOOKMARK_FIELD,
  R,
  REL,
  W,
  copyNamespaceDeclarations,
  elements,
  empty,
  parse,
} from "./xml.js";

const NOTE_AND_COMMENT_ELEMENTS = [
  "footnote",
  "footnoteReference",
  "comment",
  "commentReference",
  "commentRangeStart",
  "commentRangeEnd",
];

/**
 * Move every donor ID out of the template's range: bookmark, numbering,
 * footnote and comment IDs by their offsets, bookmark names (and the anchors
 * and field instructions that cite them) to their prefixed names, and
 * relationship IDs by the prefix.
 */
export function remapDonorIds(state: PatchMergeState): void {
  for (const document of state.donorDocuments.values()) {
    for (const element of Array.from(document.getElementsByTagName("*"))) {
      if (element.namespaceURI === W) remapWordElement(state, element);
      prefixRelationshipIds(state.prefix, element);
    }
  }
}

function remapWordElement(state: PatchMergeState, element: XmlElement): void {
  const local = element.localName;
  if (local === "bookmarkStart" || local === "bookmarkEnd")
    shiftAttribute(element, "id", state.offsets.bookmark);
  shiftNumberingIds(state, element);
  if (NOTE_AND_COMMENT_ELEMENTS.includes(local ?? ""))
    shiftNoteOrCommentId(state, element, local ?? "");
  renameBookmarkAttributes(state.bookmarks, element);
  if (local === "fldSimple" || local === "instrText")
    renameFieldBookmarks(state.bookmarks, element, local);
}

/** `w:numId`/`w:abstractNumId` attributes, and the `w:val` of `<w:numId>`/`<w:abstractNumId>`. */
function shiftNumberingIds(state: PatchMergeState, element: XmlElement): void {
  for (const attr of ["numId", "abstractNumId"] as const) {
    if (element.hasAttributeNS(W, attr))
      shiftAttribute(element, attr, state.offsets[attr]);
    if (element.localName === attr && element.hasAttributeNS(W, "val"))
      shiftAttribute(element, "val", state.offsets[attr]);
  }
}

function renameBookmarkAttributes(
  bookmarks: Map<string, string>,
  element: XmlElement,
): void {
  for (const attr of ["name", "anchor"]) {
    const old = element.getAttributeNS(W, attr);
    if (old && bookmarks.has(old))
      element.setAttributeNS(W, `w:${attr}`, bookmarks.get(old)!);
  }
}

function shiftAttribute(
  element: XmlElement,
  attr: string,
  offset: number,
): void {
  element.setAttributeNS(
    W,
    `w:${attr}`,
    String(Number(element.getAttributeNS(W, attr)) + offset),
  );
}

/** Footnote IDs 0 and below are separators and stay put; comment IDs all move. */
function shiftNoteOrCommentId(
  state: PatchMergeState,
  element: XmlElement,
  local: string,
): void {
  const id = Number(element.getAttributeNS(W, "id"));
  if (id > 0 || local.startsWith("comment"))
    element.setAttributeNS(
      W,
      "w:id",
      String(
        id +
          (local.startsWith("footnote")
            ? state.offsets.footnote
            : state.offsets.comment),
      ),
    );
}

function renameFieldBookmarks(
  bookmarks: Map<string, string>,
  element: XmlElement,
  local: "fldSimple" | "instrText",
): void {
  const instruction = (
    local === "fldSimple"
      ? (element.getAttributeNS(W, "instr") ?? "")
      : (element.textContent ?? "")
  ).replace(
    BOOKMARK_FIELD,
    (_match, field: string, name: string) =>
      `${field} ${bookmarks.get(name) ?? name}`,
  );
  if (local === "fldSimple") element.setAttributeNS(W, "w:instr", instruction);
  else element.textContent = instruction;
}

function prefixRelationshipIds(prefix: string, element: XmlElement): void {
  for (const attr of ["id", "embed", "link"])
    if (element.hasAttributeNS(R, attr))
      element.setAttributeNS(
        R,
        `r:${attr}`,
        prefix + String(element.getAttributeNS(R, attr)),
      );
}

/**
 * Keep the donor's image and hyperlink relationships under prefixed IDs, and
 * copy each internal image into the base package under a prefixed name.
 */
export async function importDonorRelationships(
  state: PatchMergeState,
): Promise<void> {
  for (const [name, file] of Object.entries(state.donor.files)) {
    if (!name.startsWith("word/_rels/") || !name.endsWith(".rels")) continue;
    const relationships = parse(await file.async("string"));
    const imported: XmlElement[] = [];
    for (const rel of elements(relationships, "Relationship", REL)) {
      const type = rel.getAttribute("Type") ?? "";
      if (!type.endsWith("/image") && !type.endsWith("/hyperlink")) continue;
      rel.setAttribute("Id", state.prefix + String(rel.getAttribute("Id")));
      if (rel.getAttribute("TargetMode") !== "External")
        await importDonorMedia(state, rel);
      imported.push(rel);
    }
    state.donorRels.set(name, imported);
  }
}

async function importDonorMedia(
  state: PatchMergeState,
  rel: XmlElement,
): Promise<void> {
  const target = rel.getAttribute("Target")!;
  const media = state.donor.file(`word/${target}`);
  if (!media || !target.startsWith("media/"))
    throw new Error("Missing generated media dependency");
  const renamed = `media/${state.prefix}${target.slice(6)}`;
  state.base.file(`word/${renamed}`, await media.async("uint8array"));
  rel.setAttribute("Target", renamed);
}

/** Donor parts whose definitions are appended to the template's, keyed by ID attribute. */
const DEFINITION_PARTS: [part: string, child: string, id: string][] = [
  ["numbering", "abstractNum", "abstractNumId"],
  ["numbering", "num", "numId"],
  ["footnotes", "footnote", "id"],
  ["comments", "comment", "id"],
  ["styles", "style", "styleId"],
];

/** Append donor numbering, footnote, comment and style definitions the template lacks. */
export function mergeDonorDefinitionParts(state: PatchMergeState): void {
  for (const [part, child, id] of DEFINITION_PARTS) {
    const source = state.donorDocuments.get(`word/${part}.xml`);
    if (!source) continue;
    const target = state.documents.get(`word/${part}.xml`) ?? empty(part);
    const ids = new Set(
      elements(target, child).map((el) => el.getAttributeNS(W, id)),
    );
    for (const element of elements(source, child)) {
      if (!ids.has(element.getAttributeNS(W, id)))
        target.documentElement!.appendChild(target.importNode(element, true));
    }
    copyNamespaceDeclarations(source, target);
    state.documents.set(`word/${part}.xml`, target);
    addPartRelationship(state, part);
    appendRelationships(
      state,
      `word/${part}.xml`,
      state.donorRels.get(`word/_rels/${part}.xml.rels`) ?? [],
    );
  }
}
