import {
  Paragraph,
  Table,
  TextRun,
  AlignmentType,
  InternalHyperlink,
  XmlComponent,
  XmlAttributeComponent,
  SimpleField,
  Tab,
  TabStopType,
  patchDocument,
} from "docx";
import type {
  IRunOptions,
  PageNumberEstimator,
  TemplatePageNumberEstimator,
} from "docx";
import { Style, TocOptions, TocTabLeader } from "./types.js";
import { resolveFontFamily } from "./utils/styleUtils.js";
import { runLanguage } from "./accessibility.js";

export type TocHeadingEntry = {
  text: string;
  level: number;
  bookmarkId: string;
};

/**
 * Resolves the font size, bold, and italic styling for a TOC entry at the
 * given heading level, honouring per-level style overrides. Level 1 is bold
 * by default; all other levels default to non-bold.
 */
function resolveTocEntryStyle(
  level: number,
  style: Style,
): { fontSize: number; bold: boolean; italic: boolean } {
  const levelFontSize = style[`tocHeading${level}FontSize` as keyof Style] as
    | number
    | undefined;
  const explicitBold = style[`tocHeading${level}Bold` as keyof Style] as
    | boolean
    | undefined;
  const explicitItalic = style[`tocHeading${level}Italic` as keyof Style] as
    | boolean
    | undefined;

  let fontSize = levelFontSize || style.tocFontSize;
  if (!fontSize) {
    fontSize = style.paragraphSize
      ? style.paragraphSize - (level - 1) * 2
      : 24 - (level - 1) * 2;
  }

  return {
    fontSize,
    bold: explicitBold !== undefined ? explicitBold : level === 1,
    italic: explicitItalic || false,
  };
}

class FieldAttributes extends XmlAttributeComponent<{
  type?: string;
  dirty?: string;
  space?: string;
}> {
  protected override readonly xmlKeys = {
    type: "w:fldCharType",
    dirty: "w:dirty",
    space: "xml:space",
  };
}

class FieldElement extends XmlComponent {
  attributes(value: FieldAttributes): void {
    this.root.push(value);
  }

  text(value: string): void {
    this.root.push(value);
  }
}

function fieldRun(
  type: "begin" | "separate" | "end",
  { instruction, dirty = false }: { instruction?: string; dirty?: boolean } = {},
): TextRun {
  const field = new FieldElement("w:fldChar");
  field.attributes(
    new FieldAttributes({ type, ...(dirty ? { dirty: "true" } : {}) }),
  );
  const children: FieldElement[] = [field];
  if (instruction) {
    const text = new FieldElement("w:instrText");
    text.attributes(new FieldAttributes({ space: "preserve" }));
    text.text(instruction);
    children.push(text);
  }
  return new TextRun({ children });
}

/** Whether a native TOC is written with page numbers from docx's layout pass. */
export function prefillsTocPageNumbers(toc: TocOptions | undefined): boolean {
  return (
    toc?.prefillPageNumbers === true &&
    toc.mode !== "links" &&
    toc.pageNumbers !== false
  );
}

/**
 * Whether a TOC asks Word to refresh fields on open: on by default, off by
 * default when its page numbers are pre-filled, and never for the links mode.
 */
export function tocUpdatesFieldsOnOpen(toc: TocOptions | undefined): boolean {
  return (
    toc?.mode !== "links" &&
    (toc?.updateFieldsOnOpen ?? !prefillsTocPageNumbers(toc))
  );
}

/**
 * docx's page-number estimator, which lays the pages out as Word would. Loaded
 * on demand so `docx/layout` stays out of bundles that never prefill. `guess`
 * keeps it going past fonts and content it can't measure exactly, so every
 * entry gets a number rather than staying `?` in a field Word no longer
 * refreshes.
 */
export async function loadTocPageNumberEstimator(): Promise<
  PageNumberEstimator & TemplatePageNumberEstimator
> {
  const { estimatePageNumbersWith } = await import("docx/layout");
  return estimatePageNumbersWith({ guess: true });
}

/**
 * Writes estimated page numbers into a patched package's TOCs and page
 * references. The patch path merges into a template after docx has packed the
 * donor, so the layout pass has to run on the merged package, through docx's
 * own `patchDocument` with no patches.
 */
export async function prefillPackagePageNumbers(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  return patchDocument({
    outputType: "uint8array",
    data: bytes,
    patches: {},
    pageNumbers: await loadTocPageNumberEstimator(),
  });
}

function tabLeaderOf(toc: TocOptions): TocTabLeader {
  return toc.tabLeader ?? (toc.dotLeaders === false ? "none" : "dot");
}

type TocEntryContext = {
  style: Style;
  toc: TocOptions;
  minDepth: number;
  maxDepth: number;
  contentWidthTwips: number;
  entryCount: number;
};

function tocFieldStart(index: number, context: TocEntryContext): TextRun[] {
  if (context.toc.mode === "links" || index !== 0) return [];
  const { minDepth, maxDepth, toc } = context;
  const noPageNumbers = toc.pageNumbers === false ? " \\n" : "";
  return [
    fieldRun("begin", {
      instruction: ` TOC \\o "${minDepth}-${maxDepth}" \\h \\z${noPageNumbers} `,
      dirty: !prefillsTocPageNumbers(toc),
    }),
    fieldRun("separate"),
  ];
}

function tocPageNumber(
  heading: TocHeadingEntry,
  toc: TocOptions,
): (TextRun | SimpleField)[] {
  if (toc.mode === "links" || toc.pageNumbers === false) return [];
  return [
    new TextRun({ children: [new Tab()] }),
    new SimpleField(` PAGEREF ${heading.bookmarkId} \\h `, "?"),
  ];
}

function tocEntryLink(
  heading: TocHeadingEntry,
  style: Style,
): InternalHyperlink {
  const { fontSize, bold, italic } = resolveTocEntryStyle(heading.level, style);
  const font = resolveFontFamily(style);
  const language = runLanguage(style);
  return new InternalHyperlink({
    anchor: heading.bookmarkId,
    children: [
      new TextRun({
        text: heading.text,
        size: fontSize,
        bold,
        italics: italic,
        ...(font !== undefined ? { font } : {}),
        ...(language ? { language } : {}),
        rightToLeft: style.direction === "RTL",
      } satisfies IRunOptions),
    ],
  });
}

/**
 * One TOC entry. Native entries take Word's built-in TOC1–TOC9 paragraph
 * style, as Word gives the entries it writes; the direct indent, spacing and
 * run formatting still decide how the cached entry looks.
 */
function tocEntryParagraph(
  heading: TocHeadingEntry,
  index: number,
  context: TocEntryContext,
): Paragraph {
  const { style, toc } = context;
  const native = toc.mode !== "links";
  return new Paragraph({
    ...(native ? { style: `TOC${heading.level}` } : {}),
    tabStops: [
      {
        type: TabStopType.RIGHT,
        position: context.contentWidthTwips,
        leader: tabLeaderOf(toc),
      },
    ],
    children: [
      ...tocFieldStart(index, context),
      tocEntryLink(heading, style),
      ...tocPageNumber(heading, toc),
      ...(native && index === context.entryCount - 1 ? [fieldRun("end")] : []),
    ],
    indent: { left: (heading.level - context.minDepth) * 400 },
    spacing: { after: 120 },
    bidirectional: style.direction === "RTL",
  });
}

export function buildTocContent(
  headings: TocHeadingEntry[],
  style: Style,
  tocOptions: TocOptions = {},
  contentWidthTwips = 9000,
): Paragraph[] {
  const minDepth = tocOptions.minDepth ?? 1;
  const maxDepth = tocOptions.maxDepth ?? 6;
  const filteredHeadings = headings.filter(
    (heading) => heading.level >= minDepth && heading.level <= maxDepth,
  );

  if (filteredHeadings.length === 0) {
    return [];
  }

  const tocContent: Paragraph[] = [];
  const tocTitle = tocOptions.title ?? "Table of Contents";
  if (tocTitle.length > 0) {
    tocContent.push(
      new Paragraph({
        text: tocTitle,
        style: "TOCHeading",
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        bidirectional: style.direction === "RTL",
      }),
    );
  }

  const context: TocEntryContext = {
    style,
    toc: tocOptions,
    minDepth,
    maxDepth,
    contentWidthTwips,
    entryCount: filteredHeadings.length,
  };
  filteredHeadings.forEach((heading, index) => {
    tocContent.push(tocEntryParagraph(heading, index, context));
  });

  return tocContent;
}

export function replaceTocPlaceholders(
  children: (Paragraph | Table)[],
  tocContent: Paragraph[],
  tocInserted: boolean,
  tocPlaceholders: WeakSet<object>,
): { children: (Paragraph | Table)[]; tocInserted: boolean } {
  const nextChildren: (Paragraph | Table)[] = [];
  let inserted = tocInserted;

  children.forEach((child) => {
    if (tocPlaceholders.has(child)) {
      if (tocContent.length > 0 && !inserted) {
        nextChildren.push(...tocContent);
        inserted = true;
      }
      return;
    }

    nextChildren.push(child);
  });

  return { children: nextChildren, tocInserted: inserted };
}
