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
  Header,
  PageNumber,
} from "docx";
import saveAs from "file-saver";
import { Options, Style, headingConfigs } from "./types";
import {
  processHeading,
  processTable,
  processListItem,
  processBlockquote,
  processComment,
  processFormattedText,
  collectTables,
  processCodeBlock,
  processLink,
  processLinkParagraph,
  processImage,
  processParagraph,
} from "./helpers";

const defaultStyle: Style = {
  font: "Calibri",
  titleSize: 32,
  headingSpacing: 240,
  paragraphSpacing: 240,
  lineSpacing: 1.15,
  paragraphAlignment: "LEFT",
};

const defaultOptions: Options = {
  documentType: "document",
  style: defaultStyle,
};

export { Options, TableData } from "./types";

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

  if (options.style) {
    const { titleSize, headingSpacing, paragraphSpacing, lineSpacing } =
      options.style;
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
  }
}

/**
 * Convert Markdown to Docx
 * @param markdown - The Markdown string to convert
 * @param options - The options for the conversion
 * @returns A Promise that resolves to a Blob containing the Docx file
 * @throws {MarkdownConversionError} If conversion fails
 */
export async function convertMarkdownToDocx(
  markdown: string,
  options: Options = defaultOptions
): Promise<Blob> {
  try {
    const { style = defaultStyle, documentType = "document" } = options;
    const docChildren: (Paragraph | Table)[] = [];
    const headings: { text: string; level: number; bookmarkId: string }[] = [];
    const lines = markdown.split("\n");
    let inList = false;
    let listItems: Paragraph[] = [];
    let inCodeBlock = false;
    let codeBlockContent = "";
    let codeBlockLanguage: string | undefined;
    let tableIndex = 0;
    const tables = collectTables(lines);

    for (let i = 0; i < lines.length; i++) {
      try {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Skip empty lines
        if (!trimmedLine) {
          if (inCodeBlock) {
            codeBlockContent += "\n";
          }
          if (inList) {
            docChildren.push(...listItems);
            listItems = [];
            inList = false;
          }
          docChildren.push(new Paragraph({}));
          continue;
        }

        // Handle Page Break
        if (trimmedLine === "\\pagebreak") {
          if (inList) {
            docChildren.push(...listItems);
            listItems = [];
            inList = false;
          }
          docChildren.push(new Paragraph({ children: [new PageBreak()] }));
          continue;
        }

        // Handle TOC Placeholder
        if (trimmedLine === "[TOC]") {
          if (inList) {
            docChildren.push(...listItems);
            listItems = [];
            inList = false;
          }
          // Create a paragraph and add a unique property to identify it later
          const tocPlaceholder = new Paragraph({});
          (tocPlaceholder as any).__isTocPlaceholder = true; // Add temporary marker property
          docChildren.push(tocPlaceholder);
          continue;
        }

        // Handle code blocks
        if (trimmedLine.startsWith("```")) {
          if (!inCodeBlock) {
            // Start of code block
            inCodeBlock = true;
            codeBlockLanguage = trimmedLine.slice(3).trim() || undefined;
            codeBlockContent = "";
          } else {
            // End of code block
            inCodeBlock = false;
            docChildren.push(
              processCodeBlock(
                codeBlockContent.trim(),
                codeBlockLanguage,
                style
              )
            );
            codeBlockContent = "";
            codeBlockLanguage = undefined;
          }
          continue;
        }

        if (inCodeBlock) {
          codeBlockContent += (codeBlockContent ? "\n" : "") + line;
          continue;
        }

        // Process headings
        if (trimmedLine.startsWith("#")) {
          const match = trimmedLine.match(/^#+/);
          if (match) {
            const level = match[0].length;
            if (level >= 1 && level <= 5) {
              if (inList) {
                docChildren.push(...listItems);
                listItems = [];
                inList = false;
              }
              const headingText = trimmedLine.substring(level).trim();
              const config = {
                ...headingConfigs[level],
                alignment:
                  headingConfigs[level].alignment || style.headingAlignment,
              };
              const { paragraph: headingParagraph, bookmarkId } =
                processHeading(trimmedLine, config, style, documentType);
              headings.push({ text: headingText, level, bookmarkId });

              docChildren.push(headingParagraph);
              continue;
            }
            // Graceful degradation for unsupported heading levels
            console.warn(
              `Warning: Heading level ${level} is not supported. Converting to regular paragraph.`
            );
          }
        }

        // Handle tables
        if (trimmedLine.startsWith("|") && trimmedLine.endsWith("|")) {
          if (i + 1 < lines.length && lines[i + 1].includes("|-")) {
            if (inList) {
              docChildren.push(...listItems);
              listItems = [];
              inList = false;
            }

            if (tableIndex < tables.length) {
              try {
                docChildren.push(
                  processTable(tables[tableIndex], documentType)
                );
                const tableRowCount = 2 + tables[tableIndex].rows.length;
                i += tableRowCount - 1;
                tableIndex++;
                continue;
              } catch (error) {
                console.warn(
                  `Warning: Failed to process table at line ${i + 1
                  }. Converting to regular text.`
                );
                // Fallback to regular text
                docChildren.push(
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: trimmedLine.replace(/\|/g, "").trim(),
                        color: "000000",
                        font: style.font,
                      }),
                    ],
                  })
                );
                continue;
              }
            }
          }
        }

        // Handle lists
        if (trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ")) {
          inList = true;
          const listText = trimmedLine.replace(/^[\s-*]+/, "").trim();

          // Check if there's a bold section on the next line
          let boldText = "";
          if (
            i + 1 < lines.length &&
            lines[i + 1].trim().startsWith("**") &&
            lines[i + 1].trim().endsWith("**")
          ) {
            boldText = lines[i + 1].trim().slice(2, -2); // Remove ** markers
            i++;
          }

          listItems.push(processListItem({ text: listText, boldText }, style));
          continue;
        }

        // Handle numbered lists
        if (/^\s*\d+\.\s/.test(trimmedLine)) {
          inList = true;
          const listText = trimmedLine.replace(/^\s*\d+\.\s/, "").trim();
          listItems.push(
            processListItem({ text: listText, isNumbered: true }, style)
          );
          continue;
        }

        // Handle blockquotes
        if (trimmedLine.startsWith("> ")) {
          if (inList) {
            docChildren.push(...listItems);
            listItems = [];
            inList = false;
          }
          const quoteText = trimmedLine.replace(/^>\s*/, "").trim();
          docChildren.push(processBlockquote(quoteText, style));
          continue;
        }

        // Handle comments
        if (trimmedLine.startsWith("COMMENT:")) {
          if (inList) {
            docChildren.push(...listItems);
            listItems = [];
            inList = false;
          }
          const commentText = trimmedLine.replace(/^COMMENT:\s*/, "").trim();
          docChildren.push(processComment(commentText, style));
          continue;
        }

        // Handle images
        const imageMatch = trimmedLine.match(/!\[([^\]]*)\]\(([^)]+)\)/);
        if (imageMatch) {
          const [_, altText, imageUrl] = imageMatch;
          console.log(`Found image in markdown: ${imageUrl}`);

          // Process images synchronously to ensure they're fully loaded
          try {
            console.log(`Starting image processing for: ${imageUrl}`);
            const imageParagraphs = await processImage(
              altText,
              imageUrl,
              style
            );
            console.log(
              `Successfully processed image, adding ${imageParagraphs.length} paragraphs`
            );
            docChildren.push(...imageParagraphs);
          } catch (error) {
            console.error(
              `Error in image processing: ${error instanceof Error ? error.message : String(error)
              }`
            );
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `[Image could not be loaded: ${altText}]`,
                    italics: true,
                    color: "FF0000",
                    font: style.font,
                  }),
                ],
                alignment: AlignmentType.CENTER,
              })
            );
          }
          continue;
        }

        // Handle links - make sure this is after image handling
        const linkMatch = trimmedLine.match(
          /^(?!.*!\[).*\[([^\]]+)\]\(([^)]+)\)/
        );
        if (linkMatch) {
          const [_, text, url] = linkMatch;
          docChildren.push(processLinkParagraph(text, url, style));
          continue;
        }

        // Regular paragraph text with special formatting (use trimmedLine for processing)
        if (!inList) {
          try {
            docChildren.push(processParagraph(trimmedLine, style));
          } catch (error) {
            // Fallback to plain text if formatting fails
            console.warn(
              `Warning: Failed to process text formatting at line ${i + 1}: ${error instanceof Error ? error.message : String(error)
              }. Using plain text.`
            );
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: trimmedLine,
                    color: "000000",
                    size: style.paragraphSize || 24,
                    font: style.font,
                  }),
                ],
                spacing: {
                  before: style.paragraphSpacing,
                  after: style.paragraphSpacing,
                  line: style.lineSpacing * 240,
                },
                alignment: style.paragraphAlignment
                  ? (AlignmentType as any)[style.paragraphAlignment]
                  : undefined,
              })
            );
          }
          continue;
        }

        // Removed the fallback 'isContinuation' list item processing as it was causing type errors
        // and needs a more robust implementation if required.
      } catch (error) {
        // Log error and continue with next line
        console.warn(
          `Warning: Failed to process line ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"
          }. Skipping line.`
        );
        continue;
      }
    }

    // Handle any remaining code block
    if (inCodeBlock && codeBlockContent) {
      docChildren.push(
        processCodeBlock(codeBlockContent.trim(), codeBlockLanguage, style)
      );
    }

    // Add any remaining list items
    if (inList && listItems.length > 0) {
      docChildren.push(...listItems);
    }

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
        })
      );
      headings.forEach((heading) => {
        tocContent.push(
          new Paragraph({
            children: [
              new InternalHyperlink({
                anchor: heading.bookmarkId,
                children: [
                  new TextRun({
                    text: heading.text,
                    font: style.font,
                  }),
                ],
              }),
            ],
            indent: { left: (heading.level - 1) * 400 },
            spacing: { after: 120 },
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

    // Create the document with appropriate settings
    const doc = new Document({
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
                      font: style.font
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
            name: 'Normal',
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize,
              bold: true,
              color: "000000",
              font: style.font
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
            name: 'Normal',
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: style.titleSize,
              bold: true,
              color: "000000",
              font: style.font
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
              font: style.font
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
              font: style.font
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
              font: style.font
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
              font: style.font
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
              font: style.font
            },
          },
        ],
      },
    });

    return await Packer.toBlob(doc);
  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }
    throw new MarkdownConversionError(
      `Failed to convert markdown to docx: ${error instanceof Error ? error.message : "Unknown error"
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
      `Failed to save file: ${error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
