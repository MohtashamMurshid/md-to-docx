import {
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  TableLayoutType,
  WidthType,
  ExternalHyperlink,
  ImageRun,
} from "docx";
import { Style, TableData, HeadingConfig, ListItemConfig } from "./types";

/**
 * Processes a heading line and returns appropriate paragraph formatting
 * @param line - The heading line to process
 * @param config - The heading configuration
 * @param style - The style configuration
 * @param documentType - The document type
 * @returns The processed paragraph
 */
export function processHeading(
  line: string,
  config: HeadingConfig,
  style: Style,
  documentType: "document" | "report"
): Paragraph {
  const headingText = line.replace(new RegExp(`^#{${config.level}} `), "");
  const headingLevel = config.level;

  // Get the appropriate font size based on heading level and custom style
  let headingSize = style.titleSize;

  // Use specific heading size if provided, otherwise calculate based on level
  if (headingLevel === 1 && style.heading1Size) {
    headingSize = style.heading1Size;
  } else if (headingLevel === 2 && style.heading2Size) {
    headingSize = style.heading2Size;
  } else if (headingLevel === 3 && style.heading3Size) {
    headingSize = style.heading3Size;
  } else if (headingLevel === 4 && style.heading4Size) {
    headingSize = style.heading4Size;
  } else if (headingLevel === 5 && style.heading5Size) {
    headingSize = style.heading5Size;
  } else if (headingLevel > 1) {
    // Fallback calculation if specific size not provided
    headingSize = style.titleSize - (headingLevel - 1) * 4;
  }

  // Determine alignment directly from config or style
  let alignment;

  // Check if a specific alignment is defined in the config
  if (config.alignment) {
    // Map string alignment to AlignmentType
    if (config.alignment === "CENTER") {
      alignment = AlignmentType.CENTER;
    } else if (config.alignment === "RIGHT") {
      alignment = AlignmentType.RIGHT;
    } else if (config.alignment === "JUSTIFIED") {
      alignment = AlignmentType.JUSTIFIED;
    } else if (config.alignment === "LEFT") {
      alignment = AlignmentType.LEFT;
    }
  }
  // Otherwise check if the style provides a default for headings
  else if (style.headingAlignment) {
    // Map string alignment to AlignmentType
    if (style.headingAlignment === "CENTER") {
      alignment = AlignmentType.CENTER;
    } else if (style.headingAlignment === "RIGHT") {
      alignment = AlignmentType.RIGHT;
    } else if (style.headingAlignment === "JUSTIFIED") {
      alignment = AlignmentType.JUSTIFIED;
    } else if (style.headingAlignment === "LEFT") {
      alignment = AlignmentType.LEFT;
    }
  }

  // Log the alignment for debugging
  console.log(`Heading Level ${headingLevel} alignment: ${alignment}`);

  return new Paragraph({
    children: [
      new TextRun({
        text: headingText,
        bold: true,
        size: headingSize,
        color: "000000",
      }),
    ],
    heading:
      headingLevel as unknown as (typeof HeadingLevel)[keyof typeof HeadingLevel],
    spacing: {
      before:
        config.level === 1 ? style.headingSpacing * 2 : style.headingSpacing,
      after: style.headingSpacing / 2,
    },
    alignment: alignment,
    style: `Heading${headingLevel}`, // This is crucial for TOC recognition
  });
}

/**
 * Processes a table and returns table formatting
 * @param tableData - The table data
 * @param documentType - The document type
 * @returns The processed table
 */
export function processTable(
  tableData: TableData,
  documentType: "document" | "report"
): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: tableData.headers.map(
          (header) =>
            new TableCell({
              children: [
                new Paragraph({
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
      ...tableData.rows.map(
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
}

/**
 * Processes a list item and returns appropriate paragraph formatting
 * @param config - The list item configuration
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export function processListItem(
  config: ListItemConfig,
  style: Style
): Paragraph {
  const children: TextRun[] = [
    new TextRun({
      text: config.text + (config.boldText ? "\n" : ""),
      color: "000000",
      size: style.listItemSize || 24, // Use custom list item size if provided
    }),
  ];

  if (config.boldText) {
    children.push(
      new TextRun({
        text: config.boldText,
        bold: true,
        color: "000000",
        size: style.listItemSize || 24, // Use custom list item size if provided
      })
    );
  }

  return new Paragraph({
    children,
    bullet: {
      level: 0,
    },
    spacing: {
      before: style.paragraphSpacing / 2,
      after: style.paragraphSpacing / 2,
    },
  });
}

/**
 * Processes a blockquote and returns appropriate paragraph formatting
 * @param text - The blockquote text
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export function processBlockquote(text: string, style: Style): Paragraph {
  // Determine alignment for blockquote - only if explicitly set
  let alignment = undefined;
  if (style.blockquoteAlignment) {
    switch (style.blockquoteAlignment) {
      case "LEFT":
        alignment = AlignmentType.LEFT;
        break;
      case "CENTER":
        alignment = AlignmentType.CENTER;
        break;
      case "RIGHT":
        alignment = AlignmentType.RIGHT;
        break;
      case "JUSTIFIED":
        alignment = AlignmentType.JUSTIFIED;
        break;
      default:
        // Don't set alignment if not explicitly defined
        alignment = undefined;
    }
  }

  return new Paragraph({
    children: [
      new TextRun({
        text: text,
        italics: true,
        color: "000000",
        size: style.blockquoteSize || 24, // Use custom blockquote size if provided
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
    alignment: alignment,
  });
}

/**
 * Processes a comment and returns appropriate paragraph formatting
 * @param text - The comment text
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export function processComment(text: string, style: Style): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: "Comment: " + text,
        italics: true,
        color: "666666",
      }),
    ],
    spacing: {
      before: style.paragraphSpacing,
      after: style.paragraphSpacing,
    },
  });
}

/**
 * Processes formatted text (bold/italic/inline-code) and returns an array of TextRun objects
 * @param line - The line to process
 * @param style - The style configuration
 * @returns An array of TextRun objects
 */
export function processFormattedText(line: string, style?: Style): TextRun[] {
  const textRuns: TextRun[] = [];
  let currentText = "";
  let isBold = false;
  let isItalic = false;
  let isInlineCode = false;

  for (let j = 0; j < line.length; j++) {
    // Handle inline code with backtick
    if (line[j] === "`") {
      if (currentText) {
        if (!isInlineCode) {
          textRuns.push(
            new TextRun({
              text: currentText,
              bold: isBold,
              italics: isItalic,
              color: "000000",
              size: style?.paragraphSize || 24,
            })
          );
        } else {
          textRuns.push(processInlineCode(currentText, style));
        }
        currentText = "";
      }
      isInlineCode = !isInlineCode;
      continue;
    }

    // Handle bold with ** markers
    if (j + 1 < line.length && line[j] === "*" && line[j + 1] === "*") {
      if (currentText) {
        if (!isInlineCode) {
          textRuns.push(
            new TextRun({
              text: currentText,
              bold: isBold,
              italics: isItalic,
              color: "000000",
              size: style?.paragraphSize || 24,
            })
          );
        } else {
          textRuns.push(processInlineCode(currentText, style));
        }
        currentText = "";
      }
      isBold = !isBold;
      j++;
      continue;
    }

    // Handle italic with single * marker
    if (
      line[j] === "*" &&
      (j === 0 || line[j - 1] !== "*") &&
      (j === line.length - 1 || line[j + 1] !== "*")
    ) {
      if (currentText) {
        if (!isInlineCode) {
          textRuns.push(
            new TextRun({
              text: currentText,
              bold: isBold,
              italics: isItalic,
              color: "000000",
              size: style?.paragraphSize || 24,
            })
          );
        } else {
          textRuns.push(processInlineCode(currentText, style));
        }
        currentText = "";
      }
      isItalic = !isItalic;
      continue;
    }

    // Handle strikethrough with ~~ markers
    if (j + 1 < line.length && line[j] === "~" && line[j + 1] === "~") {
      if (currentText) {
        if (!isInlineCode) {
          textRuns.push(
            new TextRun({
              text: currentText,
              bold: isBold,
              italics: isItalic,
              color: "000000",
              size: style?.paragraphSize || 24,
            })
          );
        } else {
          textRuns.push(processInlineCode(currentText, style));
        }
        currentText = "";
      }
      j++;
      continue;
    }

    currentText += line[j];
  }

  // Add any remaining text
  if (currentText) {
    if (!isInlineCode) {
      textRuns.push(
        new TextRun({
          text: currentText,
          bold: isBold,
          italics: isItalic,
          color: "000000",
          size: style?.paragraphSize || 24,
        })
      );
    } else {
      textRuns.push(processInlineCode(currentText, style));
    }
  }

  return textRuns;
}

/**
 * Collects tables from markdown lines
 * @param lines - The markdown lines
 * @returns An array of table data
 */
export function collectTables(lines: string[]): TableData[] {
  const tables: TableData[] = [];

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

  return tables;
}

/**
 * Processes inline code and returns a TextRun object
 * @param code - The inline code text
 * @param style - The style configuration
 * @returns A TextRun object
 */
export function processInlineCode(code: string, style?: Style): TextRun {
  return new TextRun({
    text: code,
    font: "Courier New",
    size: style?.paragraphSize ? style.paragraphSize - 2 : 20,
    color: "444444",
    shading: {
      fill: "F5F5F5",
    },
  });
}

/**
 * Processes a code block and returns appropriate paragraph formatting
 * @param code - The code block text
 * @param language - The programming language (optional)
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export function processCodeBlock(
  code: string,
  language: string | undefined,
  style: Style
): Paragraph {
  // Split the code into lines and process each line
  const lines = code.split("\n");

  // Create text runs for each line
  const codeRuns: TextRun[] = [];

  // Add language indicator if present
  if (language) {
    codeRuns.push(
      new TextRun({
        text: language,
        font: "Courier New",
        size: style.codeBlockSize || 18,
        color: "666666",
        bold: true,
      }),
      new TextRun({
        text: "\n",
        font: "Courier New",
        size: style.codeBlockSize || 18,
        break: 1,
      })
    );
  }

  // Process each line
  lines.forEach((line, index) => {
    // Preserve leading spaces by converting them to non-breaking spaces
    const leadingSpaces = line.match(/^\s*/)?.[0].length || 0;
    const leadingNbsp = "\u00A0".repeat(leadingSpaces);
    const processedLine = leadingNbsp + line.slice(leadingSpaces);

    // Add the line
    codeRuns.push(
      new TextRun({
        text: processedLine,
        font: "Courier New",
        size: style.codeBlockSize || 20,
        color: "444444",
      })
    );

    // Add line break if not the last line
    if (index < lines.length - 1) {
      codeRuns.push(
        new TextRun({
          text: "\n",
          font: "Courier New",
          size: style.codeBlockSize || 20,
          break: 1,
        })
      );
    }
  });

  return new Paragraph({
    children: codeRuns,
    spacing: {
      before: style.paragraphSpacing,
      after: style.paragraphSpacing,
      // Preserve line spacing exactly
      line: 360,
      lineRule: "exact",
    },
    shading: {
      fill: "F5F5F5",
    },
    border: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
    },
    // Preserve indentation
    indent: {
      left: 360, // 0.25 inch indent for the entire code block
    },
  });
}

/**
 * Processes a link and returns appropriate text run
 */
export function processLink(text: string, url: string): TextRun {
  return new TextRun({
    text: text,
    color: "0000FF",
    underline: { type: "single" },
  });
}

/**
 * Processes a link and returns a paragraph with hyperlink
 * @param text - The link text
 * @param url - The link URL
 * @param style - The style configuration
 * @returns The processed paragraph with hyperlink
 */
export function processLinkParagraph(
  text: string,
  url: string,
  style: Style
): Paragraph {
  const hyperlink = new ExternalHyperlink({
    children: [
      new TextRun({
        text: text,
        color: "0000FF",
        underline: { type: "single" },
      }),
    ],
    link: url,
  });

  return new Paragraph({
    children: [hyperlink],
    spacing: {
      before: style.paragraphSpacing,
      after: style.paragraphSpacing,
    },
  });
}

/**
 * Creates a simple link paragraph
 * @param text - The link text
 * @param url - The URL to link to
 * @returns A paragraph with a hyperlink
 */
export function createLinkParagraph(text: string, url: string): Paragraph {
  return new Paragraph({
    children: [
      new ExternalHyperlink({
        children: [
          new TextRun({
            text: text,
            color: "0000FF",
            underline: { type: "single" },
          }),
        ],
        link: url,
      }),
    ],
  });
}

/**
 * Processes an image and returns appropriate paragraph
 * @param altText - The alt text
 * @param imageUrl - The image URL
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export async function processImage(
  altText: string,
  imageUrl: string,
  style: Style
): Promise<Paragraph[]> {
  try {
    console.log(`Starting image processing for URL: ${imageUrl}`);

    const response = await fetch(imageUrl);
    console.log(`Fetch response status: ${response.status}`);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch image: ${response.status} ${response.statusText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    console.log(`ArrayBuffer size: ${arrayBuffer.byteLength} bytes`);

    const buffer = Buffer.from(arrayBuffer);
    console.log(`Buffer size: ${buffer.length} bytes`);

    // Create a paragraph with just the image, no hyperlink
    return [
      new Paragraph({
        children: [
          new ImageRun({
            data: buffer,
            transformation: {
              width: 200,
              height: 200,
            },
            type: "jpg",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: {
          before: style.paragraphSpacing,
          after: style.paragraphSpacing,
        },
      }),
    ];
  } catch (error) {
    console.error("Error in processImage:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack available"
    );

    return [
      new Paragraph({
        children: [
          new TextRun({
            text: `[Image could not be displayed: ${altText}]`,
            italics: true,
            color: "FF0000",
          }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    ];
  }
}

/**
 * Processes a paragraph and returns appropriate paragraph formatting
 * @param text - The paragraph text
 * @param style - The style configuration
 * @returns The processed paragraph
 */
export function processParagraph(text: string, style: Style): Paragraph {
  // Split the text into words
  const words = text.split(/\s+/);

  // Create text runs for each word
  const textRuns: TextRun[] = [];

  // Process each word
  words.forEach((word, index) => {
    // Check if the word is bold
    if (word.startsWith("**") && word.endsWith("**")) {
      // Remove the bold markers
      const boldText = word.slice(2, -2);
      textRuns.push(
        new TextRun({
          text: boldText,
          bold: true,
          size: style.paragraphSize || 24,
        })
      );
    } else {
      // Regular text
      textRuns.push(
        new TextRun({
          text: word,
          size: style.paragraphSize || 24,
        })
      );
    }

    // Add space between words if not the last word
    if (index < words.length - 1) {
      textRuns.push(
        new TextRun({
          text: " ",
          size: style.paragraphSize || 24,
        })
      );
    }
  });

  // Default alignment uses direct enum value
  const alignment = style.paragraphAlignment
    ? style.paragraphAlignment === "CENTER"
      ? AlignmentType.CENTER
      : style.paragraphAlignment === "RIGHT"
      ? AlignmentType.RIGHT
      : style.paragraphAlignment === "JUSTIFIED"
      ? AlignmentType.JUSTIFIED
      : AlignmentType.LEFT
    : AlignmentType.LEFT;

  // Log the alignment for debugging
  console.log(
    `Paragraph alignment: ${alignment}, Style alignment: ${style.paragraphAlignment}`
  );

  // Only apply indent for justified text
  const indent =
    style.paragraphAlignment === "JUSTIFIED"
      ? { left: 0, right: 0 }
      : undefined;

  return new Paragraph({
    children: textRuns,
    spacing: {
      before: style.paragraphSpacing,
      after: style.paragraphSpacing,
      line: style.lineSpacing * 240,
    },
    alignment,
    indent,
  });
}
