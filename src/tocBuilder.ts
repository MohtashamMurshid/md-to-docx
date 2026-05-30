import {
  Paragraph,
  Table,
  TextRun,
  AlignmentType,
  InternalHyperlink,
} from "docx";
import { Style, TocOptions } from "./types.js";
import { resolveFontFamily } from "./utils/styleUtils.js";

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
  style: Style
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

export function buildTocContent(
  headings: TocHeadingEntry[],
  style: Style,
  tocOptions: TocOptions = {}
): Paragraph[] {
  const tocContent: Paragraph[] = [];
  const minDepth = tocOptions.minDepth ?? 1;
  const maxDepth = tocOptions.maxDepth ?? 6;
  const filteredHeadings = headings.filter(
    (heading) => heading.level >= minDepth && heading.level <= maxDepth
  );

  if (filteredHeadings.length === 0) {
    return tocContent;
  }

  const tocTitle = tocOptions.title ?? "Table of Contents";
  if (tocTitle.length > 0) {
    tocContent.push(
      new Paragraph({
        text: tocTitle,
        heading: "Heading1",
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        bidirectional: style.direction === "RTL",
      })
    );
  }

  filteredHeadings.forEach((heading) => {
    const { fontSize, bold, italic } = resolveTocEntryStyle(heading.level, style);

    tocContent.push(
      new Paragraph({
        children: [
          new InternalHyperlink({
            anchor: heading.bookmarkId,
            children: [
              new TextRun({
                text: heading.text,
                size: fontSize,
                bold,
                italics: italic,
                font: resolveFontFamily(style),
              }),
            ],
          }),
        ],
        indent: { left: (heading.level - minDepth) * 400 },
        spacing: { after: 120 },
        bidirectional: style.direction === "RTL",
      })
    );
  });

  return tocContent;
}

export function replaceTocPlaceholders(
  children: (Paragraph | Table)[],
  tocContent: Paragraph[],
  tocInserted: boolean,
  tocPlaceholders: WeakSet<object>
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
