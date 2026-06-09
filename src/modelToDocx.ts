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
import type { IParagraphOptions } from "docx";
import type {
  DocxDocumentModel,
  DocxBlockNode,
  DocxListNode,
  DocxListItemNode,
  DocxTextNode,
} from "./docxModel.js";
import { Style, Options } from "./types.js";
import { processHeading } from "./renderers/headingRenderer.js";
import { processCodeBlock } from "./renderers/codeRenderer.js";
import { blockquoteParagraphStyle } from "./renderers/blockquoteRenderer.js";
import { processComment } from "./renderers/commentRenderer.js";
import {
  processImage,
  resolveImageHandlingOptions,
} from "./renderers/imageRenderer.js";
import { processInlineCode } from "./renderers/textRenderer.js";
import { resolveFontFamily } from "./utils/styleUtils.js";
import { sanitizeForBookmarkId } from "./utils/bookmarkUtils.js";
import { throwIfAborted } from "./processingLimits.js";
import { MarkdownConversionError } from "./errors.js";

/** Rendering overrides shared across inline-node renderers. */
interface InlineOverrides {
  forceBold?: boolean;
  forceItalic?: boolean;
  size?: number;
}

interface RenderContext {
  quoteLevel?: number;
}

interface ListMarkerContext {
  isOrdered: boolean;
  level: number;
  sequenceId: number | undefined;
}

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Hyperlink targets are restricted to a scheme allowlist so a malicious
 * document cannot embed e.g. file:// UNC links (NTLM credential leak when
 * clicked in Word on Windows) or other unexpected protocol handlers.
 * Scheme-less (relative/fragment) targets carry no protocol to abuse and
 * are allowed.
 */
function isSafeLinkUrl(url: string): boolean {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return true;
  }
  return SAFE_LINK_PROTOCOLS.has(protocol.toLowerCase());
}

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
    /** Document-wide budget for failed remote image fetch attempts. */
    failedRemoteImageCounter?: { count: number };
    headingBookmarkCounter?: { count: number };
    /** Records emitted TOC placeholder paragraphs so the caller can splice in TOC content. */
    tocPlaceholders?: WeakSet<object>;
    /**
     * Usable content width of the section in twips. Tables are sized with this
     * value (as {@link WidthType.DXA}) so they emit a plain integer width,
     * avoiding the percentage form that Word 2007 treats as corrupt.
     */
    tableWidthTwips?: number;
  } = {},
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
  const failedRemoteImageCounter = renderOptions.failedRemoteImageCounter ?? {
    count: 0,
  };
  // Full-width tables are sized in twips so docx emits a plain integer width.
  // Defaults to A4 portrait content width (page 11906 - default 1080 margins).
  const tableWidthTwips = renderOptions.tableWidthTwips ?? 9746;

  // Track numbering sequences for nested lists
  let maxSequenceId = 0;
  const headingBookmarkCounter = renderOptions.headingBookmarkCounter ?? {
    count: 0,
  };

  throwIfAborted(options.signal);

  function textRunFromNode(
    node: DocxTextNode,
    overrides: InlineOverrides = {},
  ): TextRun {
    if (node.code) {
      return processInlineCode(node.value, style, { size: overrides.size });
    }

    return new TextRun({
      text: node.value,
      bold: overrides.forceBold || node.bold,
      italics: overrides.forceItalic || node.italic,
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
    overrides: InlineOverrides = {},
  ): (TextRun | ExternalHyperlink)[] {
    const out: (TextRun | ExternalHyperlink)[] = [];
    for (const node of nodes) {
      if (node.link && !isSafeLinkUrl(node.link)) {
        out.push(textRunFromNode({ ...node, link: undefined }, overrides));
      } else if (node.link) {
        out.push(
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: node.value,
                color: "0000FF",
                underline: { type: "single" },
                bold: overrides.forceBold || node.bold,
                italics: overrides.forceItalic || node.italic,
                strike: node.strikethrough,
                size: overrides.size || style.paragraphSize || 24,
                font: resolveFontFamily(style),
                rightToLeft: style.direction === "RTL",
              }),
            ],
            link: node.link,
          }),
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

  function paragraphFromInlineNodes(
    nodes: DocxTextNode[],
    context: RenderContext = {},
    overrides: InlineOverrides = {},
  ): Paragraph {
    const alignment = style.paragraphAlignment
      ? AlignmentType[style.paragraphAlignment]
      : AlignmentType.LEFT;
    const quoteStyle = context.quoteLevel
      ? blockquoteParagraphStyle(style, context.quoteLevel)
      : undefined;
    return new Paragraph({
      children: renderInlineNodes(nodes, overrides),
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
      ...quoteStyle,
    });
  }

  function tableFromNode(
    node: Extract<DocxBlockNode, { type: "table" }>,
  ): Table {
    const layout =
      style.tableLayout === "fixed"
        ? TableLayoutType.FIXED
        : TableLayoutType.AUTOFIT;
    const getColumnAlignment = (
      index: number,
    ): (typeof AlignmentType)[keyof typeof AlignmentType] => {
      const align = node.align?.[index];
      if (align === "center") return AlignmentType.CENTER;
      if (align === "right") return AlignmentType.RIGHT;
      return AlignmentType.LEFT;
    };

    return new Table({
      width: { size: tableWidthTwips, type: WidthType.DXA },
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
              }),
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
                  }),
              ),
            }),
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
    sequenceId: number | undefined,
    context: RenderContext = {},
  ): Paragraph {
    const quoteStyle = context.quoteLevel
      ? blockquoteParagraphStyle(style, context.quoteLevel)
      : undefined;
    const base = {
      children: renderInlineNodes(nodes, { size: style.listItemSize || 24 }),
      spacing: {
        before: style.paragraphSpacing / 2,
        after: style.paragraphSpacing / 2,
      },
      bidirectional: style.direction === "RTL",
      ...quoteStyle,
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

  function listContinuationParagraphFromInlineNodes(
    nodes: DocxTextNode[],
    level: number,
    context: RenderContext = {},
  ): Paragraph {
    const quoteStyle = context.quoteLevel
      ? blockquoteParagraphStyle(style, context.quoteLevel)
      : undefined;

    return new Paragraph({
      children: renderInlineNodes(nodes, { size: style.listItemSize || 24 }),
      spacing: {
        before: style.paragraphSpacing / 2,
        after: style.paragraphSpacing / 2,
      },
      indent: {
        left: 720 * (level + 1),
      },
      bidirectional: style.direction === "RTL",
      ...quoteStyle,
    });
  }

  async function renderBlockNode(
    node: DocxBlockNode,
    listLevel: number = 0,
    context: RenderContext = {},
  ): Promise<(Paragraph | Table)[]> {
    throwIfAborted(options.signal);

    switch (node.type) {
      case "heading": {
        const headingText = node.children.map((c) => c.value).join("");
        headingBookmarkCounter.count++;
        const bookmarkId = `_Toc_${sanitizeForBookmarkId(headingText)}_${headingBookmarkCounter.count}`;
        const { paragraph } = processHeading(
          node.children,
          { level: node.level, bookmarkId },
          style,
          (nodes, size) => renderInlineNodes(nodes, { size }),
        );
        headings.push({
          text: headingText,
          level: node.level,
          bookmarkId,
        });
        return [paragraph];
      }

      case "paragraph": {
        return [paragraphFromInlineNodes(node.children, context)];
      }

      case "list": {
        return renderList(node, listLevel || 0, context);
      }

      case "codeBlock": {
        return [
          processCodeBlock(
            node.value,
            node.language,
            style,
            options.codeHighlighting,
          ),
        ];
      }

      case "blockquote": {
        return renderBlockquote(node, listLevel, context);
      }

      case "image": {
        return renderImageNode(node, context);
      }

      case "table": {
        return [tableFromNode(node)];
      }

      case "comment": {
        if (!context.quoteLevel) {
          return [processComment(node.value, style)];
        }
        return [
          new Paragraph({
            children: [
              new TextRun({
                text: `Comment: ${node.value}`,
                italics: true,
                color: "666666",
                font: resolveFontFamily(style),
              }),
            ],
            ...blockquoteParagraphStyle(style, context.quoteLevel),
          }),
        ];
      }

      case "pageBreak": {
        return [new Paragraph({ children: [new PageBreak()] })];
      }

      case "tocPlaceholder": {
        const placeholder = new Paragraph({});
        renderOptions.tocPlaceholders?.add(placeholder);
        return [placeholder];
      }

      default:
        return [];
    }
  }

  async function renderBlockquote(
    node: Extract<DocxBlockNode, { type: "blockquote" }>,
    listLevel: number,
    context: RenderContext,
  ): Promise<(Paragraph | Table)[]> {
    throwIfAborted(options.signal);

    const quoteContext = { quoteLevel: (context.quoteLevel || 0) + 1 };
    const out: (Paragraph | Table)[] = [];

    if (node.children.length === 0) {
      out.push(
        paragraphFromInlineNodes([], quoteContext, {
          size: style.blockquoteSize || 24,
          forceItalic: true,
        }),
      );
      return out;
    }

    for (const child of node.children) {
      throwIfAborted(options.signal);

      if (child.type === "paragraph") {
        out.push(
          paragraphFromInlineNodes(child.children, quoteContext, {
            size: style.blockquoteSize || 24,
            forceItalic: true,
          }),
        );
        continue;
      }

      out.push(...(await renderBlockNode(child, 0, quoteContext)));
    }

    return out;
  }

  async function renderList(
    list: DocxListNode,
    currentLevel: number,
    context: RenderContext = {},
  ): Promise<Paragraph[]> {
    throwIfAborted(options.signal);

    const paragraphs: Paragraph[] = [];
    const adjustedSequenceId = list.sequenceId
      ? list.sequenceId + sequenceIdOffset
      : undefined;

    // Track max sequence ID
    if (adjustedSequenceId && adjustedSequenceId > maxSequenceId) {
      maxSequenceId = adjustedSequenceId;
    }

    for (const item of list.children) {
      throwIfAborted(options.signal);

      // Render list item content
      const itemParagraphs = renderListItem(
        item,
        list.ordered,
        currentLevel,
        adjustedSequenceId,
        context,
      );
      paragraphs.push(...(await itemParagraphs));
    }

    return paragraphs;
  }

  async function renderListItem(
    item: DocxListItemNode,
    isOrdered: boolean,
    level: number,
    sequenceId: number | undefined,
    context: RenderContext = {},
  ): Promise<Paragraph[]> {
    throwIfAborted(options.signal);

    const paragraphs: Paragraph[] = [];

    // Process children of list item
    for (const child of item.children) {
      throwIfAborted(options.signal);

      if (child.type === "list") {
        // Nested list - render recursively
        const nestedParagraphs = await renderList(
          child as DocxListNode,
          level + 1,
          context,
        );
        paragraphs.push(...nestedParagraphs);
      } else if (child.type === "paragraph") {
        if (paragraphs.length === 0) {
          paragraphs.push(
            listParagraphFromInlineNodes(
              child.children,
              isOrdered,
              level,
              sequenceId,
              context,
            ),
          );
        } else {
          paragraphs.push(
            listContinuationParagraphFromInlineNodes(
              child.children,
              level,
              context,
            ),
          );
        }
      } else {
        // Other block types - render normally but they'll appear as part of list item
        const markerContext =
          paragraphs.length === 0
            ? { isOrdered, level, sequenceId }
            : undefined;
        const rendered = await renderBlockNodeWithListMarker(
          child,
          level,
          context,
          markerContext,
        );
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
        listParagraphFromInlineNodes([], isOrdered, level, sequenceId, context),
      );
    }

    return paragraphs;
  }

  function imageParagraphOptions(
    context: RenderContext = {},
    listMarker?: ListMarkerContext,
  ): Partial<IParagraphOptions> {
    let options: Partial<IParagraphOptions> = {};

    if (context.quoteLevel) {
      options = {
        ...options,
        ...blockquoteParagraphStyle(style, context.quoteLevel),
      };
    }

    if (listMarker) {
      if (listMarker.isOrdered) {
        options = {
          ...options,
          numbering: {
            reference: `numbered-list-${listMarker.sequenceId || 1}`,
            level: listMarker.level,
          },
        };
      } else {
        options = {
          ...options,
          bullet: { level: listMarker.level },
        };
      }
    }

    return options;
  }

  async function renderBlockNodeWithListMarker(
    node: DocxBlockNode,
    listLevel: number,
    context: RenderContext,
    listMarker?: ListMarkerContext,
  ): Promise<(Paragraph | Table)[]> {
    if (node.type === "image") {
      return renderImageNode(node, context, listMarker);
    }

    if (listMarker) {
      const rendered = await renderBlockNode(node, listLevel, context);
      return [
        listParagraphFromInlineNodes(
          [],
          listMarker.isOrdered,
          listMarker.level,
          listMarker.sequenceId,
          context,
        ),
        ...rendered,
      ];
    }

    return renderBlockNode(node, listLevel, context);
  }

  function imageCouldNotLoadParagraph(
    alt: string,
    paragraphOptions: Partial<IParagraphOptions> = {},
  ): Paragraph {
    return new Paragraph({
      ...paragraphOptions,
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

  async function renderImageNode(
    node: Extract<DocxBlockNode, { type: "image" }>,
    context: RenderContext = {},
    listMarker?: ListMarkerContext,
  ): Promise<Paragraph[]> {
    throwIfAborted(options.signal);

    const paragraphOptions = imageParagraphOptions(context, listMarker);

    if (processedImageCounter.count >= imageHandling.maxImages) {
      return [imageCouldNotLoadParagraph(node.alt, paragraphOptions)];
    }

    // maxImages caps successful embeds only (so broken images cannot starve
    // valid ones of budget), but failed *remote* attempts still cost up to
    // fetchTimeoutMs each. Give failures their own equal budget so a document
    // full of broken/slow URLs cannot trigger unbounded sequential fetches.
    const isRemote = !/^data:/i.test(node.url);
    if (isRemote && failedRemoteImageCounter.count >= imageHandling.maxImages) {
      return [imageCouldNotLoadParagraph(node.alt, paragraphOptions)];
    }

    try {
      const { embedded, paragraphs } = await processImage(
        node.alt,
        node.url,
        style,
        imageHandling,
        paragraphOptions,
        options.signal,
      );
      if (embedded) {
        processedImageCounter.count++;
      } else if (isRemote) {
        failedRemoteImageCounter.count++;
      }
      return paragraphs;
    } catch (error) {
      if (error instanceof MarkdownConversionError) {
        throw error;
      }
      return [imageCouldNotLoadParagraph(node.alt, paragraphOptions)];
    }
  }

  // Process all top-level nodes
  let previousNodeType: string | undefined;
  for (const node of model.children) {
    throwIfAborted(options.signal);

    // Insert a blank spacer paragraph between back-to-back code blocks so
    // Word doesn't collapse the shared borders into a single visual block.
    if (node.type === "codeBlock" && previousNodeType === "codeBlock") {
      children.push(
        new Paragraph({ children: [], spacing: { before: 0, after: 0 } }),
      );
    }

    const rendered = await renderBlockNode(node);
    children.push(...rendered);

    previousNodeType = node.type;
  }

  return { children, headings, maxSequenceId };
}
