import { AlignmentType, IStylesOptions } from "docx";
import { Style } from "./types.js";
import { resolveFontFamily } from "./utils/styleUtils.js";
import { runLanguage } from "./accessibility.js";

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
  return Math.max(1, style.titleSize - (level - 1) * 4);
}

/**
 * Customizes docx's built-in style definitions instead of appending a second
 * style with the same ID. Duplicate style IDs are invalid WordprocessingML
 * and also make generated documents unsafe to reuse as reference DOCX input.
 */
export function buildDefaultStyles(
  style: Style,
): NonNullable<IStylesOptions["default"]> {
  const font = resolveFontFamily(style);

  const headingStyles = HEADING_SPACING.map(
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
          language: runLanguage(style),
          ...(style.direction === "RTL" ? { rightToLeft: true } : {}),
        },
        paragraph: {
          spacing: { before: spacing.before, after: spacing.after },
          outlineLevel: level,
        },
      };
    }
  );

  return {
    ...(style.language || style.direction === "RTL"
      ? {
          document: {
            run: {
              ...(style.language ? { language: runLanguage(style) } : {}),
              ...(style.direction === "RTL" ? { rightToLeft: true } : {}),
            },
          },
        }
      : {}),
    title: {
      run: {
        size: style.titleSize,
        bold: true,
        color: "000000",
        font,
        language: runLanguage(style),
        ...(style.direction === "RTL" ? { rightToLeft: true } : {}),
      },
      paragraph: {
        spacing: {
          after: 240,
          line: style.lineSpacing * 240,
        },
        alignment: AlignmentType.CENTER,
      },
    },
    ...Object.fromEntries(
      headingStyles.map((heading, index) => [`heading${index + 1}`, heading]),
    ),
    strong: {
      run: {
        bold: true,
        font,
        language: runLanguage(style),
        ...(style.direction === "RTL" ? { rightToLeft: true } : {}),
      },
    },
  };
}
