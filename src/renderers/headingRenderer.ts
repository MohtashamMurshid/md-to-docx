import {
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Bookmark,
} from "docx";
import { Style, HeadingConfig } from "../types.js";
import { sanitizeForBookmarkId } from "../utils/bookmarkUtils.js";
import { resolveFontFamily } from "../utils/styleUtils.js";

/**
 * Processes formatted text specifically for headings (bold/italic/underline/strikethrough)
 * and returns an array of TextRun objects
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
  let isUnderline = false;
  let isStrikethrough = false;

  let boldStart = -1;
  let italicStart = -1;
  let underlineStart = -1;
  let strikethroughStart = -1;
  const fontFamily = resolveFontFamily(style);

  function hasUnescapedMarker(src: string, marker: string, startIndex: number): boolean {
    const maxIndex = src.length - marker.length;
    for (let i = startIndex; i <= maxIndex; i++) {
      if (src[i] === "\\") {
        i++;
        continue;
      }
      if (src.substring(i, i + marker.length) === marker) {
        return true;
      }
    }
    return false;
  }

  function createRun(value: string): TextRun {
    return new TextRun({
      text: value,
      bold: isBold,
      italics: isItalic,
      strike: isStrikethrough,
      underline: isUnderline ? { type: "single" } : undefined,
      color: "000000",
      size: fontSize,
      font: fontFamily,
      rightToLeft: style?.direction === "RTL",
    });
  }

  function flushCurrentText(): void {
    if (!currentText) {
      return;
    }
    textRuns.push(createRun(currentText));
    currentText = "";
  }

  for (let j = 0; j < text.length; j++) {
    if (text[j] === "\\" && j + 1 < text.length) {
      const nextChar = text[j + 1];
      if (nextChar === "*" || nextChar === "+" || nextChar === "~" || nextChar === "\\") {
        currentText += nextChar;
        j++;
        continue;
      }
      currentText += text[j];
      continue;
    }

    if (j + 2 < text.length && text[j] === "*" && text[j + 1] === "*" && text[j + 2] === "*") {
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

    if (j + 1 < text.length && text[j] === "*" && text[j + 1] === "*") {
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

    if (j + 1 < text.length && text[j] === "+" && text[j + 1] === "+") {
      const canToggle = isUnderline || hasUnescapedMarker(text, "++", j + 2);
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

    if (j + 1 < text.length && text[j] === "~" && text[j + 1] === "~") {
      const canToggle = isStrikethrough || hasUnescapedMarker(text, "~~", j + 2);
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

    if (
      text[j] === "*" &&
      (j === 0 || text[j - 1] !== "*") &&
      (j === text.length - 1 || text[j + 1] !== "*")
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

    currentText += text[j];
  }

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

    if (currentText.trim()) {
      textRuns.push(createRun(currentText));
    }
  }

  if (textRuns.length === 0) {
    textRuns.push(
      new TextRun({
        text: "",
        color: "000000",
        size: fontSize,
        bold: true,
        font: fontFamily,
      })
    );
  }

  return textRuns;
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

  const cleanTextForBookmark = headingText
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/\+\+/g, "")
    .replace(/~~/g, "");
  const bookmarkId = `_Toc_${sanitizeForBookmarkId(
    cleanTextForBookmark
  )}_${Date.now()}`;

  let headingSize = style.titleSize;

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
    headingSize = style.titleSize - (headingLevel - 1) * 4;
  }

  let alignment;
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
    alignment = AlignmentType[style.headingAlignment];
  }

  const processedTextRuns = processFormattedTextForHeading(
    headingText,
    headingSize,
    style
  );

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
    style: `Heading${headingLevel}`,
    bidirectional: style.direction === "RTL",
  });

  return { paragraph, bookmarkId };
}
