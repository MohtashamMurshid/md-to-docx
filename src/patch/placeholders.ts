import type {
  Document as XmlDocument,
  Element as XmlElement,
} from "@xmldom/xmldom";
import { appendRelationships, type PatchMergeState } from "./state.js";
import {
  BOOKMARK_FIELD,
  W,
  childElements,
  copyNamespaceDeclarations,
  elements,
  textOf,
} from "./xml.js";

/** Parts whose paragraphs may hold a placeholder. */
const PATCHABLE_PART =
  /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/;

/** Split the donor body at generated marker paragraphs, excluding section geometry. */
export function splitDonorFragments(state: PatchMergeState): void {
  let current: string | undefined;
  const donorMain = state.donorDocuments.get("word/document.xml")!;
  for (const element of childElements(elements(donorMain, "body")[0]!)) {
    const marker = state.markers.indexOf(textOf(element));
    if (marker !== -1) {
      // `markers` and `names` are built from the same patch entries.
      current = state.names[marker]!;
      state.fragments.set(current, []);
      continue;
    }
    if (!current || element.localName === "sectPr") continue;
    for (const section of elements(element, "sectPr"))
      section.parentNode?.removeChild(section);
    state.fragments.get(current)!.push(element);
  }
}

/**
 * Fresh numbering and footnote copies for a placeholder used more than once.
 * Counters run across every copy in the package.
 */
interface FragmentCopier {
  numberingDocument: XmlDocument;
  numberingDefinitions: Map<string, XmlElement>;
  nextNumbering: number;
  footnoteDocument: XmlDocument | undefined;
  nextFootnote: number;
  copyIndex: number;
}

function createFragmentCopier(state: PatchMergeState): FragmentCopier {
  const numberingDocument = state.documents.get("word/numbering.xml")!;
  const numberingDefinitions = new Map(
    elements(numberingDocument, "num").map((element) => [
      element.getAttributeNS(W, "numId")!,
      element,
    ]),
  );
  const footnoteDocument = state.documents.get("word/footnotes.xml");
  return {
    numberingDocument,
    numberingDefinitions,
    nextNumbering:
      Math.max(0, ...[...numberingDefinitions.keys()].map(Number)) + 1,
    footnoteDocument,
    nextFootnote:
      Math.max(
        0,
        ...elements(footnoteDocument!, "footnote").map((el) =>
          Number(el.getAttributeNS(W, "id")),
        ),
      ) + 1,
    copyIndex: 0,
  };
}

/**
 * How one kind of reference inside a fragment copy is pointed at that copy's
 * own definition: each referenced definition is copied once per fragment
 * copy, on first sight, so references that shared an ID still share one.
 */
interface ReferenceRemap {
  /** Reference element, e.g. `numId`. */
  local: string;
  /** Attribute holding the referenced ID, e.g. `val`. */
  attr: string;
  /** Old ID to this copy's ID. */
  ids: Map<string, string>;
  /** Copy the definition behind `old` and return the copy's ID. */
  copy: (old: string) => string;
}

/** Replace each placeholder paragraph in the template with its donor fragment. */
export function replacePlaceholders(state: PatchMergeState): void {
  const copier = createFragmentCopier(state);
  const used = new Set<string>();
  for (const [part, document] of [...state.documents]) {
    if (!PATCHABLE_PART.test(part)) continue;
    if (replacePartPlaceholders(state, { part, document, used, copier }))
      adoptDonorBodyContext(state, part, document);
  }
}

interface PartPlaceholders {
  part: string;
  document: XmlDocument;
  /** Placeholder names already inserted somewhere in the package. */
  used: Set<string>;
  copier: FragmentCopier;
}

function replacePartPlaceholders(
  state: PatchMergeState,
  { part, document, used, copier }: PartPlaceholders,
): boolean {
  const delimiters = state.options.placeholderDelimiters ?? {
    start: "{{",
    end: "}}",
  };
  let changed = false;
  // Snapshot original paragraphs: inserted Markdown never gets interpreted as another patch.
  for (const paragraph of state.originalParagraphs.get(part) ?? []) {
    const text = textOf(paragraph);
    const name = state.names.find(
      (name) =>
        text.includes(`${delimiters.start}${name}${delimiters.end}`) &&
        (state.options.recursive !== false || !used.has(name)),
    );
    if (!name || !paragraph.parentNode) continue;
    const content = used.has(name)
      ? repeatedFragments(copier, state.fragments.get(name) ?? [])
      : (state.fragments.get(name) ?? []);
    for (const fragment of content)
      paragraph.parentNode.insertBefore(
        document.importNode(fragment, true),
        paragraph,
      );
    paragraph.parentNode.removeChild(paragraph);
    used.add(name);
    changed = true;
  }
  return changed;
}

/** A patched part needs the donor body's relationships and namespace declarations. */
function adoptDonorBodyContext(
  state: PatchMergeState,
  part: string,
  document: XmlDocument,
): void {
  appendRelationships(
    state,
    part,
    state.donorRels.get("word/_rels/document.xml.rels") ?? [],
  );
  copyNamespaceDeclarations(
    state.donorDocuments.get("word/document.xml")!,
    document,
  );
}

/**
 * Clone a fragment for a repeated placeholder. Each copy starts fresh lists
 * (paragraphs in the same list still share an ID within one copy) and
 * footnotes and renames its bookmarks, then points its own anchors and field
 * instructions at the renamed bookmarks.
 */
function repeatedFragments(
  copier: FragmentCopier,
  originals: XmlElement[],
): XmlElement[] {
  const clones = originals.map((el) => el.cloneNode(true) as XmlElement);
  const localNames = new Map<string, string>();
  const numbering: ReferenceRemap = {
    local: "numId",
    attr: "val",
    ids: new Map(),
    copy: (old) => copyNumberingDefinition(copier, old),
  };
  const footnotes: ReferenceRemap = {
    local: "footnoteReference",
    attr: "id",
    ids: new Map(),
    copy: (old) => copyFootnote(copier, numbering, old),
  };
  const copy = ++copier.copyIndex;
  for (const clone of clones) {
    remapReferences(clone, numbering);
    renameCopiedBookmarks(copy, localNames, clone);
    remapReferences(clone, footnotes);
  }
  for (const clone of clones) retargetCopiedReferences(localNames, clone);
  return clones;
}

function remapReferences(root: XmlElement, remap: ReferenceRemap): void {
  for (const reference of elements(root, remap.local)) {
    const old = reference.getAttributeNS(W, remap.attr)!;
    if (!remap.ids.has(old)) remap.ids.set(old, remap.copy(old));
    reference.setAttributeNS(W, `w:${remap.attr}`, remap.ids.get(old)!);
  }
}

function copyNumberingDefinition(copier: FragmentCopier, old: string): string {
  const source = copier.numberingDefinitions.get(old);
  if (!source) throw new Error("Missing generated numbering definition");
  const definition = source.cloneNode(true) as XmlElement;
  const id = String(copier.nextNumbering++);
  definition.setAttributeNS(W, "w:numId", id);
  copier.numberingDocument.documentElement!.appendChild(definition);
  return id;
}

/** A copied footnote's own lists follow the copy's numbering remap. */
function copyFootnote(
  copier: FragmentCopier,
  numbering: ReferenceRemap,
  old: string,
): string {
  const footnotes = copier.footnoteDocument!;
  const source = elements(footnotes, "footnote").find(
    (el) => el.getAttributeNS(W, "id") === old,
  );
  if (!source) throw new Error("Missing generated footnote");
  const note = source.cloneNode(true) as XmlElement;
  remapReferences(note, numbering);
  const id = String(copier.nextFootnote++);
  note.setAttributeNS(W, "w:id", id);
  footnotes.documentElement!.appendChild(note);
  return id;
}

function renameCopiedBookmarks(
  copy: number,
  localNames: Map<string, string>,
  clone: XmlElement,
): void {
  for (const bookmark of elements(clone, "bookmarkStart")) {
    const old = bookmark.getAttributeNS(W, "name")!;
    const renamed = `${old.slice(0, 27)}_copy${copy}_${localNames.size}`;
    localNames.set(old, renamed);
    bookmark.setAttributeNS(W, "w:name", renamed);
  }
}

function retargetCopiedReferences(
  localNames: Map<string, string>,
  clone: XmlElement,
): void {
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
        BOOKMARK_FIELD,
        (_match, kind: string, name: string) =>
          `${kind} ${localNames.get(name) ?? name}`,
      ),
    );
  }
}
