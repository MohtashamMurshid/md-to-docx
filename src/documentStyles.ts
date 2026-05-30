import { AlignmentType, IParagraphStyleOptions } from "docx";
import { Style } from "./types.js";
import { resolveFontFamily } from "./utils/styleUtils.js";

const HEADING_SPACING: { before: number; after: number }[] = [
  { before: 360, after: 240 },
  { before: 320, after: 160 },
  { before: 280, after: 120 },
  { before: 240, after: 120 },
  { before: 220, after: 100 },
  { before: 200, after: 100 },
];

function headingRunSize(level: number, style: Style): number {
  if (level === 6) {
    return Math.max(1, style.heading6Size ?? style.titleSize - 20);
  }
  return style.titleSize - (level - 1) * 4;
}

/**
 * Builds the paragraph style definitions (Title, Heading1-6, Strong) shared
 * by every generated document. Heading styles only differ by font size and
 * spacing, so they are generated from a small table.
 */
export function buildParagraphStyles(style: Style): IParagraphStyleOptions[] {
  const font = resolveFontFamily(style);

  const headingStyles: IParagraphStyleOptions[] = HEADING_SPACING.map(
    (spacing, index) => {
      const level = index + 1;
      return {
        id: `Heading${level}`,
        name: `Heading ${level}`,
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: {
          size: headingRunSize(level, style),
          bold: true,
          color: "000000",
          font,
        },
        paragraph: {
          spacing: { before: spacing.before, after: spacing.after },
          outlineLevel: level,
        },
      };
    }
  );

  return [
    {
      id: "Title",
      name: "Title",
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      run: {
        size: style.titleSize,
        bold: true,
        color: "000000",
        font,
      },
      paragraph: {
        spacing: {
          after: 240,
          line: style.lineSpacing * 240,
        },
        alignment: AlignmentType.CENTER,
      },
    },
    ...headingStyles,
    {
      id: "Strong",
      name: "Strong",
      run: {
        bold: true,
        font,
      },
    },
  ];
}
