import {
  Paragraph,
  Table,
  TextRun,
  ExternalHyperlink,
  PageBreak,
  AlignmentType,
} from "docx";
import type { DocxDocumentModel, DocxBlockNode, DocxListNode, DocxListItemNode } from "./docxModel.js";
import { Style, Options } from "./types.js";
import {
  processHeading,
  processTable,
  processCodeBlock,
  processBlockquote,
  processComment,
  processImage,
  processParagraph,
  processFormattedText,
  processLinkParagraph,
  processListItem,
} from "./helpers.js";

/**
 * Converts internal docx model to docx Paragraph/Table objects
 * Handles nested lists with proper level tracking
 */
export async function modelToDocx(
  model: DocxDocumentModel,
  style: Style,
  options: Options
): Promise<{
  children: (Paragraph | Table)[];
  headings: { text: string; level: number; bookmarkId: string }[];
  maxSequenceId: number;
}> {
  const children: (Paragraph | Table)[] = [];
  const headings: { text: string; level: number; bookmarkId: string }[] = [];
  const documentType = options.documentType || "document";

  // Track numbering sequences for nested lists
  let maxSequenceId = 0;

  function renderBlockNode(
    node: DocxBlockNode,
    listLevel: number = 0
  ): (Paragraph | Table)[] {
    switch (node.type) {
      case "heading": {
        // Re-encode inline formatting (bold/italic/code/links) into markdown
        const headingText = node.children
          .map((c) => {
            if (c.code) return "`" + c.value + "`";
            if (c.bold && c.italic) return "***" + c.value + "***";
            if (c.bold) return "**" + c.value + "**";
            if (c.italic) return "*" + c.value + "*";
            if (c.link) return "[" + c.value + "](" + c.link + ")";
            return c.value;
          })
          .join("");

        const headingLine = "#".repeat(node.level) + " " + headingText;
        const config = {
          level: node.level,
          size: 0,
          style: node.level === 1 ? "Title" : undefined,
        };
        const { paragraph, bookmarkId } = processHeading(
          headingLine,
          config,
          style,
          documentType
        );
        headings.push({
          text: headingText,
          level: node.level,
          bookmarkId,
        });
        return [paragraph];
      }

      case "paragraph": {
        const paragraphText = node.children
          .map((c) => {
            if (c.code) return "`" + c.value + "`";
            if (c.bold && c.italic) return "***" + c.value + "***";
            if (c.bold) return "**" + c.value + "**";
            if (c.italic) return "*" + c.value + "*";
            if (c.link) return "[" + c.value + "](" + c.link + ")";
            return c.value;
          })
          .join("");
        return [processParagraph(paragraphText, style)];
      }

      case "list": {
        return renderList(node, listLevel || 0);
      }

      case "codeBlock": {
        return [
          processCodeBlock(node.value, node.language, style),
        ];
      }

      case "blockquote": {
        // Combine blockquote children into text
        const quoteText = node.children
          .map((child) => {
            if (child.type === "paragraph") {
              return child.children.map((c) => c.value).join("");
            }
            return "";
          })
          .join("\n");
        return [processBlockquote(quoteText, style)];
      }

      case "image": {
        // processImage returns Promise<Paragraph[]>, so we need to handle it specially
        // For now, return empty array and handle images separately
        return [];
      }

      case "table": {
        const tableData = {
          headers: node.headers,
          rows: node.rows,
        };
        return [processTable(tableData, documentType)];
      }

      case "comment": {
        return [processComment(node.value, style)];
      }

      case "pageBreak": {
        return [new Paragraph({ children: [new PageBreak()] })];
      }

      case "tocPlaceholder": {
        const placeholder = new Paragraph({});
        (placeholder as any).__isTocPlaceholder = true;
        return [placeholder];
      }

      default:
        return [];
    }
  }

  function renderList(
    list: DocxListNode,
    currentLevel: number
  ): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    let itemNumber = 1;

    // Track max sequence ID
    if (list.sequenceId && list.sequenceId > maxSequenceId) {
      maxSequenceId = list.sequenceId;
    }

    for (const item of list.children) {
      // Render list item content
      const itemParagraphs = renderListItem(item, list.ordered, currentLevel, list.sequenceId, itemNumber);
      paragraphs.push(...itemParagraphs);
      itemNumber++;
    }

    return paragraphs;
  }

  function renderListItem(
    item: DocxListItemNode,
    isOrdered: boolean,
    level: number,
    sequenceId: number | undefined,
    itemNumber: number
  ): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    // Process children of list item
    for (const child of item.children) {
      if (child.type === "list") {
        // Nested list - render recursively
        const nestedParagraphs = renderList(child as DocxListNode, level + 1);
        paragraphs.push(...nestedParagraphs);
      } else if (child.type === "paragraph") {
        // Paragraph content - render as list item
        // Convert text nodes back to markdown-like format for processListItem
        // Note: ***text*** is now properly handled by the parser for bold+italic
        const paragraphText = child.children
          .map((c) => {
            if (c.code) return "`" + c.value + "`";
            if (c.bold && c.italic) return "***" + c.value + "***";
            if (c.bold) return "**" + c.value + "**";
            if (c.italic) return "*" + c.value + "*";
            if (c.link) return "[" + c.value + "](" + c.link + ")";
            return c.value;
          })
          .join("");

        // Use processListItem helper
        const listItemConfig = {
          text: paragraphText,
          isNumbered: isOrdered,
          listNumber: itemNumber,
          sequenceId: sequenceId || 1,
          level: level,
        };
        paragraphs.push(processListItem(listItemConfig, style));
      } else {
        // Other block types - render normally but they'll appear as part of list item
        const rendered = renderBlockNode(child, level);
        // Filter out Tables - list items should only contain Paragraphs
        for (const item of rendered) {
          if (item instanceof Paragraph) {
            paragraphs.push(item);
          }
        }
      }
    }

    // If no paragraphs were created, create an empty list item
    if (paragraphs.length === 0) {
      const listItemConfig = {
        text: "",
        isNumbered: isOrdered,
        listNumber: itemNumber,
        sequenceId: sequenceId || 1,
        level: level,
      };
      paragraphs.push(processListItem(listItemConfig, style));
    }

    return paragraphs;
  }

  // Process all top-level nodes
  for (const node of model.children) {
    if (node.type === "image") {
      // Handle images asynchronously
      try {
        const imageParagraphs = await processImage(node.alt, node.url, style);
        children.push(...imageParagraphs);
      } catch (error) {
        console.error(`Error processing image: ${error}`);
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[Image could not be loaded: ${node.alt}]`,
                italics: true,
                color: "FF0000",
              }),
            ],
            alignment: AlignmentType.CENTER,
            bidirectional: style.direction === "RTL",
          })
        );
      }
    } else {
      const rendered = renderBlockNode(node);
      children.push(...rendered);
    }
  }

  return { children, headings, maxSequenceId };
}

