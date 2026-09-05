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
  LeaderType,
} from "docx";
import { Style, TocOptions } from "./types.js";
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
  protected readonly xmlKeys = {
    type: "w:fldCharType",
    dirty: "w:dirty",
    space: "xml:space",
  };
}

class FieldElement extends XmlComponent {
  attributes(value: FieldAttributes): void {
    this.root.push(value);
  }
}

function fieldRun(
  type: "begin" | "separate" | "end",
  instruction?: string,
): TextRun {
  const run = new TextRun({});
  const field = new FieldElement("w:fldChar");
  field.attributes(
    new FieldAttributes({
      type,
      ...(type === "begin" ? { dirty: "true" } : {}),
    }),
  );
  run.addChildElement(field);
  if (instruction) {
    const text = new FieldElement("w:instrText");
    text.attributes(new FieldAttributes({ space: "preserve" }));
    text.addChildElement(instruction);
    run.addChildElement(text);
  }
  return run;
}

export function buildTocContent(
  headings: TocHeadingEntry[],
  style: Style,
  tocOptions: TocOptions = {},
  contentWidthTwips = 9000,
): Paragraph[] {
  const tocContent: Paragraph[] = [];
  const minDepth = tocOptions.minDepth ?? 1;
  const maxDepth = tocOptions.maxDepth ?? 6;
  const filteredHeadings = headings.filter(
    (heading) => heading.level >= minDepth && heading.level <= maxDepth,
  );

  if (filteredHeadings.length === 0) {
    return tocContent;
  }

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

  const native = tocOptions.mode !== "links";
  filteredHeadings.forEach((heading, index) => {
    const { fontSize, bold, italic } = resolveTocEntryStyle(
      heading.level,
      style,
    );

    tocContent.push(
      new Paragraph({
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: contentWidthTwips,
            leader:
              tocOptions.dotLeaders === false
                ? LeaderType.NONE
                : LeaderType.DOT,
          },
        ],
        children: [
          ...(native && index === 0
            ? [
                fieldRun(
                  "begin",
                  ` TOC \\o "${minDepth}-${maxDepth}" \\h \\z${tocOptions.pageNumbers === false ? " \\n" : ""} `,
                ),
                fieldRun("separate"),
              ]
            : []),
          new InternalHyperlink({
            anchor: heading.bookmarkId,
            children: [
              new TextRun({
                text: heading.text,
                size: fontSize,
                bold,
                italics: italic,
                font: resolveFontFamily(style),
                language: runLanguage(style),
                rightToLeft: style.direction === "RTL",
              }),
            ],
          }),
          ...(native && tocOptions.pageNumbers !== false
            ? [
                new TextRun({ children: [new Tab()] }),
                new SimpleField(` PAGEREF ${heading.bookmarkId} \\h `, "?"),
              ]
            : []),
          ...(native && index === filteredHeadings.length - 1
            ? [fieldRun("end")]
            : []),
        ],
        indent: { left: (heading.level - minDepth) * 400 },
        spacing: { after: 120 },
        bidirectional: style.direction === "RTL",
      }),
    );
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
