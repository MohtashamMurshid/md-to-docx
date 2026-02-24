import {
  Document,
  Paragraph,
  TextRun,
  AlignmentType,
  PageOrientation,
  Packer,
  Table,
  PageBreak,
  InternalHyperlink,
  Footer,
  PageNumber,
  LevelFormat,
  IPropertiesOptions,
} from "docx";
import saveAs from "file-saver";
import { Options, Style } from "./types.js";
import { parseMarkdownToAst, applyTextReplacements } from "./markdownAst.js";
import { mdastToDocxModel } from "./mdastToDocxModel.js";
import { modelToDocx } from "./modelToDocx.js";

const defaultStyle: Style = {
  titleSize: 32,
  headingSpacing: 240,
  paragraphSpacing: 240,
  lineSpacing: 1.15,
  paragraphAlignment: "LEFT",
  direction: "LTR",
};

const defaultOptions: Options = {
  documentType: "document",
  style: defaultStyle,
};

export { Options, TableData } from "./types.js";

/**
 * Custom error class for markdown conversion errors
 * @extends Error
 * @param message - The error message
 * @param context - The context of the error
 */
export class MarkdownConversionError extends Error {
  constructor(message: string, public context?: any) {
    super(message);
    this.name = "MarkdownConversionError";
  }
}

function normalizeStyleInput(style?: Partial<Style>): Partial<Style> | undefined {
  if (!style) {
    return style;
  }

  const fontFamily = style.fontFamily || style.fontFamilly;
  if (!fontFamily) {
    return style;
  }

  return {
    ...style,
    fontFamily,
  };
}

/**
 * Validates markdown input and options
 * @throws {MarkdownConversionError} If input is invalid
 */
function validateInput(markdown: string, options: Options): void {
  if (!markdown || typeof markdown !== "string") {
    throw new MarkdownConversionError(
      "Invalid markdown input: Markdown must be a non-empty string"
    );
  }

  const normalizedStyle = normalizeStyleInput(options.style);
  if (normalizedStyle) {
    const { titleSize, headingSpacing, paragraphSpacing, lineSpacing } =
      normalizedStyle;
    if (titleSize && (titleSize < 8 || titleSize > 72)) {
      throw new MarkdownConversionError(
        "Invalid title size: Must be between 8 and 72 points",
        { titleSize }
      );
    }
    if (headingSpacing && (headingSpacing < 0 || headingSpacing > 720)) {
      throw new MarkdownConversionError(
        "Invalid heading spacing: Must be between 0 and 720 twips",
        { headingSpacing }
      );
    }
    if (paragraphSpacing && (paragraphSpacing < 0 || paragraphSpacing > 720)) {
      throw new MarkdownConversionError(
        "Invalid paragraph spacing: Must be between 0 and 720 twips",
        { paragraphSpacing }
      );
    }
    if (lineSpacing && (lineSpacing < 1 || lineSpacing > 3)) {
      throw new MarkdownConversionError(
        "Invalid line spacing: Must be between 1 and 3",
        { lineSpacing }
      );
    }

    if (
      normalizedStyle.fontFamily !== undefined &&
      (typeof normalizedStyle.fontFamily !== "string" ||
        normalizedStyle.fontFamily.trim().length === 0)
    ) {
      throw new MarkdownConversionError(
        "Invalid fontFamily: Must be a non-empty string",
        { fontFamily: normalizedStyle.fontFamily }
      );
    }
  }
}

/**
 * Convert Markdown to Docx file
 * @param markdown - The Markdown string to convert
 * @param options - The options for the conversion
 * @returns A Promise that resolves to a Blob containing the Docx file
 * @throws {MarkdownConversionError} If conversion fails
 */
export async function convertMarkdownToDocx( markdown: string, options: Options = defaultOptions): Promise<Blob>  {
  try {
    
    const docxOptions = await parseToDocxOptions(markdown, options);
    // Create the document with appropriate settings
    const doc = new Document(docxOptions);

    return await Packer.toBlob(doc);

  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }
    throw new MarkdownConversionError(
      `Failed to convert markdown to docx: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { originalError: error }
    );
  }
}
/**
 * Convert Markdown to Docx options
 * @param markdown - The Markdown string to convert
 * @param options - The options for the conversion
 * @returns A Promise that resolves to Docx options
 * @throws {MarkdownConversionError} If conversion fails
 */
export async function parseToDocxOptions (
  markdown: string,
  options: Options = defaultOptions
): Promise<IPropertiesOptions> {
  try {
    // Validate inputs early
    validateInput(markdown, options);

    const { documentType = "document" } = options;
    const normalizedStyle = normalizeStyleInput(options.style);
    // Merge user-provided style with defaults
    const style: Style = { ...defaultStyle, ...normalizedStyle };

    // Parse markdown to AST
    const ast = await parseMarkdownToAst(markdown);

    // Apply text replacements if provided
    if (options.textReplacements && options.textReplacements.length > 0) {
      applyTextReplacements(ast, options.textReplacements);
    }

    // Convert AST to internal model
    const model = mdastToDocxModel(ast, style, options);

    // Convert model to docx objects
    const { children: docChildren, headings, maxSequenceId } = await modelToDocx(model, style, options);

    // Generate TOC content
    const tocContent: Paragraph[] = [];
    if (headings.length > 0) {
      // Optional: Add a title for the TOC
      tocContent.push(
        new Paragraph({
          text: "Table of Contents",
          heading: "Heading1", // Or a specific TOC title style
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          bidirectional: style.direction === "RTL",
        })
      );
      headings.forEach((heading) => {
        // Determine font size based on heading level
        let fontSize;
        let isBold = false;
        let isItalic = false;

        // Apply level-specific styles if provided
        switch (heading.level) {
          case 1:
            fontSize = style.tocHeading1FontSize || style.tocFontSize;
            isBold =
              style.tocHeading1Bold !== undefined
                ? style.tocHeading1Bold
                : true;
            isItalic = style.tocHeading1Italic || false;
            break;
          case 2:
            fontSize = style.tocHeading2FontSize || style.tocFontSize;
            isBold =
              style.tocHeading2Bold !== undefined
                ? style.tocHeading2Bold
                : false;
            isItalic = style.tocHeading2Italic || false;
            break;
          case 3:
            fontSize = style.tocHeading3FontSize || style.tocFontSize;
            isBold = style.tocHeading3Bold || false;
            isItalic = style.tocHeading3Italic || false;
            break;
          case 4:
            fontSize = style.tocHeading4FontSize || style.tocFontSize;
            isBold = style.tocHeading4Bold || false;
            isItalic = style.tocHeading4Italic || false;
            break;
          case 5:
            fontSize = style.tocHeading5FontSize || style.tocFontSize;
            isBold = style.tocHeading5Bold || false;
            isItalic = style.tocHeading5Italic || false;
            break;
          default:
            fontSize = style.tocFontSize;
        }

        // Use default calculation if no specific size provided
        if (!fontSize) {
          fontSize = style.paragraphSize
            ? style.paragraphSize - (heading.level - 1) * 2
            : 24 - (heading.level - 1) * 2;
        }

        tocContent.push(
          new Paragraph({
            children: [
              new InternalHyperlink({
                anchor: heading.bookmarkId,
                children: [
                  new TextRun({
                    text: heading.text,
                    size: fontSize,
                    bold: isBold,
                    italics: isItalic,
                    font: style.fontFamily,
                  }),
                ],
              }),
            ],
            // Indentation based on heading level
            indent: { left: (heading.level - 1) * 400 },
            spacing: { after: 120 }, // Spacing between TOC items
            bidirectional: style.direction === "RTL",
          })
        );
      });
    }

    // Replace placeholder with TOC content
    const finalDocChildren: (Paragraph | Table)[] = [];
    let tocInserted = false;
    docChildren.forEach((child) => {
      // Check for the marker property instead of inspecting content
      if ((child as any).__isTocPlaceholder === true) {
        if (tocContent.length > 0 && !tocInserted) {
          finalDocChildren.push(...tocContent);
          tocInserted = true; // Ensure TOC is inserted only once
        } else {
          // If no headings were found or TOC already inserted, remove placeholder
          console.warn(
            "TOC placeholder found, but no headings collected or TOC already inserted."
          );
        }
      } else {
        finalDocChildren.push(child);
      }
    });

    // Create numbering configurations for all numbered list sequences
    const numberingConfigs = [];
    for (let i = 1; i <= maxSequenceId; i++) {
      numberingConfigs.push({
        reference: `numbered-list-${i}`,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 260 },
              },
            },
          },
        ],
      });
    }

    // Create the document with appropriate settings
    const docxOptions: IPropertiesOptions = {
      numbering: {
        config: numberingConfigs,
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440,
                right: 1080,
                bottom: 1440,
                left: 1080,
              },
              size: {
                orientation: PageOrientation.PORTRAIT,
              },
            },
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      children: [PageNumber.CURRENT],
                    }),
                  ],
                }),
              ],
            }),
          },
          children: finalDocChildren,
        },
      ],
      styles: {
        paragraphStyles: [
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
              font: style.fontFamily,
            },
            paragraph: {
              spacing: {
                after: 240,
                line: style.lineSpacing * 240,
              },
              alignment: AlignmentType.CENTER,
            },
          },
          {
            id: "Heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize,
              bold: true,
              color: "000000",
              font: style.fontFamily,
            },
            paragraph: {
              spacing: {
                before: 360,
                after: 240,
              },
              outlineLevel: 1,
            },
          },
          {
            id: "Heading2",
            name: "Heading 2",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize - 4,
              bold: true,
              color: "000000",
              font: style.fontFamily,
            },
            paragraph: {
              spacing: {
                before: 320,
                after: 160,
              },
              outlineLevel: 2,
            },
          },
          {
            id: "Heading3",
            name: "Heading 3",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize - 8,
              bold: true,
              color: "000000",
              font: style.fontFamily,
            },
            paragraph: {
              spacing: {
                before: 280,
                after: 120,
              },
              outlineLevel: 3,
            },
          },
          {
            id: "Heading4",
            name: "Heading 4",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize - 12,
              bold: true,
              color: "000000",
              font: style.fontFamily,
            },
            paragraph: {
              spacing: {
                before: 240,
                after: 120,
              },
              outlineLevel: 4,
            },
          },
          {
            id: "Heading5",
            name: "Heading 5",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize - 16,
              bold: true,
              color: "000000",
              font: style.fontFamily,
            },
            paragraph: {
              spacing: {
                before: 220,
                after: 100,
              },
              outlineLevel: 5,
            },
          },
          {
            id: "Strong",
            name: "Strong",
            run: {
              bold: true,
              font: style.fontFamily,
            },
          },
        ],
      },
    };

    return docxOptions;
  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }
    throw new MarkdownConversionError(
      `Failed to convert markdown to docx: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { originalError: error }
    );
  }
}

/**
 * Downloads a DOCX file in the browser environment
 * @param blob - The Blob containing the DOCX file data
 * @param filename - The name to save the file as (defaults to "document.docx")
 * @throws {Error} If the function is called outside browser environment
 * @throws {Error} If invalid blob or filename is provided
 * @throws {Error} If file save fails
 */
export function downloadDocx(
  blob: Blob,
  filename: string = "document.docx"
): void {
  if (typeof window === "undefined") {
    throw new Error("This function can only be used in browser environments");
  }
  if (!(blob instanceof Blob)) {
    throw new Error("Invalid blob provided");
  }
  if (!filename || typeof filename !== "string") {
    throw new Error("Invalid filename provided");
  }
  try {
    saveAs(blob, filename);
  } catch (error) {
    console.error("Failed to save file:", error);
    throw new Error(
      `Failed to save file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
