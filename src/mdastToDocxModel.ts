import type {
  Root,
  Node,
  List,
  Heading,
  Paragraph,
  Code,
  Blockquote,
  Image,
  Table,
  TableRow,
  TableCell,
  Text,
  Emphasis,
  Strong,
  InlineCode,
  Link,
  Delete,
} from "mdast";
import type {
  DocxDocumentModel,
  DocxBlockNode,
  DocxTextNode,
  DocxListItemNode,
} from "./docxModel.js";
import { Style, Options } from "./types.js";

/**
 * Classifies a raw HTML node value into a comment or page-break block, or
 * null when it carries no recognized marker. Shared by the top-level scan
 * and the nested (blockquote/list) block walker.
 */
function classifyHtmlNode(value: string): DocxBlockNode | null {
  const commentMatch = value.match(
    /^\s*<!--\s*COMMENT:\s*([\s\S]*?)\s*(?:-->\s*|$)/
  );
  if (commentMatch) {
    return { type: "comment", value: commentMatch[1].trim() };
  }
  if (value.includes("pagebreak")) {
    return { type: "pageBreak" };
  }
  return null;
}

/**
 * Converts mdast AST to internal docx-friendly model
 * Handles nested lists properly using AST structure
 */
export function mdastToDocxModel(
  root: Root,
  _style: Style,
  _options: Options,
): DocxDocumentModel {
  const children: DocxBlockNode[] = [];
  let numberedListSequenceId = 0;
  const listSequenceMap = new Map<List, number>();

  function processNode(node: Node): DocxBlockNode | DocxBlockNode[] | null {
    switch (node.type) {
      case "heading":
        return processHeading(node as Heading);
      case "paragraph":
        return processParagraph(node as Paragraph);
      case "list":
        return processList(node as List);
      case "code":
        return processCodeBlock(node as Code);
      case "blockquote":
        return processBlockquote(node as Blockquote);
      case "image":
        return processImage(node as Image);
      case "table":
        return processTable(node as Table);
      case "html":
        return classifyHtmlNode((node as { value?: string }).value || "");
      case "thematicBreak":
        // Horizontal rule - skip for now
        return null;
      default:
        return null;
    }
  }

  function processHeading(heading: Heading): DocxBlockNode {
    const children = processInlineNodes(heading.children);
    return {
      type: "heading",
      level: heading.depth,
      children,
    };
  }

  function processParagraph(
    paragraph: Paragraph,
  ): DocxBlockNode | DocxBlockNode[] {
    // If the paragraph consists of a single image, treat it as a block image
    if (
      paragraph.children.length === 1 &&
      (paragraph.children[0] as any).type === "image"
    ) {
      const img = paragraph.children[0] as Image;
      return {
        type: "image",
        alt: img.alt || "",
        url: img.url || "",
      };
    }

    if (paragraph.children.some((child) => (child as any).type === "image")) {
      const blocks: DocxBlockNode[] = [];
      let inlineBuffer: typeof paragraph.children = [];

      const flushInlineBuffer = (): void => {
        if (inlineBuffer.length === 0) {
          return;
        }

        blocks.push({
          type: "paragraph",
          children: processInlineNodes(inlineBuffer),
        });
        inlineBuffer = [];
      };

      for (const child of paragraph.children) {
        if ((child as any).type === "image") {
          flushInlineBuffer();
          const image = child as Image;
          blocks.push({
            type: "image",
            alt: image.alt || "",
            url: image.url || "",
          });
        } else {
          inlineBuffer.push(child);
        }
      }

      flushInlineBuffer();
      return blocks;
    }

    // Regular paragraph with inline content
    const children = processInlineNodes(paragraph.children);
    return {
      type: "paragraph",
      children,
    };
  }

  function processList(list: List): DocxBlockNode {
    // Assign sequence ID for numbered lists
    if (list.ordered && !listSequenceMap.has(list)) {
      numberedListSequenceId++;
      listSequenceMap.set(list, numberedListSequenceId);
    }

    const listItems: DocxListItemNode[] = [];
    for (const item of list.children) {
      const itemChildren: DocxBlockNode[] = [];

      // Process children of list item (ListItem.children is FlowContent[])
      for (const child of item.children) {
        if (child.type === "list") {
          // Nested list - process recursively
          const nestedList = processList(child as List);
          if (nestedList) {
            itemChildren.push(nestedList);
          }
        } else if (child.type === "paragraph") {
          const processedParagraph = processParagraph(child as Paragraph);
          if (Array.isArray(processedParagraph)) {
            itemChildren.push(...processedParagraph);
          } else {
            itemChildren.push(processedParagraph);
          }
        } else {
          // Other block content (headings, code blocks, etc.)
          const processed = processNode(child);
          if (processed) {
            if (Array.isArray(processed)) {
              itemChildren.push(...processed);
            } else {
              itemChildren.push(processed);
            }
          }
        }
      }

      // If no block children, create an empty paragraph
      if (itemChildren.length === 0) {
        itemChildren.push({
          type: "paragraph",
          children: [],
        });
      }

      listItems.push({
        type: "listItem",
        children: itemChildren,
      });
    }

    return {
      type: "list",
      ordered: list.ordered || false,
      children: listItems,
      sequenceId: list.ordered ? listSequenceMap.get(list) : undefined,
    };
  }

  function processCodeBlock(code: Code): DocxBlockNode {
    const language = code.lang || undefined;
    const normalizedLanguage = language?.toLowerCase();
    if (
      _options.chartRendering?.enabled === true &&
      (normalizedLanguage === "chart" || normalizedLanguage === "chartjs")
    ) {
      return {
        type: "chartBlock",
        language,
        value: code.value || "",
      };
    }

    return {
      type: "codeBlock",
      language,
      value: code.value || "",
    };
  }

  function processBlockquote(blockquote: Blockquote): DocxBlockNode {
    const children: DocxBlockNode[] = [];
    for (const child of blockquote.children) {
      const processed = processNode(child);
      if (processed) {
        if (Array.isArray(processed)) {
          children.push(...processed);
        } else {
          children.push(processed);
        }
      }
    }
    return {
      type: "blockquote",
      children,
    };
  }

  function processImage(image: Image): DocxBlockNode {
    return {
      type: "image",
      alt: image.alt || "",
      url: image.url || "",
    };
  }

  function processTable(table: Table): DocxBlockNode {
    const headers: DocxTextNode[][] = [];
    const rows: DocxTextNode[][][] = [];

    if (table.children.length > 0) {
      const headerRow = table.children[0] as TableRow;
      for (const cell of headerRow.children) {
        headers.push(extractRichTextFromTableCell(cell as TableCell));
      }

      for (let i = 1; i < table.children.length; i++) {
        const row = table.children[i] as TableRow;
        const rowData: DocxTextNode[][] = [];
        for (const cell of row.children) {
          rowData.push(extractRichTextFromTableCell(cell as TableCell));
        }
        rows.push(rowData);
      }
    }

    return {
      type: "table",
      headers,
      rows,
      align: table.align || undefined,
    };
  }

  function extractRichTextFromTableCell(cell: TableCell): DocxTextNode[] {
    const nodes: DocxTextNode[] = [];
    for (const child of cell.children as any[]) {
      if (child.type === "paragraph") {
        nodes.push(...processInlineNodes(child.children));
      } else {
        nodes.push(...processInlineNodes([child]));
      }
    }
    return nodes;
  }

  function processInlineNodes(nodes: any[]): DocxTextNode[] {
    const result: DocxTextNode[] = [];

    function pushTextWithUnderline(value: string): void {
      const parts = value.split(/(\+\+[^+\n][\s\S]*?\+\+)/g);
      for (const part of parts) {
        if (part.startsWith("++") && part.endsWith("++") && part.length > 4) {
          result.push({
            type: "text",
            value: part.slice(2, -2),
            underline: true,
          });
        } else if (part.length > 0) {
          result.push({
            type: "text",
            value: part,
          });
        }
      }
    }

    for (const node of nodes) {
      switch (node.type) {
        case "text":
          pushTextWithUnderline((node as Text).value);
          break;
        case "emphasis": {
          const emphasisChildren = processInlineNodes(
            (node as Emphasis).children,
          );
          for (const child of emphasisChildren) {
            result.push({
              ...child,
              italic: true,
            });
          }
          break;
        }
        case "strong": {
          const strongChildren = processInlineNodes((node as Strong).children);
          for (const child of strongChildren) {
            result.push({
              ...child,
              bold: true,
            });
          }
          break;
        }
        case "delete": {
          const strikeChildren = processInlineNodes((node as Delete).children);
          for (const child of strikeChildren) {
            result.push({
              ...child,
              strikethrough: true,
            });
          }
          break;
        }
        case "inlineCode":
          result.push({
            type: "text",
            value: (node as InlineCode).value,
            code: true,
          });
          break;
        case "link": {
          const previous = result[result.length - 1];
          if (
            previous?.type === "text" &&
            /\[[^\]]+\]\($/.test(previous.value) &&
            (node as Link).children.length === 1 &&
            (node as Link).children[0].type === "text" &&
            ((node as Link).children[0] as Text).value === (node as Link).url
          ) {
            previous.value += (node as Link).url;
            break;
          }
          const linkChildren = processInlineNodes((node as Link).children);
          for (const child of linkChildren) {
            result.push({
              ...child,
              link: (node as Link).url,
            });
          }
          break;
        }
        case "break":
          result.push({
            type: "text",
            value: "\n",
          });
          break;
        default:
          // Unknown inline node - try to extract text
          if ((node as any).value) {
            result.push({
              type: "text",
              value: String((node as any).value),
            });
          }
      }
    }

    return result;
  }

  // Process root children
  for (const child of root.children) {
    // Handle special cases for TOC and page breaks
    if (child.type === "paragraph") {
      const para = child as Paragraph;
      // Check if paragraph contains only text nodes
      const textContent = para.children
        .filter((c) => c.type === "text")
        .map((c) => (c as Text).value)
        .join("")
        .trim();
      if (textContent === "[TOC]") {
        children.push({ type: "tocPlaceholder" });
        continue;
      }
      if (textContent === "\\pagebreak" || textContent === "\\pagebreak") {
        children.push({ type: "pageBreak" });
        continue;
      }
    }

    // Handle HTML comments and page-break markers.
    if (child.type === "html") {
      const classified = classifyHtmlNode(
        (child as { value?: string }).value || "",
      );
      if (classified) {
        children.push(classified);
      }
      continue;
    }

    const processed = processNode(child);
    if (processed) {
      if (Array.isArray(processed)) {
        children.push(...processed);
      } else {
        children.push(processed);
      }
    }
  }

  return { children };
}
