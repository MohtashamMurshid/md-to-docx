import {
  Document,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  PageOrientation,
  TableLayoutType,
  WidthType,
  Packer,
} from "docx";
import { saveAs } from "file-saver";

export interface Style {
  titleSize: number;
  headingSpacing: number;
  paragraphSpacing: number;
  lineSpacing: number;
}

export interface Options {
  documentType?: "document" | "report";
  style?: Style;
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

const defaultStyle: Style = {
  titleSize: 32,
  headingSpacing: 240,
  paragraphSpacing: 240,
  lineSpacing: 1.15,
};

/**
 * Convert Markdown to Docx
 * @param markdown - The Markdown string to convert
 * @param options - The options for the conversion
 * @returns A Promise that resolves to a Blob containing the Docx file
 */
export async function convertMarkdownToDocx(
  markdown: string,
  options: Options = {}
): Promise<Blob> {
  const { documentType = "document", style = defaultStyle } = options;
  const lines = markdown.split("\n");
  const docChildren = [];
  let inList = false;
  let listItems: Paragraph[] = [];
  let tableIndex = 0;
  const tables: TableData[] = [];

  // First pass: collect tables
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      if (i + 1 < lines.length && lines[i + 1].includes("|-")) {
        const headers = line
          .split("|")
          .filter(Boolean)
          .map((h) => h.trim());
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim().startsWith("|")) {
          const row = lines[j]
            .split("|")
            .filter(Boolean)
            .map((cell) => cell.trim());
          rows.push(row);
          j++;
        }
        tables.push({ headers, rows });
      }
    }
  }

  // Second pass: process content
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) {
      if (inList && listItems.length > 0) {
        docChildren.push(...listItems);
        listItems = [];
        inList = false;
      }
      docChildren.push(new Paragraph({}));
      continue;
    }

    // Handle headings with appropriate spacing
    if (line.startsWith("# ")) {
      if (inList) {
        docChildren.push(...listItems);
        listItems = [];
        inList = false;
      }

      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.replace("# ", ""),
              bold: true,
              size: style.titleSize,
              color: "000000",
            }),
          ],
          heading: HeadingLevel.HEADING_1,
          spacing: {
            before: style.headingSpacing * 2,
            after: style.headingSpacing,
          },
          alignment: AlignmentType.CENTER,
          style: documentType === "report" ? "Title" : undefined,
        })
      );
      continue;
    }

    if (line.startsWith("## ")) {
      if (inList) {
        docChildren.push(...listItems);
        listItems = [];
        inList = false;
      }

      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.replace("## ", ""),
              bold: true,
              size: 28,
              color: "000000",
            }),
          ],
          heading: HeadingLevel.HEADING_2,
          spacing: {
            before: style.headingSpacing,
            after: style.headingSpacing / 2,
          },
          style: documentType === "report" ? "Heading2" : undefined,
        })
      );
      continue;
    }

    if (line.startsWith("### ")) {
      if (inList) {
        docChildren.push(...listItems);
        listItems = [];
        inList = false;
      }

      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.replace("### ", ""),
              bold: true,
              size: 24,
              color: "000000",
            }),
          ],
          heading: HeadingLevel.HEADING_3,
          spacing: {
            before: style.headingSpacing,
            after: style.headingSpacing / 2,
          },
        })
      );
      continue;
    }
    if (line.startsWith("#### ")) {
      if (inList) {
        docChildren.push(...listItems);
        listItems = [];
        inList = false;
      }

      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.replace("#### ", ""),
              bold: true,
              size: 20,
              color: "000000",
            }),
          ],
          heading: HeadingLevel.HEADING_4,
          spacing: {
            before: style.headingSpacing,
            after: style.headingSpacing / 2,
          },
        })
      );
      continue;
    }

    if (line.startsWith("##### ")) {
      if (inList) {
        docChildren.push(...listItems);
        listItems = [];
        inList = false;
      }

      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.replace("##### ", ""),
              bold: true,
              size: 18,
              color: "000000",
            }),
          ],
          heading: HeadingLevel.HEADING_5,
          spacing: {
            before: style.headingSpacing,
            after: style.headingSpacing / 2,
          },
        })
      );
      continue;
    }

    // Handle tables
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      if (i + 1 < lines.length && lines[i + 1].includes("|-")) {
        if (inList) {
          docChildren.push(...listItems);
          listItems = [];
          inList = false;
        }

        if (tableIndex < tables.length) {
          const currentTable = tables[tableIndex];

          // Create the table
          const table = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              // Header row
              new TableRow({
                tableHeader: true,
                children: currentTable.headers.map(
                  (header) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          text: header,
                          alignment: AlignmentType.CENTER,
                          style: "Strong",
                          children: [
                            new TextRun({
                              text: header,
                              bold: true,
                              color: "000000",
                            }),
                          ],
                        }),
                      ],
                      shading: {
                        fill: documentType === "report" ? "DDDDDD" : "F2F2F2",
                      },
                    })
                ),
              }),
              // Data rows
              ...currentTable.rows.map(
                (row) =>
                  new TableRow({
                    children: row.map(
                      (cell) =>
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [
                                new TextRun({
                                  text: cell,
                                  color: "000000",
                                }),
                              ],
                            }),
                          ],
                        })
                    ),
                  })
              ),
            ],
            layout: TableLayoutType.FIXED,
            margins: {
              top: 100,
              bottom: 100,
              left: 100,
              right: 100,
            },
          });

          docChildren.push(table);

          // Skip the table rows in the main processing
          const tableRowCount = 2 + currentTable.rows.length; // header + separator + data rows
          i += tableRowCount - 1; // -1 because the loop will increment i
          tableIndex++;
          continue;
        }
      }
    }

    // Handle lists with bullets
    if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
      inList = true;
      const listText = line.replace(/^[\s-*]+/, "").trim();

      // Check if there's a bold section on the next line
      let boldText = "";
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith("**")) {
        boldText = lines[i + 1].trim().replace(/\*\*/g, "");
        i++; // Skip the next line since we've processed it
      }

      listItems.push(
        new Paragraph({
          children: [
            new TextRun({
              text: listText + (boldText ? "\n" : ""),
              color: "000000",
            }),
            ...(boldText
              ? [
                  new TextRun({
                    text: boldText,
                    bold: true,
                    color: "000000",
                  }),
                ]
              : []),
          ],
          bullet: {
            level: 0,
          },
          spacing: {
            before: style.paragraphSpacing / 2,
            after: style.paragraphSpacing / 2,
          },
        })
      );
      continue;
    }

    // Handle numbered lists
    if (/^\s*\d+\.\s/.test(line)) {
      inList = true;
      const listText = line.replace(/^\s*\d+\.\s/, "").trim();

      listItems.push(
        new Paragraph({
          children: [
            new TextRun({
              text: listText,
              color: "000000",
            }),
          ],
          bullet: {
            level: 0,
          },
          spacing: {
            before: style.paragraphSpacing / 2,
            after: style.paragraphSpacing / 2,
          },
        })
      );
      continue;
    }

    // Handle blockquotes
    if (line.trim().startsWith("> ")) {
      if (inList) {
        docChildren.push(...listItems);
        listItems = [];
        inList = false;
      }

      const quoteText = line.replace(/^>\s*/, "").trim();
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: quoteText,
              italics: true,
              color: "000000",
            }),
          ],
          indent: {
            left: 720, // 0.5 inch indent
          },
          spacing: {
            before: style.paragraphSpacing,
            after: style.paragraphSpacing,
          },
          border: {
            left: {
              style: BorderStyle.SINGLE,
              size: 3,
              color: "AAAAAA",
            },
          },
        })
      );
      continue;
    }

    // Handle comments
    if (line.trim().startsWith("COMMENT:")) {
      if (inList) {
        docChildren.push(...listItems);
        listItems = [];
        inList = false;
      }

      const commentText = line.replace(/^COMMENT:\s*/, "").trim();
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "Comment: " + commentText,
              italics: true,
              color: "666666",
            }),
          ],
          spacing: {
            before: style.paragraphSpacing,
            after: style.paragraphSpacing,
          },
        })
      );
      continue;
    }

    // Handle table names (prevent duplication)
    if (line.startsWith("### Table")) {
      if (inList) {
        docChildren.push(...listItems);
        listItems = [];
        inList = false;
      }

      // Remove any duplicate words in the table title
      const titleParts = line.replace("### ", "").split(":");
      if (titleParts.length === 2) {
        const tableName = titleParts[0].trim();
        const tableDesc = titleParts[1].trim();

        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: tableName + ": " + tableDesc,
                bold: true,
                size: 24,
                color: "000000",
              }),
            ],
            heading: HeadingLevel.HEADING_3,
            spacing: {
              before: style.headingSpacing,
              after: style.headingSpacing / 2,
            },
          })
        );
        continue;
      }
    }

    // Regular paragraph text with special formatting
    if (!inList) {
      // Split the line for possible formatting (bold, italic)
      const textRuns: TextRun[] = [];
      let currentText = "";
      let isBold = false;
      let isItalic = false;

      for (let j = 0; j < line.length; j++) {
        // Handle bold with ** markers
        if (j + 1 < line.length && line[j] === "*" && line[j + 1] === "*") {
          // Finish current run
          if (currentText) {
            textRuns.push(
              new TextRun({
                text: currentText,
                bold: isBold,
                italics: isItalic,
                color: "000000",
              })
            );
            currentText = "";
          }

          // Toggle bold
          isBold = !isBold;
          j++; // Skip the second *
          continue;
        }

        // Handle italic with single * marker (but not if it's part of **)
        if (
          line[j] === "*" &&
          (j === 0 || line[j - 1] !== "*") &&
          (j === line.length - 1 || line[j + 1] !== "*")
        ) {
          // Finish current run
          if (currentText) {
            textRuns.push(
              new TextRun({
                text: currentText,
                bold: isBold,
                italics: isItalic,
                color: "000000",
              })
            );
            currentText = "";
          }

          // Toggle italic
          isItalic = !isItalic;
          continue;
        }

        // Add to current text
        currentText += line[j];
      }

      // Add any remaining text
      if (currentText) {
        textRuns.push(
          new TextRun({
            text: currentText,
            bold: isBold,
            italics: isItalic,
            color: "000000",
          })
        );
      }

      // Create paragraph with the text runs
      docChildren.push(
        new Paragraph({
          children: textRuns,
          spacing: {
            before: style.paragraphSpacing,
            after: style.paragraphSpacing,
            line: style.lineSpacing * 240, // 240 = 1 line spacing in twips
          },
        })
      );
    }
  }

  // Add any remaining list items
  if (inList && listItems.length > 0) {
    docChildren.push(...listItems);
  }

  // Create the document with appropriate settings for the document type
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440, // 1 inch in twips (1440 twips = 1 inch)
              right: 1080, // 0.75 inch
              bottom: 1440, // 1 inch
              left: 1080, // 0.75 inch
            },
            size: {
              orientation: PageOrientation.PORTRAIT,
            },
          },
        },
        children: docChildren,
      },
    ],
    styles: {
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          run: {
            size: style.titleSize,
            bold: true,
            color: "000000",
          },
          paragraph: {
            spacing: {
              after: 240,
              line: 1.15 * 240,
            },
            alignment: AlignmentType.CENTER,
          },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          run: {
            size: 28,
            bold: true,
            color: "000000",
          },
          paragraph: {
            spacing: {
              before: 360,
              after: 240,
            },
          },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          run: {
            size: 24,
            bold: true,
            color: "000000",
          },
          paragraph: {
            spacing: {
              before: 320,
              after: 160,
            },
          },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          run: {
            size: 22,
            bold: true,
            color: "000000",
          },
          paragraph: {
            spacing: {
              before: 280,
              after: 120,
            },
          },
        },
        {
          id: "Heading4",
          name: "Heading 4",
          run: {
            size: 20,
            bold: true,
            color: "000000",
          },
          paragraph: {
            spacing: {
              before: 240,
              after: 120,
            },
          },
        },
        {
          id: "Heading5",
          name: "Heading 5",
          run: {
            size: 18,
            bold: true,
            color: "000000",
          },
          paragraph: {
            spacing: {
              before: 220,
              after: 100,
            },
          },
        },
        {
          id: "Strong",
          name: "Strong",
          run: {
            bold: true,
          },
        },
      ],
    },
  });

  return await Packer.toBlob(doc);
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
