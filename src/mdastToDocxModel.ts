import type { Root, Node, List, ListItem, Heading, Paragraph, Code, Blockquote, Image, Table, TableRow, TableCell, Text, Emphasis, Strong, InlineCode, Link, Break } from "mdast";
import type { DocxDocumentModel, DocxBlockNode, DocxTextNode, DocxListNode, DocxListItemNode } from "./docxModel.js";
import { Style, Options } from "./types.js";

/**
 * Converts mdast AST to internal docx-friendly model
 * Handles nested lists properly using AST structure
 */
export function mdastToDocxModel(root: Root, style: Style, options: Options): DocxDocumentModel {
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
        // Handle HTML comments and special markers
        const htmlValue = (node as any).value || "";
        if (htmlValue.trim() === "<!--COMMENT:") {
          // This is a comment marker - we'll handle it specially
          return null; // Will be handled by looking ahead
        }
        if (htmlValue.includes("COMMENT:")) {
          const match = htmlValue.match(/COMMENT:\s*(.+?)(?:-->)?/);
          if (match) {
            return {
              type: "comment",
              value: match[1].trim(),
            };
          }
        }
        if (htmlValue.includes("\\pagebreak") || htmlValue.includes("pagebreak")) {
          return { type: "pageBreak" };
        }
        return null;
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

  function processParagraph(paragraph: Paragraph): DocxBlockNode {
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
          // Paragraph - convert to our paragraph model
          const para = child as Paragraph;
          const inlineChildren = processInlineNodes(para.children);
          itemChildren.push({
            type: "paragraph",
            children: inlineChildren,
          });
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
    return {
      type: "codeBlock",
      language: code.lang || undefined,
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
    const headers: string[] = [];
    const rows: string[][] = [];

    if (table.children.length > 0) {
      // First row is header
      const headerRow = table.children[0] as TableRow;
      for (const cell of headerRow.children) {
        const cellText = extractTextFromTableCell(cell as TableCell);
        headers.push(cellText);
      }

      // Remaining rows
      for (let i = 1; i < table.children.length; i++) {
        const row = table.children[i] as TableRow;
        const rowData: string[] = [];
        for (const cell of row.children) {
          const cellText = extractTextFromTableCell(cell as TableCell);
          rowData.push(cellText);
        }
        rows.push(rowData);
      }
    }

    return {
      type: "table",
      headers,
      rows,
    };
  }

  function extractTextFromTableCell(cell: TableCell): string {
    let text = "";
    // TableCell.children is FlowContent[] which can include paragraphs
    for (const child of cell.children as any[]) {
      if (child.type === "paragraph") {
        text += extractTextFromInlineNodes(child.children);
      } else if (child.type === "text") {
        text += child.value;
      }
    }
    return text.trim();
  }

  function processInlineNodes(nodes: any[]): DocxTextNode[] {
    const result: DocxTextNode[] = [];
    
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          result.push({
            type: "text",
            value: (node as Text).value,
          });
          break;
        case "emphasis":
          const emphasisChildren = processInlineNodes((node as Emphasis).children);
          for (const child of emphasisChildren) {
            result.push({
              ...child,
              italic: true,
            });
          }
          break;
        case "strong":
          const strongChildren = processInlineNodes((node as Strong).children);
          for (const child of strongChildren) {
            result.push({
              ...child,
              bold: true,
            });
          }
          break;
        case "inlineCode":
          result.push({
            type: "text",
            value: (node as InlineCode).value,
            code: true,
          });
          break;
        case "link":
          const linkChildren = processInlineNodes((node as Link).children);
          for (const child of linkChildren) {
            result.push({
              ...child,
              link: (node as Link).url,
            });
          }
          break;
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

  function extractTextFromInlineNodes(nodes: any[]): string {
    let text = "";
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          text += (node as Text).value;
          break;
        case "emphasis":
        case "strong":
          text += extractTextFromInlineNodes((node as any).children);
          break;
        case "inlineCode":
          text += (node as InlineCode).value;
          break;
        case "link":
          text += extractTextFromInlineNodes((node as Link).children);
          break;
        case "break":
          text += "\n";
          break;
        default:
          if ((node as any).value) {
            text += String((node as any).value);
          }
      }
    }
    return text;
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
    
    // Handle HTML comments for COMMENT: markers
    if (child.type === "html") {
      const htmlValue = (child as any).value || "";
      if (htmlValue.includes("COMMENT:")) {
        const match = htmlValue.match(/COMMENT:\s*(.+?)(?:-->)?/);
        if (match) {
          children.push({
            type: "comment",
            value: match[1].trim(),
          });
          continue;
        }
      }
      if (htmlValue.includes("pagebreak") || htmlValue.includes("\\pagebreak")) {
        children.push({ type: "pageBreak" });
        continue;
      }
      // Skip other HTML nodes
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

