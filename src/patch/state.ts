import type JSZip from "jszip";
import type {
  Document as XmlDocument,
  Element as XmlElement,
} from "@xmldom/xmldom";
import type { PatchMarkdownOptions } from "../types.js";
import { R, REL, W, elements, maxId, parse, xml } from "./xml.js";

/** Amounts added to donor IDs so they land above every ID in the template. */
export interface IdOffsets {
  numId: number;
  abstractNumId: number;
  bookmark: number;
  footnote: number;
  comment: number;
}

/** What `mergePatchPackage` receives from the patch entry point. */
export interface PatchMergeInput {
  base: JSZip;
  donor: JSZip;
  /** Marker paragraph texts in the donor body, one per patch entry. */
  markers: string[];
  /** Placeholder names, index-aligned with `markers`. */
  names: string[];
  options: PatchMarkdownOptions;
}

/** Everything the merge stages read and write, built once and threaded through. */
export interface PatchMergeState extends PatchMergeInput {
  /** Parsed base parts by package path; serialized back at the end. */
  documents: Map<string, XmlDocument>;
  /** Paragraphs present before any insertion, so inserted Markdown is never re-patched. */
  originalParagraphs: Map<string, XmlElement[]>;
  /** Prefix for donor relationship IDs, bookmark names and media files. */
  prefix: string;
  offsets: IdOffsets;
  /** Parsed donor `.xml` parts by package path. */
  donorDocuments: Map<string, XmlDocument>;
  /** Donor bookmark name to its prefixed, package-unique name. */
  bookmarks: Map<string, string>;
  /** Imported image and hyperlink relationships per donor `.rels` part. */
  donorRels: Map<string, XmlElement[]>;
  /** Donor body elements per placeholder name. */
  fragments: Map<string, XmlElement[]>;
  /** Caption sequence counts per SEQ identifier, in document order. */
  captionCounts: Map<string, number>;
}

/** Read both packages and settle the prefix and ID offsets for the donor. */
export async function createPatchMergeState(
  input: PatchMergeInput,
): Promise<PatchMergeState> {
  const documents = await parseBaseParts(input.base);
  const originalParagraphs = new Map(
    [...documents].map(([part, document]) => [part, elements(document, "p")]),
  );
  const baseText = [...documents.values()].map(xml).join("");
  const prefix = choosePrefix(input.base, baseText);
  const offsets = computeIdOffsets(baseText, documents.values());
  const { donorDocuments, bookmarks } = await parseDonorParts(
    input.donor,
    prefix,
  );
  return {
    ...input,
    documents,
    originalParagraphs,
    prefix,
    offsets,
    donorDocuments,
    bookmarks,
    donorRels: new Map(),
    fragments: new Map(),
    captionCounts: new Map(),
  };
}

async function parseBaseParts(base: JSZip): Promise<Map<string, XmlDocument>> {
  const documents = new Map<string, XmlDocument>();
  for (const [name, file] of Object.entries(base.files))
    if (!file.dir && (name.endsWith(".xml") || name.endsWith(".rels")))
      documents.set(name, parse(await file.async("string")));
  return documents;
}

function choosePrefix(base: JSZip, baseText: string): string {
  let prefixIndex = 1;
  while (
    baseText.includes(`mdp${prefixIndex}_`) ||
    Object.keys(base.files).some((name) => name.includes(`mdp${prefixIndex}_`))
  )
    prefixIndex++;
  return `mdp${prefixIndex}_`;
}

/** Highest bookmark ID in the template, read by namespace so any prefix counts. */
function maxBookmarkId(documents: Iterable<XmlDocument>): number {
  const ids = [...documents].flatMap((document) =>
    ["bookmarkStart", "bookmarkEnd"].flatMap((local) =>
      elements(document, local).map((bookmark) =>
        Number(bookmark.getAttributeNS(W, "id")),
      ),
    ),
  );
  return Math.max(0, ...ids.filter(Number.isFinite));
}

function computeIdOffsets(
  baseText: string,
  documents: Iterable<XmlDocument>,
): IdOffsets {
  return {
    numId:
      maxId(baseText, /w:numId="(\d+)"/g) +
      maxId(baseText, /<w:numId\b[^>]*w:val="(\d+)"/g) +
      1,
    abstractNumId: maxId(baseText, /w:abstractNumId="(\d+)"/g) + 1,
    // Donor bookmarks start at 1 too; lift them above the template's so the
    // final pairing pass never matches a donor end to a template start.
    bookmark: maxBookmarkId(documents) + 1,
    footnote: maxId(baseText, /<w:footnote\b[^>]*w:id="(\d+)"/g) + 1,
    comment: maxId(baseText, /<w:comment\b[^>]*w:id="(\d+)"/g) + 1,
  };
}

async function parseDonorParts(
  donor: JSZip,
  prefix: string,
): Promise<Pick<PatchMergeState, "donorDocuments" | "bookmarks">> {
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
  return { donorDocuments, bookmarks };
}

/** Add `relationships` to `part`'s `.rels`, skipping IDs it already has. */
export function appendRelationships(
  state: PatchMergeState,
  part: string,
  relationships: XmlElement[],
): void {
  const key = `word/_rels/${part.split("/").pop() ?? ""}.rels`;
  const target =
    state.documents.get(key) ?? parse(`<Relationships xmlns="${REL}"/>`);
  const ids = new Set(
    elements(target, "Relationship", REL).map((rel) => rel.getAttribute("Id")),
  );
  for (const rel of relationships)
    if (!ids.has(rel.getAttribute("Id")))
      target.documentElement!.appendChild(target.importNode(rel, true));
  state.documents.set(key, target);
}

/** Point the main document at `word/<local>.xml` unless it already has that relationship type. */
export function addPartRelationship(
  state: PatchMergeState,
  local: string,
): void {
  const key = "word/_rels/document.xml.rels";
  const relationships =
    state.documents.get(key) ?? parse(`<Relationships xmlns="${REL}"/>`);
  if (
    !elements(relationships, "Relationship", REL).some(
      (rel) => rel.getAttribute("Type") === `${R}/${local}`,
    )
  ) {
    const rel = relationships.createElementNS(REL, "Relationship");
    rel.setAttribute("Id", `${state.prefix}${local}`);
    rel.setAttribute("Type", `${R}/${local}`);
    rel.setAttribute("Target", `${local}.xml`);
    relationships.documentElement!.appendChild(rel);
  }
  state.documents.set(key, relationships);
}
