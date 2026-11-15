import type {
  Document as XmlDocument,
  Element as XmlElement,
} from "@xmldom/xmldom";
import { throwIfAborted } from "../processingLimits.js";
import { tocUpdatesFieldsOnOpen } from "../tocBuilder.js";
import { addPartRelationship, type PatchMergeState } from "./state.js";
import {
  CONTENT_TYPES,
  W,
  childElements,
  elements,
  empty,
  textOf,
  xml,
} from "./xml.js";

/** A bookmark still open while walking a paragraph, and the text it has covered. */
interface OpenBookmark {
  name: string;
  text: string;
}

/** Running state of the document-order walk over the body's paragraphs. */
interface CachedValueWalk {
  counts: Map<string, number>;
  referenceValues: Map<string, string>;
  footnoteNumber: number;
}

/**
 * Cached caption numbers follow actual document order, including repeated
 * patches; REF and NOTEREF fields then show the text of the bookmark they cite.
 */
export function fillCachedFieldValues(state: PatchMergeState): void {
  const walk: CachedValueWalk = {
    counts: state.captionCounts,
    referenceValues: new Map(),
    footnoteNumber: 0,
  };
  const bodyDocument = state.documents.get("word/document.xml")!;
  for (const paragraph of elements(bodyDocument, "p"))
    walkParagraph(walk, paragraph);
  for (const document of state.documents.values())
    fillReferenceFields(walk.referenceValues, document);
}

function walkParagraph(walk: CachedValueWalk, paragraph: XmlElement): void {
  const active = new Map<string, OpenBookmark>();
  for (const element of childElements(paragraph)) {
    if (element.localName === "bookmarkStart")
      active.set(element.getAttributeNS(W, "id")!, {
        name: element.getAttributeNS(W, "name")!,
        text: "",
      });
    if (element.localName === "fldSimple") numberCaption(walk.counts, element);
    let value = textOf(element);
    if (elements(element, "footnoteReference").length)
      value = String(++walk.footnoteNumber);
    for (const entry of active.values()) entry.text += value;
    if (element.localName === "bookmarkEnd")
      closeBookmark(walk.referenceValues, active, element);
  }
}

function numberCaption(counts: Map<string, number>, field: XmlElement): void {
  const match = /\bSEQ\s+(MdToDocxFigure|MdToDocxTable)\b/.exec(
    field.getAttributeNS(W, "instr") ?? "",
  );
  if (!match) return;
  const count = (counts.get(match[1]!) ?? 0) + 1;
  counts.set(match[1]!, count);
  const value = elements(field, "t")[0];
  if (value) value.textContent = String(count);
}

function closeBookmark(
  referenceValues: Map<string, string>,
  active: Map<string, OpenBookmark>,
  element: XmlElement,
): void {
  const id = element.getAttributeNS(W, "id")!;
  const entry = active.get(id);
  if (entry) referenceValues.set(entry.name, entry.text);
  active.delete(id);
}

function fillReferenceFields(
  referenceValues: Map<string, string>,
  document: XmlDocument,
): void {
  for (const field of elements(document, "fldSimple")) {
    const match = /^\s*(?:REF|NOTEREF)\s+(\S+)/.exec(
      field.getAttributeNS(W, "instr") ?? "",
    );
    if (!match || !referenceValues.has(match[1]!)) continue;
    const value = elements(field, "t")[0];
    if (value) value.textContent = referenceValues.get(match[1]!)!;
  }
}

/** Counters for the package-wide bookmark and drawing renumbering. */
interface IdRenumbering {
  bookmarkId: number;
  drawingId: number;
  bookmarkNames: Set<string>;
}

/**
 * Bookmark numeric IDs must be unique, including repeated placeholder copies;
 * each end takes the ID of the earliest open start that shared its old ID.
 * Bookmark names stay unique and drawing IDs run from 1 across the package.
 */
export function renumberBookmarksAndDrawings(state: PatchMergeState): void {
  const ids: IdRenumbering = {
    bookmarkId: 0,
    drawingId: 1,
    bookmarkNames: new Set(),
  };
  for (const document of state.documents.values()) {
    const open = new Map<string, number[]>();
    for (const element of Array.from(document.getElementsByTagName("*")))
      renumberElement(ids, open, element);
  }
}

function renumberElement(
  ids: IdRenumbering,
  open: Map<string, number[]>,
  element: XmlElement,
): void {
  const isWord = element.namespaceURI === W;
  if (isWord && element.localName === "bookmarkStart")
    renumberBookmarkStart(ids, open, element);
  else if (isWord && element.localName === "bookmarkEnd") {
    const id = open.get(element.getAttributeNS(W, "id")!)?.shift();
    if (id !== undefined) element.setAttributeNS(W, "w:id", String(id));
  } else if (element.localName === "docPr")
    element.setAttribute("id", String(ids.drawingId++));
}

function renumberBookmarkStart(
  ids: IdRenumbering,
  open: Map<string, number[]>,
  element: XmlElement,
): void {
  const old = element.getAttributeNS(W, "id")!;
  const id = ids.bookmarkId++;
  open.set(old, [...(open.get(old) ?? []), id]);
  element.setAttributeNS(W, "w:id", String(id));
  const name = element.getAttributeNS(W, "name")!;
  if (ids.bookmarkNames.has(name))
    element.setAttributeNS(W, "w:name", `${name.slice(0, 28)}_${id}`);
  ids.bookmarkNames.add(element.getAttributeNS(W, "name")!);
}

/** Add donor content types the template lacks, for parts that ended up in the package. */
export function mergeContentTypes(state: PatchMergeState): void {
  const types = state.documents.get("[Content_Types].xml")!;
  const donorTypes = state.donorDocuments.get("[Content_Types].xml")!;
  for (const entry of childElements(donorTypes.documentElement!)) {
    const key = entry.localName === "Default" ? "Extension" : "PartName";
    const value = entry.getAttribute(key);
    if (key === "PartName" && !state.documents.has(value!.slice(1))) continue;
    if (
      !childElements(types.documentElement!).some(
        (node) => node.getAttribute(key) === value,
      )
    )
      types.documentElement!.appendChild(types.importNode(entry, true));
  }
}

/**
 * Ask Word to refresh fields on open when captions were numbered or the body
 * holds a TOC, unless the caller opted out for that feature. Pre-filled TOC
 * page numbers opt the TOC out by default.
 */
export function enableUpdateFieldsWhenNeeded(state: PatchMergeState): void {
  if (!needsFieldUpdate(state)) return;
  const settings =
    state.documents.get("word/settings.xml") ?? empty("settings");
  if (!elements(settings, "updateFields").length) {
    const field = settings.createElementNS(W, "w:updateFields");
    field.setAttributeNS(W, "w:val", "true");
    settings.documentElement!.appendChild(field);
  }
  state.documents.set("word/settings.xml", settings);
  addPartRelationship(state, "settings");
  addSettingsContentType(state.documents.get("[Content_Types].xml")!);
}

function needsFieldUpdate(state: PatchMergeState): boolean {
  const { options } = state;
  const bodyDocument = state.documents.get("word/document.xml")!;
  return (
    (state.captionCounts.size > 0 &&
      options.captions?.updateFieldsOnOpen !== false) ||
    (elements(bodyDocument, "instrText").some((el) =>
      /\bTOC\b/.test(el.textContent ?? ""),
    ) &&
      tocUpdatesFieldsOnOpen(options.toc))
  );
}

function addSettingsContentType(types: XmlDocument): void {
  if (
    elements(types, "Override", CONTENT_TYPES).some(
      (el) => el.getAttribute("PartName") === "/word/settings.xml",
    )
  )
    return;
  const entry = types.createElementNS(CONTENT_TYPES, "Override");
  entry.setAttribute("PartName", "/word/settings.xml");
  entry.setAttribute(
    "ContentType",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
  );
  types.documentElement!.appendChild(entry);
}

/** Write every parsed part back into the base package and zip it. */
export async function serializePatchedPackage(
  state: PatchMergeState,
): Promise<Uint8Array> {
  for (const [name, document] of state.documents) {
    throwIfAborted(state.options.signal);
    state.base.file(name, xml(document));
  }
  return state.base.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
}
