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
  FootnoteDefinition,
  FootnoteReference,
} from "mdast";
import type {
  DocxDocumentModel,
  DocxBlockNode,
  DocxCalloutType,
  DocxInlineNode,
  DocxListItemNode,
  DocxFootnoteDefinitionNode,
} from "./docxModel.js";
import { Style, Options } from "./types.js";

const GITHUB_CALLOUT_MARKER =
  /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n[ \t]*)?/i;

interface ProcessOptions {
  allowFootnoteReferences?: boolean;
}

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

function stripGithubCalloutMarker(
  paragraph: Paragraph,
): { calloutType: DocxCalloutType; paragraph: Paragraph | null } | null {
  const firstChild = paragraph.children[0];
  if (!firstChild || firstChild.type !== "text") {
    return null;
  }

  const markerMatch = firstChild.value.match(GITHUB_CALLOUT_MARKER);
  if (!markerMatch) {
    return null;
  }

  const calloutType = markerMatch[1].toLowerCase() as DocxCalloutType;
  const remainingValue = firstChild.value.slice(markerMatch[0].length);
  const children = [
    ...(remainingValue.length > 0
      ? [{ ...firstChild, value: remainingValue }]
      : []),
    ...paragraph.children.slice(1),
  ] as Paragraph["children"];

  return {
    calloutType,
    paragraph:
      children.length > 0
        ? {
            ...paragraph,
            children,
          }
        : null,
  };
}

/**
 * Converts mdast AST to internal docx-friendly model
 * Handles nested lists properly using AST structure
 */
export function mdastToDocxModel(
  root: Root,
  _style: Style,
  options: Options,
): DocxDocumentModel {
  const children: DocxBlockNode[] = [];
  const footnoteDefinitions = new Map<string, FootnoteDefinition>();
  const referencedFootnoteIds = new Map<string, number>();
  let numberedListSequenceId = 0;
  const listSequenceMap = new Map<List, number>();

  for (const child of root.children) {
    if (child.type === "footnoteDefinition") {
      const definition = child as FootnoteDefinition;
      footnoteDefinitions.set(
        normalizeFootnoteIdentifier(definition.identifier),
        definition,
      );
    }
  }

  function normalizeFootnoteIdentifier(identifier: string): string {
    return identifier.trim().toLowerCase();
  }

  function footnoteLabel(
    node: Pick<FootnoteReference | FootnoteDefinition, "identifier" | "label">,
  ): string {
    return node.label || node.identifier;
  }

  function footnoteReferenceId(identifier: string): number {
    const normalizedIdentifier = normalizeFootnoteIdentifier(identifier);
    const existingId = referencedFootnoteIds.get(normalizedIdentifier);
    if (existingId) {
      return existingId;
    }

    const id = referencedFootnoteIds.size + 1;
    referencedFootnoteIds.set(normalizedIdentifier, id);
    return id;
  }

  function processNode(
    node: Node,
    options: ProcessOptions = {},
  ): DocxBlockNode | DocxBlockNode[] | null {
    switch (node.type) {
      case "heading":
        return processHeading(node as Heading, options);
      case "paragraph":
        return processParagraph(node as Paragraph, options);
      case "list":
        return processList(node as List, options);
      case "code":
        return processCodeBlock(node as Code);
      case "math":
        return processMathBlock(node as { value?: string });
      case "blockquote":
        return processBlockquote(node as Blockquote, options);
      case "image":
        return processImage(node as Image);
      case "table":
        return processTable(node as Table, options);
      case "html":
        return classifyHtmlNode((node as { value?: string }).value || "");
      case "thematicBreak":
        // Horizontal rule - skip for now
        return null;
      default:
        return null;
    }
  }

  function processHeading(
    heading: Heading,
    options: ProcessOptions = {},
  ): DocxBlockNode {
    const children = processInlineNodes(heading.children, options);
    return {
      type: "heading",
      level: heading.depth,
      children,
    };
  }

  function processParagraph(
    paragraph: Paragraph,
    options: ProcessOptions = {},
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
          children: processInlineNodes(inlineBuffer, options),
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
    const children = processInlineNodes(paragraph.children, options);
    return {
      type: "paragraph",
      children,
    };
  }

  function processList(
    list: List,
    options: ProcessOptions = {},
  ): DocxBlockNode {
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
          const nestedList = processList(child as List, options);
          if (nestedList) {
            itemChildren.push(nestedList);
          }
        } else if (child.type === "paragraph") {
          const processedParagraph = processParagraph(
            child as Paragraph,
            options,
          );
          if (Array.isArray(processedParagraph)) {
            itemChildren.push(...processedParagraph);
          } else {
            itemChildren.push(processedParagraph);
          }
        } else {
          // Other block content (headings, code blocks, etc.)
          const processed = processNode(child, options);
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
    const normalizedLanguage = language?.trim().toLowerCase();
    if (
      options.mermaidRendering?.enabled === true &&
      normalizedLanguage === "mermaid"
    ) {
      return {
        type: "mermaidBlock",
        value: code.value || "",
        meta: code.meta || undefined,
      };
    }

    if (
      options.chartRendering?.enabled === true &&
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

  function processMathBlock(math: { value?: string }): DocxBlockNode {
    return {
      type: "mathBlock",
      value: math.value || "",
    };
  }

  function processBlockquote(
    blockquote: Blockquote,
    options: ProcessOptions = {},
  ): DocxBlockNode {
    const children: DocxBlockNode[] = [];
    const firstChild = blockquote.children[0];
    const callout =
      firstChild?.type === "paragraph"
        ? stripGithubCalloutMarker(firstChild as Paragraph)
        : null;
    const blockquoteChildren = callout
      ? [
          ...(callout.paragraph ? [callout.paragraph] : []),
          ...blockquote.children.slice(1),
        ]
      : blockquote.children;

    for (const child of blockquoteChildren) {
      const processed = processNode(child, options);
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
      calloutType: callout?.calloutType,
    };
  }

  function processImage(image: Image): DocxBlockNode {
    return {
      type: "image",
      alt: image.alt || "",
      url: image.url || "",
    };
  }

  function processTable(
    table: Table,
    options: ProcessOptions = {},
  ): DocxBlockNode {
    const headers: DocxInlineNode[][] = [];
    const rows: DocxInlineNode[][][] = [];

    if (table.children.length > 0) {
      const headerRow = table.children[0] as TableRow;
      for (const cell of headerRow.children) {
        headers.push(extractRichTextFromTableCell(cell as TableCell, options));
      }

      for (let i = 1; i < table.children.length; i++) {
        const row = table.children[i] as TableRow;
        const rowData: DocxInlineNode[][] = [];
        for (const cell of row.children) {
          rowData.push(extractRichTextFromTableCell(cell as TableCell, options));
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

  function extractRichTextFromTableCell(
    cell: TableCell,
    options: ProcessOptions = {},
  ): DocxInlineNode[] {
    const nodes: DocxInlineNode[] = [];
    for (const child of cell.children as any[]) {
      if (child.type === "paragraph") {
        nodes.push(...processInlineNodes(child.children, options));
      } else {
        nodes.push(...processInlineNodes([child], options));
      }
    }
    return nodes;
  }

  function processInlineNodes(
    nodes: any[],
    options: ProcessOptions = {},
  ): DocxInlineNode[] {
    const result: DocxInlineNode[] = [];
    const allowFootnoteReferences = options.allowFootnoteReferences ?? true;

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
            options,
          );
          for (const child of emphasisChildren) {
            result.push(
              child.type === "text" ? { ...child, italic: true } : child,
            );
          }
          break;
        }
        case "strong": {
          const strongChildren = processInlineNodes(
            (node as Strong).children,
            options,
          );
          for (const child of strongChildren) {
            result.push(child.type === "text" ? { ...child, bold: true } : child);
          }
          break;
        }
        case "delete": {
          const strikeChildren = processInlineNodes(
            (node as Delete).children,
            options,
          );
          for (const child of strikeChildren) {
            result.push(
              child.type === "text"
                ? { ...child, strikethrough: true }
                : child,
            );
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
          const linkChildren = processInlineNodes((node as Link).children, options);
          for (const child of linkChildren) {
            result.push(
              child.type === "text" ? { ...child, link: (node as Link).url } : child,
            );
          }
          break;
        }
        case "footnoteReference": {
          const footnoteReference = node as FootnoteReference;
          const normalizedIdentifier = normalizeFootnoteIdentifier(
            footnoteReference.identifier,
          );

          if (
            allowFootnoteReferences &&
            footnoteDefinitions.has(normalizedIdentifier)
          ) {
            result.push({
              type: "footnoteReference",
              identifier: normalizedIdentifier,
              id: footnoteReferenceId(normalizedIdentifier),
            });
          } else {
            result.push({
              type: "text",
              value: `[^${footnoteLabel(footnoteReference)}]`,
            });
          }
          break;
        }
        case "inlineMath":
          result.push({
            type: "mathInline",
            value: String((node as { value?: string }).value || ""),
          });
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

  function processFootnoteDefinition(
    definition: FootnoteDefinition,
    id: number,
  ): DocxFootnoteDefinitionNode {
    const footnoteChildren: DocxBlockNode[] = [];

    for (const child of definition.children) {
      const processed = processFootnoteDefinitionChild(child);
      if (processed) {
        if (Array.isArray(processed)) {
          footnoteChildren.push(...processed);
        } else {
          footnoteChildren.push(processed);
        }
      }
    }

    if (footnoteChildren.length === 0) {
      footnoteChildren.push({
        type: "paragraph",
        children: [],
      });
    }

    return {
      identifier: normalizeFootnoteIdentifier(definition.identifier),
      id,
      children: footnoteChildren,
    };
  }

  function processFootnoteDefinitionChild(
    node: Node,
  ): DocxBlockNode | DocxBlockNode[] | null {
    if (node.type === "paragraph") {
      const paragraph = node as Paragraph;
      return {
        type: "paragraph",
        children: processInlineNodes(paragraph.children, {
          allowFootnoteReferences: false,
        }),
      };
    }

    return processNode(node, { allowFootnoteReferences: false });
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

    if (child.type === "footnoteDefinition") {
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

  const footnotes = Array.from(referencedFootnoteIds.entries()).map(
    ([identifier, id]) =>
      processFootnoteDefinition(footnoteDefinitions.get(identifier)!, id),
  );

  return { children, footnotes };
}
