import {
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  ExternalHyperlink,
  PageBreak,
  AlignmentType,
  TableLayoutType,
  WidthType,
} from "docx";
import type { DocxDocumentModel, DocxBlockNode, DocxListNode, DocxListItemNode, DocxTextNode } from "./docxModel.js";
import { Style, Options } from "./types.js";
import { processHeading } from "./renderers/headingRenderer.js";
import { processCodeBlock } from "./renderers/codeRenderer.js";
import { processBlockquote } from "./renderers/blockquoteRenderer.js";
import { processComment } from "./renderers/commentRenderer.js";
import {
  processImage,
  resolveImageHandlingOptions,
} from "./renderers/imageRenderer.js";
import { processInlineCode } from "./renderers/textRenderer.js";
import { resolveFontFamily } from "./utils/styleUtils.js";
import { sanitizeForBookmarkId } from "./utils/bookmarkUtils.js";

/**
 * Converts internal docx model to docx Paragraph/Table objects
 * Handles nested lists with proper level tracking
 */
export async function modelToDocx(
  model: DocxDocumentModel,
  style: Style,
  options: Options,
  renderOptions: {
    sequenceIdOffset?: number;
    /** When set by `parseToDocxOptions`, ties `maxImages` to the whole document across sections. */
    processedImageCounter?: { count: number };
    headingBookmarkCounter?: { count: number };
  } = {}
): Promise<{
  children: (Paragraph | Table)[];
  headings: { text: string; level: number; bookmarkId: string }[];
  maxSequenceId: number;
}> {
  const children: (Paragraph | Table)[] = [];
  const headings: { text: string; level: number; bookmarkId: string }[] = [];
  const documentType = options.documentType || "document";
  const sequenceIdOffset = renderOptions.sequenceIdOffset || 0;
  const imageHandling = resolveImageHandlingOptions(options.imageHandling);
  const processedImageCounter = renderOptions.processedImageCounter ?? {
    count: 0,
  };

  // Track numbering sequences for nested lists
  let maxSequenceId = 0;
  const headingBookmarkCounter = renderOptions.headingBookmarkCounter ?? {
    count: 0,
  };

  function encodeInlineNode(node: {
    value: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    code?: boolean;
    link?: string;
  }): string {
    if (node.code) {
      return "`" + node.value + "`";
    }

    let text = node.link ? `[${node.value}](${node.link})` : node.value;

    if (node.strikethrough) {
      text = `~~${text}~~`;
    }
    if (node.underline) {
      text = `++${text}++`;
    }

    if (node.bold && node.italic) return "***" + text + "***";
    if (node.bold) return "**" + text + "**";
    if (node.italic) return "*" + text + "*";
    return text;
  }

  function textRunFromNode(
    node: DocxTextNode,
    overrides: { forceBold?: boolean; size?: number } = {}
  ): TextRun {
    if (node.code) {
      return processInlineCode(node.value, style);
    }

    return new TextRun({
      text: node.value,
      bold: overrides.forceBold || node.bold,
      italics: node.italic,
      strike: node.strikethrough,
      underline: node.underline ? { type: "single" } : undefined,
      color: node.link ? "0000FF" : "000000",
      size: overrides.size || style.paragraphSize || 24,
      font: resolveFontFamily(style),
      rightToLeft: style.direction === "RTL",
    });
  }

  function renderInlineNodes(
    nodes: DocxTextNode[],
    overrides: { forceBold?: boolean; size?: number } = {}
  ): (TextRun | ExternalHyperlink)[] {
    const out: (TextRun | ExternalHyperlink)[] = [];
    for (const node of nodes) {
      if (node.link) {
        out.push(
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: node.value,
                color: "0000FF",
                underline: { type: "single" },
                bold: overrides.forceBold || node.bold,
                italics: node.italic,
                strike: node.strikethrough,
                size: overrides.size || style.paragraphSize || 24,
                font: resolveFontFamily(style),
                rightToLeft: style.direction === "RTL",
              }),
            ],
            link: node.link,
          })
        );
      } else {
        out.push(textRunFromNode(node, overrides));
      }
    }

    if (out.length === 0) {
      out.push(textRunFromNode({ type: "text", value: "" }, overrides));
    }
    return out;
  }

  function paragraphFromInlineNodes(nodes: DocxTextNode[]): Paragraph {
    const alignment = style.paragraphAlignment
      ? AlignmentType[style.paragraphAlignment]
      : AlignmentType.LEFT;
    return new Paragraph({
      children: renderInlineNodes(nodes),
      spacing: {
        before: style.paragraphSpacing,
        after: style.paragraphSpacing,
        line: style.lineSpacing * 240,
      },
      alignment,
      indent:
        style.paragraphAlignment === "JUSTIFIED"
          ? { left: 0, right: 0 }
          : undefined,
      bidirectional: style.direction === "RTL",
    });
  }

  function tableFromNode(node: Extract<DocxBlockNode, { type: "table" }>): Table {
    const layout =
      style.tableLayout === "fixed" ? TableLayoutType.FIXED : TableLayoutType.AUTOFIT;
    const getColumnAlignment = (
      index: number
    ): (typeof AlignmentType)[keyof typeof AlignmentType] => {
      const align = node.align?.[index];
      if (align === "center") return AlignmentType.CENTER;
      if (align === "right") return AlignmentType.RIGHT;
      return AlignmentType.LEFT;
    };

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: node.headers.map(
            (cell, index) =>
              new TableCell({
                children: [
                  new Paragraph({
                    alignment: getColumnAlignment(index),
                    style: "Strong",
                    children: renderInlineNodes(cell, { forceBold: true }),
                  }),
                ],
                shading: {
                  fill: documentType === "report" ? "DDDDDD" : "F2F2F2",
                },
              })
          ),
        }),
        ...node.rows.map(
          (row) =>
            new TableRow({
              children: row.map(
                (cell, index) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        alignment: getColumnAlignment(index),
                        children: renderInlineNodes(cell),
                      }),
                    ],
                  })
              ),
            })
        ),
      ],
      layout,
      margins: {
        top: 100,
        bottom: 100,
        left: 100,
        right: 100,
      },
    });
  }

  function listParagraphFromInlineNodes(
    nodes: DocxTextNode[],
    isOrdered: boolean,
    level: number,
    sequenceId: number | undefined
  ): Paragraph {
    const base = {
      children: renderInlineNodes(nodes, { size: style.listItemSize || 24 }),
      spacing: {
        before: style.paragraphSpacing / 2,
        after: style.paragraphSpacing / 2,
      },
      bidirectional: style.direction === "RTL",
    };

    if (isOrdered) {
      return new Paragraph({
        ...base,
        numbering: {
          reference: `numbered-list-${sequenceId || 1}`,
          level,
        },
      });
    }

    return new Paragraph({
      ...base,
      bullet: { level },
    });
  }

  function renderBlockNode(
    node: DocxBlockNode,
    listLevel: number = 0
  ): (Paragraph | Table)[] {
    switch (node.type) {
      case "heading": {
        // Re-encode inline formatting into markdown-like syntax for helpers.
        const headingText = node.children.map((c) => encodeInlineNode(c)).join("");

        const headingLine = "#".repeat(node.level) + " " + headingText;
        headingBookmarkCounter.count++;
        const config = {
          level: node.level,
          size: 0,
          style: node.level === 1 ? "Title" : undefined,
          bookmarkId: `_Toc_${sanitizeForBookmarkId(headingText)}_${headingBookmarkCounter.count}`,
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
        return [paragraphFromInlineNodes(node.children)];
      }

      case "list": {
        return renderList(node, listLevel || 0);
      }

      case "codeBlock": {
        return [
          processCodeBlock(
            node.value,
            node.language,
            style,
            options.codeHighlighting
          ),
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
        return [];
      }

      case "table": {
        return [tableFromNode(node)];
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
    const adjustedSequenceId = list.sequenceId
      ? list.sequenceId + sequenceIdOffset
      : undefined;

    // Track max sequence ID
    if (adjustedSequenceId && adjustedSequenceId > maxSequenceId) {
      maxSequenceId = adjustedSequenceId;
    }

    for (const item of list.children) {
      // Render list item content
      const itemParagraphs = renderListItem(
        item,
        list.ordered,
        currentLevel,
        adjustedSequenceId,
        itemNumber
      );
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
        paragraphs.push(
          listParagraphFromInlineNodes(child.children, isOrdered, level, sequenceId)
        );
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
      paragraphs.push(
        listParagraphFromInlineNodes([], isOrdered, level, sequenceId)
      );
    }

    return paragraphs;
  }

  function imageCouldNotLoadParagraph(alt: string): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({
          text: `[Image could not be loaded: ${alt}]`,
          italics: true,
          color: "FF0000",
        }),
      ],
      alignment: AlignmentType.CENTER,
      bidirectional: style.direction === "RTL",
    });
  }

  // Process all top-level nodes
  let previousNodeType: string | undefined;
  for (const node of model.children) {
    // Insert a blank spacer paragraph between back-to-back code blocks so
    // Word doesn't collapse the shared borders into a single visual block.
    if (node.type === "codeBlock" && previousNodeType === "codeBlock") {
      children.push(new Paragraph({ children: [], spacing: { before: 0, after: 0 } }));
    }

    if (node.type === "image") {
      try {
        if (processedImageCounter.count >= imageHandling.maxImages) {
          children.push(imageCouldNotLoadParagraph(node.alt));
        } else {
          const { embedded, paragraphs } = await processImage(
            node.alt,
            node.url,
            style,
            imageHandling
          );
          children.push(...paragraphs);
          if (embedded) {
            processedImageCounter.count++;
          }
        }
      } catch {
        children.push(imageCouldNotLoadParagraph(node.alt));
      }
    } else {
      const rendered = renderBlockNode(node);
      children.push(...rendered);
    }

    previousNodeType = node.type;
  }

  return { children, headings, maxSequenceId };
}
