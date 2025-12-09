import { TextRun } from "docx";
import { Style } from "../types.js";

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

  // Track unclosed markers to reset at end if needed
  let boldStart = -1;
  let italicStart = -1;

  for (let j = 0; j < line.length; j++) {
    // Handle escaped characters
    if (line[j] === "\\" && j + 1 < line.length) {
      const nextChar = line[j + 1];
      if (nextChar === "*" || nextChar === "`" || nextChar === "\\") {
        currentText += nextChar;
        j++; // Skip the escaped character
        continue;
      }
      // If not a recognized escape sequence, treat normally
      currentText += line[j];
      continue;
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
 * Processes formatted text specifically for headings (bold/italic) and returns an array of TextRun objects
 * @param text - The text to process
 * @param fontSize - The font size to apply
 * @returns An array of TextRun objects
 */
export function processFormattedTextForHeading(
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