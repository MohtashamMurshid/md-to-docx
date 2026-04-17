import {
  Paragraph,
  TextRun,
  ExternalHyperlink,
} from "docx";
import { Style } from "../types.js";
import { resolveFontFamily } from "../utils/styleUtils.js";

function hasUnescapedMarker(text: string, marker: string, startIndex: number): boolean {
  const maxIndex = text.length - marker.length;
  for (let i = startIndex; i <= maxIndex; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text.substring(i, i + marker.length) === marker) {
      return true;
    }
  }
  return false;
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
 * Processes formatted text (bold/italic/underline/strikethrough/inline-code/links)
 * and returns an array of TextRun or ExternalHyperlink objects
 * @param line - The line to process
 * @param style - The style configuration
 * @param options - Optional rendering overrides (e.g. forceBold to ensure every run is bold)
 * @returns An array of TextRun or ExternalHyperlink objects
 */
export function processFormattedText(
  line: string,
  style?: Style,
  options?: { forceBold?: boolean }
): (TextRun | ExternalHyperlink)[] {
  const forceBold = options?.forceBold === true;
  const textRuns: (TextRun | ExternalHyperlink)[] = [];
  let currentText = "";
  let isBold = false;
  let isItalic = false;
  let isUnderline = false;
  let isStrikethrough = false;
  let isInlineCode = false;

  // Track unclosed markers to reset at end if needed
  let boldStart = -1;
  let italicStart = -1;
  let underlineStart = -1;
  let strikethroughStart = -1;
  const fontFamily = resolveFontFamily(style);

  function createTextRun(value: string): TextRun {
    return new TextRun({
      text: value,
      bold: forceBold || isBold,
      italics: isItalic,
      strike: isStrikethrough,
      underline: isUnderline ? { type: "single" } : undefined,
      color: "000000",
      size: style?.paragraphSize || 24,
      font: fontFamily,
      rightToLeft: style?.direction === "RTL",
    });
  }

  function flushCurrentText(): void {
    if (!currentText) {
      return;
    }
    textRuns.push(createTextRun(currentText));
    currentText = "";
  }

  for (let j = 0; j < line.length; j++) {
    // Handle escaped characters
    if (line[j] === "\\" && j + 1 < line.length) {
      const nextChar = line[j + 1];
      if (
        nextChar === "*" ||
        nextChar === "`" ||
        nextChar === "\\" ||
        nextChar === "[" ||
        nextChar === "]" ||
        nextChar === "+" ||
        nextChar === "~"
      ) {
        currentText += nextChar;
        j++;
        continue;
      }
      currentText += line[j];
      continue;
    }

    // Handle inline links [text](url) - only when not in inline code
    if (!isInlineCode && line[j] === "[") {
      let closeBracket = -1;
      let openParen = -1;
      let closeParen = -1;

      for (let k = j + 1; k < line.length; k++) {
        if (line[k] === "\\" && k + 1 < line.length) {
          k++;
          continue;
        }
        if (line[k] === "]") {
          closeBracket = k;
          break;
        }
      }

      if (closeBracket > j && closeBracket + 1 < line.length && line[closeBracket + 1] === "(") {
        openParen = closeBracket + 1;
        for (let k = openParen + 1; k < line.length; k++) {
          if (line[k] === ")") {
            closeParen = k;
            break;
          }
        }
      }

      if (closeBracket > j && openParen > closeBracket && closeParen > openParen) {
        flushCurrentText();

        const linkText = line.substring(j + 1, closeBracket);
        const linkUrl = line.substring(openParen + 1, closeParen);

        textRuns.push(
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: linkText,
                color: "0000FF",
                underline: { type: "single" },
                bold: forceBold || isBold,
                italics: isItalic,
                strike: isStrikethrough,
                size: style?.paragraphSize || 24,
                font: fontFamily,
                rightToLeft: style?.direction === "RTL",
              }),
            ],
            link: linkUrl,
          })
        );

        j = closeParen;
        continue;
      }
    }

    // Handle inline code with backtick
    if (line[j] === "`" && !isInlineCode) {
      flushCurrentText();
      isInlineCode = true;
      continue;
    }

    if (line[j] === "`" && isInlineCode) {
      if (currentText) {
        textRuns.push(processInlineCode(currentText, style));
        currentText = "";
      }
      isInlineCode = false;
      continue;
    }

    if (isInlineCode) {
      currentText += line[j];
      continue;
    }

    // Handle bold+italic with *** markers (must check before **)
    if (j + 2 < line.length && line[j] === "*" && line[j + 1] === "*" && line[j + 2] === "*") {
      flushCurrentText();

      if (!isBold && !isItalic) {
        boldStart = j;
        italicStart = j;
      } else {
        boldStart = -1;
        italicStart = -1;
      }
      isBold = !isBold;
      isItalic = !isItalic;
      j += 2;
      continue;
    }

    // Handle bold with ** markers
    if (j + 1 < line.length && line[j] === "*" && line[j + 1] === "*") {
      flushCurrentText();

      if (!isBold) {
        boldStart = j;
      } else {
        boldStart = -1;
      }
      isBold = !isBold;
      j++;
      continue;
    }

    // Handle underline with ++ markers
    if (j + 1 < line.length && line[j] === "+" && line[j + 1] === "+") {
      const canToggle = isUnderline || hasUnescapedMarker(line, "++", j + 2);
      if (!canToggle) {
        currentText += "++";
        j++;
        continue;
      }

      flushCurrentText();
      if (!isUnderline) {
        underlineStart = j;
      } else {
        underlineStart = -1;
      }
      isUnderline = !isUnderline;
      j++;
      continue;
    }

    // Handle strikethrough with ~~ markers
    if (j + 1 < line.length && line[j] === "~" && line[j + 1] === "~") {
      const canToggle = isStrikethrough || hasUnescapedMarker(line, "~~", j + 2);
      if (!canToggle) {
        currentText += "~~";
        j++;
        continue;
      }

      flushCurrentText();
      if (!isStrikethrough) {
        strikethroughStart = j;
      } else {
        strikethroughStart = -1;
      }
      isStrikethrough = !isStrikethrough;
      j++;
      continue;
    }

    // Handle italic with single * marker (but not if it's part of **)
    if (
      line[j] === "*" &&
      (j === 0 || line[j - 1] !== "*") &&
      (j === line.length - 1 || line[j + 1] !== "*")
    ) {
      flushCurrentText();

      if (!isItalic) {
        italicStart = j;
      } else {
        italicStart = -1;
      }
      isItalic = !isItalic;
      continue;
    }

    currentText += line[j];
  }

  // Handle any remaining text - if we have unclosed markers, treat them as literal
  if (currentText) {
    if (isBold && isItalic && boldStart >= 0 && italicStart >= 0 && boldStart === italicStart) {
      currentText = "***" + currentText;
      isBold = false;
      isItalic = false;
    } else {
      if (isBold && boldStart >= 0) {
        currentText = "**" + currentText;
        isBold = false;
      }

      if (isItalic && italicStart >= 0) {
        currentText = "*" + currentText;
        isItalic = false;
      }

      if (isUnderline && underlineStart >= 0) {
        currentText = "++" + currentText;
        isUnderline = false;
      }

      if (isStrikethrough && strikethroughStart >= 0) {
        currentText = "~~" + currentText;
        isStrikethrough = false;
      }
    }

    if (isInlineCode) {
      currentText = "`" + currentText;
    }

    if (currentText.trim()) {
      textRuns.push(createTextRun(currentText));
    }
  }

  // Return a single empty run if nothing was produced, to avoid empty paragraphs
  if (textRuns.length === 0) {
    textRuns.push(
      new TextRun({
        text: "",
        color: "000000",
        size: style?.paragraphSize || 24,
        font: fontFamily,
      })
    );
  }

  return textRuns;
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
  const fontFamily = resolveFontFamily(style);
  const hyperlink = new ExternalHyperlink({
    children: [
      new TextRun({
        text: text,
        color: "0000FF",
        underline: { type: "single" },
        font: fontFamily,
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
