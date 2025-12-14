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
  Bookmark,
  InternalHyperlink,
} from "docx";
import { Style, TableData, HeadingConfig, ListItemConfig } from "./types.js";

// Helper function to sanitize text for use in bookmark IDs
function sanitizeForBookmarkId(text: string): string {
  // Remove non-alphanumeric characters (except underscores), replace spaces with underscores
  // Ensure it starts with a letter or underscore
  let sanitized = text.replace(/[^a-zA-Z0-9_\s]/g, "").replace(/\s+/g, "_");
  if (!/^[a-zA-Z_]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  // Truncate if necessary (Word has limits, though usually generous)
  return sanitized.substring(0, 40);
}

/**
 * Processes a heading line and returns appropriate paragraph formatting and a bookmark ID
 * @param line - The heading line to process
 * @param config - The heading configuration
 * @param style - The style configuration
 * @param documentType - The document type
 * @returns An object containing the processed paragraph and its bookmark ID
 */
export function processHeading(
  line: string,
  config: HeadingConfig,
  style: Style,
  documentType: "document" | "report"
): { paragraph: Paragraph; bookmarkId: string } {
  const headingText = line.replace(new RegExp(`^#{${config.level}} `), "");
  const headingLevel = config.level;
  // Generate a unique bookmark ID using the clean text (without markdown)
  const cleanTextForBookmark = headingText
    .replace(/\*\*/g, "")
    .replace(/\*/g, "");
  const bookmarkId = `_Toc_${sanitizeForBookmarkId(
    cleanTextForBookmark
  )}_${Date.now()}`;

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

  // Determine alignment based on heading level
  let alignment;

  // Check for level-specific alignment first
  if (headingLevel === 1 && style.heading1Alignment) {
    alignment = AlignmentType[style.heading1Alignment];
  } else if (headingLevel === 2 && style.heading2Alignment) {
    alignment = AlignmentType[style.heading2Alignment];
  } else if (headingLevel === 3 && style.heading3Alignment) {
    alignment = AlignmentType[style.heading3Alignment];
  } else if (headingLevel === 4 && style.heading4Alignment) {
    alignment = AlignmentType[style.heading4Alignment];
  } else if (headingLevel === 5 && style.heading5Alignment) {
    alignment = AlignmentType[style.heading5Alignment];
  } else if (style.headingAlignment) {
    // Fallback to general heading alignment if no level-specific alignment
    alignment = AlignmentType[style.headingAlignment];
  }

  // Process the heading text to handle markdown formatting (bold/italic)
  const processedTextRuns = processFormattedTextForHeading(
    headingText,
    headingSize,
    style
  );

  // Create the paragraph with bookmark
  const paragraph = new Paragraph({
    children: [
      new Bookmark({
        id: bookmarkId,
        children: processedTextRuns,
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
    bidirectional: style.direction === "RTL",
  });

  return { paragraph, bookmarkId };
}

/**
 * Processes formatted text specifically for headings (bold/italic) and returns an array of TextRun objects
 * @param text - The text to process
 * @param fontSize - The font size to apply
 * @returns An array of TextRun objects
 */
function processFormattedTextForHeading(
  text: string,
  fontSize: number,
  style?: Style
): TextRun[] {
  const textRuns: TextRun[] = [];
  let currentText = "";
  let isBold = false;
  let isItalic = false;

  // Track unclosed markers to reset at end if needed
  let boldStart = -1;
  let italicStart = -1;

  for (let j = 0; j < text.length; j++) {
    // Handle escaped characters
    if (text[j] === "\\" && j + 1 < text.length) {
      const nextChar = text[j + 1];
      if (nextChar === "*" || nextChar === "\\") {
        currentText += nextChar;
        j++; // Skip the escaped character
        continue;
      }
      // If not a recognized escape sequence, treat normally
      currentText += text[j];
      continue;
    }

    // Handle bold+italic with *** markers (must check before **)
    if (j + 2 < text.length && text[j] === "*" && text[j + 1] === "*" && text[j + 2] === "*") {
      // Flush current text before toggling bold+italic
      if (currentText) {
        textRuns.push(
          new TextRun({
            text: currentText,
            bold: isBold,
            italics: isItalic,
            color: "000000",
            size: fontSize,
            rightToLeft: style?.direction === "RTL",
          })
        );
        currentText = "";
      }

      // Toggle both bold and italic state
      if (!isBold && !isItalic) {
        boldStart = j;
        italicStart = j;
      } else {
        boldStart = -1;
        italicStart = -1;
      }
      isBold = !isBold;
      isItalic = !isItalic;
      j += 2; // Skip the second and third *
      continue;
    }

    // Handle bold with ** markers
    if (j + 1 < text.length && text[j] === "*" && text[j + 1] === "*") {
      // Flush current text before toggling bold
      if (currentText) {
        textRuns.push(
          new TextRun({
            text: currentText,
            bold: isBold,
            italics: isItalic,
            color: "000000",
            size: fontSize,
            rightToLeft: style?.direction === "RTL",
          })
        );
        currentText = "";
      }

      // Toggle bold state
      if (!isBold) {
        boldStart = j;
      } else {
        boldStart = -1;
      }
      isBold = !isBold;
      j++; // Skip the second *
      continue;
    }

    // Handle italic with single * marker (but not if it's part of **)
    if (
      text[j] === "*" &&
      (j === 0 || text[j - 1] !== "*") &&
      (j === text.length - 1 || text[j + 1] !== "*")
    ) {
      // Flush current text before toggling italic
      if (currentText) {
        textRuns.push(
          new TextRun({
            text: currentText,
            bold: isBold,
            italics: isItalic,
            color: "000000",
            size: fontSize,
            rightToLeft: style?.direction === "RTL",
          })
        );
        currentText = "";
      }

      // Toggle italic state
      if (!isItalic) {
        italicStart = j;
      } else {
        italicStart = -1;
      }
      isItalic = !isItalic;
      continue;
    }

    // Add to current text
    currentText += text[j];
  }

  // Handle any remaining text
  if (currentText) {
    // If we have unclosed markers, treat them as literal text
    // Check if both bold and italic were started together (triple asterisk)
    if (isBold && isItalic && boldStart >= 0 && italicStart >= 0 && boldStart === italicStart) {
      // Insert the *** back into the text and turn off both
      const beforeFormatting = currentText;
      currentText = "***" + beforeFormatting;
      isBold = false;
      isItalic = false;
    } else {
      if (isBold && boldStart >= 0) {
        // Insert the ** back into the text and turn off bold
        const beforeBold = currentText;
        currentText = "**" + beforeBold;
        isBold = false;
      }

      if (isItalic && italicStart >= 0) {
        // Insert the * back into the text and turn off italic
        const beforeItalic = currentText;
        currentText = "*" + beforeItalic;
        isItalic = false;
      }
    }

    // Only add non-empty text runs
    if (currentText.trim()) {
      textRuns.push(
        new TextRun({
          text: currentText,
          bold: isBold,
          italics: isItalic,
          color: "000000",
          size: fontSize,
          rightToLeft: style?.direction === "RTL",
        })
      );
    }
  }

  // If no text runs were created, return a single empty run to avoid empty paragraphs
  if (textRuns.length === 0) {
    textRuns.push(
      new TextRun({
        text: "",
        color: "000000",
        size: fontSize,
        bold: true, // Headings are bold by default
      })
    );
  }

  return textRuns;
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
                          rightToLeft: false,
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
  let textContent = config.text;

  const listLevel = config.level ?? 0;

  // Process the main text with formatting
  const children = processFormattedText(textContent, style);

  // If there's bold text on the next line, add it with a line break
  if (config.boldText) {
    children.push(
      new TextRun({
        text: "\n",
        size: style.listItemSize || 24,
      }),
      new TextRun({
        text: config.boldText,
        bold: true,
        color: "000000",
        size: style.listItemSize || 24,
      })
    );
  }

  // Use different formatting for numbered vs bullet lists
  if (config.isNumbered) {
    // Use numbering for numbered lists with unique reference per sequence
    const numberingReference = `numbered-list-${config.sequenceId || 1}`;
    return new Paragraph({
      children,
      numbering: {
        reference: numberingReference,
        level: listLevel,
      },
      spacing: {
        before: style.paragraphSpacing / 2,
        after: style.paragraphSpacing / 2,
      },
      bidirectional: style.direction === "RTL",
    });
  } else {
    // Use bullet formatting for bullet lists
    return new Paragraph({
      children,
      bullet: {
        level: listLevel,
      },
      spacing: {
        before: style.paragraphSpacing / 2,
        after: style.paragraphSpacing / 2,
      },
      bidirectional: style.direction === "RTL",
    });
  }
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
        rightToLeft: style.direction === "RTL",
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
    bidirectional: style.direction === "RTL",
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
 * Processes formatted text (bold/italic/inline-code/links) and returns an array of TextRun or ExternalHyperlink objects
 * @param line - The line to process
 * @param style - The style configuration
 * @returns An array of TextRun or ExternalHyperlink objects
 */
export function processFormattedText(line: string, style?: Style): (TextRun | ExternalHyperlink)[] {
  const textRuns: (TextRun | ExternalHyperlink)[] = [];
  let currentText = "";
  let isBold = false;
  let isItalic = false;
  let isInlineCode = false;

  // Track unclosed markers to reset at end if needed
  let boldStart = -1;
  let italicStart = -1;

  for (let j = 0; j < line.length; j++) {
    // Handle escaped characters
    if (line[j] === "\\" && j + 1 < line.length) {
      const nextChar = line[j + 1];
      if (nextChar === "*" || nextChar === "`" || nextChar === "\\" || nextChar === "[" || nextChar === "]") {
        currentText += nextChar;
        j++; // Skip the escaped character
        continue;
      }
      // If not a recognized escape sequence, treat normally
      currentText += line[j];
      continue;
    }

    // Handle inline links [text](url) - only when not in inline code
    if (!isInlineCode && line[j] === "[") {
      // Look for closing ] and then (url)
      let closeBracket = -1;
      let openParen = -1;
      let closeParen = -1;

      // Find closing bracket
      for (let k = j + 1; k < line.length; k++) {
        if (line[k] === "\\" && k + 1 < line.length) {
          k++; // Skip escaped character
          continue;
        }
        if (line[k] === "]") {
          closeBracket = k;
          break;
        }
      }

      // If we found closing bracket, look for (url)
      if (closeBracket > j && closeBracket + 1 < line.length && line[closeBracket + 1] === "(") {
        openParen = closeBracket + 1;
        // Find closing paren
        for (let k = openParen + 1; k < line.length; k++) {
          if (line[k] === ")") {
            closeParen = k;
            break;
          }
        }
      }

      // If we found a complete link pattern
      if (closeBracket > j && openParen > closeBracket && closeParen > openParen) {
        // Flush current text first
        if (currentText) {
          textRuns.push(
            new TextRun({
              text: currentText,
              bold: isBold,
              italics: isItalic,
              color: "000000",
              size: style?.paragraphSize || 24,
              rightToLeft: style?.direction === "RTL",
            })
          );
          currentText = "";
        }

        // Extract link text and URL
        const linkText = line.substring(j + 1, closeBracket);
        const linkUrl = line.substring(openParen + 1, closeParen);

        // Create hyperlink
        textRuns.push(
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: linkText,
                color: "0000FF",
                underline: { type: "single" },
                bold: isBold,
                italics: isItalic,
                size: style?.paragraphSize || 24,
                rightToLeft: style?.direction === "RTL",
              }),
            ],
            link: linkUrl,
          })
        );

        // Skip to after the link
        j = closeParen;
        continue;
      }
    }

    // Handle inline code with backtick
    if (line[j] === "`" && !isInlineCode) {
      // Starting inline code - flush current text first
      if (currentText) {
        textRuns.push(
          new TextRun({
            text: currentText,
            bold: isBold,
            italics: isItalic,
            color: "000000",
            size: style?.paragraphSize || 24,
            rightToLeft: style?.direction === "RTL",
          })
        );
        currentText = "";
      }
      isInlineCode = true;
      continue;
    }

    if (line[j] === "`" && isInlineCode) {
      // Ending inline code
      if (currentText) {
        textRuns.push(processInlineCode(currentText, style));
        currentText = "";
      }
      isInlineCode = false;
      continue;
    }

    // If we're inside inline code, just accumulate text (no formatting)
    if (isInlineCode) {
      currentText += line[j];
      continue;
    }

    // Handle bold+italic with *** markers (must check before **)
    if (j + 2 < line.length && line[j] === "*" && line[j + 1] === "*" && line[j + 2] === "*") {
      // Flush current text before toggling bold+italic
      if (currentText) {
        textRuns.push(
          new TextRun({
            text: currentText,
            bold: isBold,
            italics: isItalic,
            color: "000000",
            size: style?.paragraphSize || 24,
            rightToLeft: style?.direction === "RTL",
          })
        );
        currentText = "";
      }

      // Toggle both bold and italic state
      if (!isBold && !isItalic) {
        boldStart = j;
        italicStart = j;
      } else {
        boldStart = -1;
        italicStart = -1;
      }
      isBold = !isBold;
      isItalic = !isItalic;
      j += 2; // Skip the second and third *
      continue;
    }

    // Handle bold with ** markers
    if (j + 1 < line.length && line[j] === "*" && line[j + 1] === "*") {
      // Flush current text before toggling bold
      if (currentText) {
        textRuns.push(
          new TextRun({
            text: currentText,
            bold: isBold,
            italics: isItalic,
            color: "000000",
            size: style?.paragraphSize || 24,
            rightToLeft: style?.direction === "RTL",
          })
        );
        currentText = "";
      }

      // Toggle bold state
      if (!isBold) {
        boldStart = j;
      } else {
        boldStart = -1;
      }
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
      // Flush current text before toggling italic
      if (currentText) {
        textRuns.push(
          new TextRun({
            text: currentText,
            bold: isBold,
            italics: isItalic,
            color: "000000",
            size: style?.paragraphSize || 24,
          })
        );
        currentText = "";
      }

      // Toggle italic state
      if (!isItalic) {
        italicStart = j;
      } else {
        italicStart = -1;
      }
      isItalic = !isItalic;
      continue;
    }

    // Add to current text
    currentText += line[j];
  }

  // Handle any remaining text
  if (currentText) {
    // If we have unclosed markers, treat them as literal text
    // Check if both bold and italic were started together (triple asterisk)
    if (isBold && isItalic && boldStart >= 0 && italicStart >= 0 && boldStart === italicStart) {
      // Insert the *** back into the text and turn off both
      const beforeFormatting = currentText;
      currentText = "***" + beforeFormatting;
      isBold = false;
      isItalic = false;
    } else {
      if (isBold && boldStart >= 0) {
        // Insert the ** back into the text and turn off bold
        const beforeBold = currentText;
        currentText = "**" + beforeBold;
        isBold = false;
      }

      if (isItalic && italicStart >= 0) {
        // Insert the * back into the text and turn off italic
        const beforeItalic = currentText;
        currentText = "*" + beforeItalic;
        isItalic = false;
      }
    }

    if (isInlineCode) {
      // Unclosed inline code - treat as literal text
      currentText = "`" + currentText;
    }

    // Only add non-empty text runs
    if (currentText.trim()) {
      textRuns.push(
        new TextRun({
          text: currentText,
          bold: isBold,
          italics: isItalic,
          color: "000000",
          size: style?.paragraphSize || 24,
          rightToLeft: style?.direction === "RTL",
        })
      );
    }
  }

  // If no text runs were created, return a single empty run to avoid empty paragraphs
  if (textRuns.length === 0) {
    textRuns.push(
      new TextRun({
        text: "",
        color: "000000",
        size: style?.paragraphSize || 24,
      })
    );
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
    if (line.trim().startsWith("|")) {
      // Check for separator row with proper regex
      if (
        i + 1 < lines.length &&
        /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[i + 1])
      ) {
        // Preserve empty cells by slicing off leading/trailing pipe and splitting
        const headers = line
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((h) => h.trim());
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim().startsWith("|")) {
          const row = lines[j]
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
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
    rightToLeft: style?.direction === "RTL",
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
        rightToLeft: style.direction === "RTL",
      }),
      new TextRun({
        text: "\n",
        font: "Courier New",
        size: style.codeBlockSize || 18,
        break: 1,
        rightToLeft: style.direction === "RTL",
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
        rightToLeft: style.direction === "RTL",
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
          rightToLeft: style.direction === "RTL",
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
        rightToLeft: style.direction === "RTL",
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
    bidirectional: style.direction === "RTL",
  });
}

/**
 * Computes output image dimensions preserving aspect ratio.
 * - If both hints provided, uses them directly.
 * - If one hint provided and intrinsic aspect known, computes the other.
 * - Falls back to intrinsic width capped to 400, or default width 200.
 */
export function computeImageDimensions(
  widthHint: number | undefined,
  heightHint: number | undefined,
  intrinsicWidth: number | undefined,
  intrinsicHeight: number | undefined
): { width: number; height?: number } {
  let outWidth: number;
  let outHeight: number | undefined;
  const aspect =
    intrinsicWidth && intrinsicHeight
      ? intrinsicWidth / intrinsicHeight
      : undefined;

  if (widthHint && heightHint) {
    outWidth = widthHint;
    outHeight = heightHint;
  } else if (widthHint && aspect) {
    outWidth = widthHint;
    outHeight = Math.max(1, Math.round(widthHint / aspect));
  } else if (heightHint && aspect) {
    outHeight = heightHint;
    outWidth = Math.max(1, Math.round(heightHint * aspect));
  } else if (intrinsicWidth) {
    outWidth = Math.min(intrinsicWidth, 400);
    if (aspect) outHeight = Math.max(1, Math.round(outWidth / aspect));
  } else {
    outWidth = 200;
  }

  return { width: outWidth, height: outHeight };
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
    // Parse optional width/height hints from URL fragment BEFORE processing
    let widthHint: number | undefined;
    let heightHint: number | undefined;
    let urlWithoutFragment = imageUrl;

    const hashIndex = imageUrl.indexOf("#");
    if (hashIndex >= 0) {
      const fragment = imageUrl.substring(hashIndex + 1);
      urlWithoutFragment = imageUrl.substring(0, hashIndex);
      
      // Pattern #<width>x<height>
      const wxh = fragment.match(/^(\d+)x(\d+)$/);
      if (wxh) {
        widthHint = parseInt(wxh[1], 10);
        heightHint = parseInt(wxh[2], 10);
      } else {
        // Pattern #w=123&h=45 or #width=..&height=..
        const params = new URLSearchParams(fragment.replace(/&amp;/g, "&"));
        const w = params.get("w") || params.get("width");
        const h = params.get("h") || params.get("height");
        if (w && /^\d+$/.test(w)) widthHint = parseInt(w, 10);
        if (h && /^\d+$/.test(h)) heightHint = parseInt(h, 10);
      }
    }

    // Support data URLs without fetch and extract raw data/content-type
    let data: Uint8Array | Buffer;
    let contentType = "";

    if (/^data:/i.test(urlWithoutFragment)) {
      // data:[<mediatype>][;base64],<data>
      const match = urlWithoutFragment.match(/^data:([^;,]*)(;base64)?,(.*)$/i);
      if (!match) {
        throw new Error(`Invalid data URL for image: ${urlWithoutFragment.substring(0, 100)}...`);
      }
      contentType = match[1] || "";
      const isBase64 = !!match[2];
      const dataPart = match[3];
      
      try {
        const binary = isBase64
          ? typeof Buffer !== "undefined"
            ? Buffer.from(dataPart, "base64")
            : Uint8Array.from(atob(dataPart), (c) => c.charCodeAt(0))
          : typeof Buffer !== "undefined"
          ? Buffer.from(decodeURIComponent(dataPart))
          : new TextEncoder().encode(decodeURIComponent(dataPart));
        data = binary as any;
        
        // Verify we got valid data
        if (!data || data.length === 0) {
          throw new Error("Data URL produced empty image data");
        }
      } catch (error) {
        throw new Error(`Failed to decode data URL: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // Use URL without fragment for fetch (fetch automatically strips fragments anyway)
      const response = await fetch(urlWithoutFragment);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch image: ${response.status} ${response.statusText}`
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      // Use Buffer in Node environments, Uint8Array in browsers
      data =
        typeof Buffer !== "undefined"
          ? Buffer.from(arrayBuffer)
          : new Uint8Array(arrayBuffer);

      // Infer image type from content-type header or URL extension
      contentType = response.headers.get("content-type") || "";
    }
    let imageType: "png" | "jpg" | "gif" = "png";
    // Use original imageUrl (with fragment) for type detection to preserve extension info
    const urlForTypeDetection = imageUrl;
    
    // For data URLs, contentType should be set from the data URL itself
    // For regular URLs, contentType comes from the response header
    if (/jpeg|jpg/i.test(contentType) || /\.(jpe?g)(\?|#|$)/i.test(urlForTypeDetection)) {
      imageType = "jpg";
    } else if (/png/i.test(contentType) || /\.(png)(\?|#|$)/i.test(urlForTypeDetection)) {
      imageType = "png";
    } else if (/gif/i.test(contentType) || /\.(gif)(\?|#|$)/i.test(urlForTypeDetection)) {
      imageType = "gif";
    } else {
      // Default to PNG if type cannot be determined
      imageType = "png";
    }
    
    // Verify data is valid before proceeding
    if (!data || data.length === 0) {
      throw new Error(`Invalid image data: data length is ${data ? (data instanceof Uint8Array ? data.length : (data as Buffer).length) : 0}`);
    }

    // Extract intrinsic dimensions and compute output to preserve aspect ratio
    function readUint16BE(buf: Uint8Array, offset: number): number {
      return (buf[offset] << 8) | buf[offset + 1];
    }
    function readUint32BE(buf: Uint8Array, offset: number): number {
      return (
        ((buf[offset] << 24) |
          (buf[offset + 1] << 16) |
          (buf[offset + 2] << 8) |
          buf[offset + 3]) >>>
        0
      );
    }

    let intrinsicWidth: number | undefined;
    let intrinsicHeight: number | undefined;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

    if (imageType === "png" && bytes.length >= 24) {
      const isPng =
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47;
      if (isPng) {
        intrinsicWidth = readUint32BE(bytes, 16);
        intrinsicHeight = readUint32BE(bytes, 20);
      }
    } else if (imageType === "jpg") {
      let offset = 2; // skip SOI
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) break;
        const marker = bytes[offset + 1];
        const length = readUint16BE(bytes, offset + 2);
        if (marker === 0xc0 || marker === 0xc2) {
          intrinsicHeight = readUint16BE(bytes, offset + 5);
          intrinsicWidth = readUint16BE(bytes, offset + 7);
          break;
        }
        offset += 2 + length;
      }
    } else if (imageType === "gif" && bytes.length >= 10) {
      intrinsicWidth = bytes[6] | (bytes[7] << 8);
      intrinsicHeight = bytes[8] | (bytes[9] << 8);
    }

    let outWidth: number;
    let outHeight: number | undefined;
    const aspect =
      intrinsicWidth && intrinsicHeight
        ? intrinsicWidth / intrinsicHeight
        : undefined;

    if (widthHint && heightHint) {
      outWidth = widthHint;
      outHeight = heightHint;
    } else if (widthHint && aspect) {
      outWidth = widthHint;
      outHeight = Math.max(1, Math.round(widthHint / aspect));
    } else if (heightHint && aspect) {
      outHeight = heightHint;
      outWidth = Math.max(1, Math.round(heightHint * aspect));
    } else if (intrinsicWidth) {
      outWidth = Math.min(intrinsicWidth, 400);
      if (aspect) outHeight = Math.max(1, Math.round(outWidth / aspect));
    } else {
      outWidth = 200;
    }

    // Ensure data is in the correct format (Buffer for Node.js, Uint8Array for browser)
    // The docx library expects Buffer in Node.js environments
    const imageData = typeof Buffer !== "undefined" && !(data instanceof Buffer)
      ? Buffer.from(data)
      : data instanceof Uint8Array
      ? data
      : Buffer.from(data as any);
    
    // Ensure we have valid dimensions
    const finalHeight = outHeight || (outWidth ? Math.round(outWidth * 0.75) : 200); // Default aspect ratio if missing
    
    // Create a paragraph with just the image, no hyperlink
    return [
      new Paragraph({
        children: [
          new ImageRun({
            data: imageData,
            transformation: {
              width: outWidth,
              height: finalHeight,
            },
            type: imageType,
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
  // Use processFormattedText to handle all inline formatting
  const textRuns = processFormattedText(text, style);

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
    bidirectional: style.direction === "RTL",
  });
}
