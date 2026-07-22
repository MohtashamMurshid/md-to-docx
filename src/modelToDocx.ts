import {
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  ExternalHyperlink,
  FootnoteReferenceRun,
  PageBreak,
  AlignmentType,
  TableLayoutType,
  WidthType,
  Bookmark,
  SimpleField,
} from "docx";
import type { IParagraphOptions, ParagraphChild } from "docx";
import type {
  DocxDocumentModel,
  DocxBlockNode,
  DocxCalloutType,
  DocxListNode,
  DocxListItemNode,
  DocxInlineNode,
  DocxTextNode,
  DocxCaption,
} from "./docxModel.js";
import { Style, Options } from "./types.js";
import { processHeading } from "./renderers/headingRenderer.js";
import { processCodeBlock } from "./renderers/codeRenderer.js";
import {
  blockquoteParagraphStyle,
  resolveCalloutStyle,
} from "./renderers/blockquoteRenderer.js";
import { processComment } from "./renderers/commentRenderer.js";
import {
  processImage,
  processImageData,
  resolveImageHandlingOptions,
} from "./renderers/imageRenderer.js";
import { processChartBlock } from "./renderers/chartRenderer.js";
import { parseTexMath, renderNativeMath } from "./renderers/mathRenderer.js";
import { processInlineCode } from "./renderers/textRenderer.js";
import { processHorizontalRule } from "./renderers/horizontalRuleRenderer.js";
import { resolveFontFamily } from "./utils/styleUtils.js";
import { sanitizeForBookmarkId } from "./utils/bookmarkUtils.js";
import { throwIfAborted } from "./processingLimits.js";
import { MarkdownConversionError } from "./errors.js";
import type { PluginBlockResult, PluginInlineContent } from "./pluginTypes.js";
import {
  freezePluginStyle,
  pluginConversionError,
  type PluginRuntime,
} from "./pluginRuntime.js";

/** Rendering overrides shared across inline-node renderers. */
interface InlineOverrides {
  forceBold?: boolean;
  forceItalic?: boolean;
  color?: string;
  size?: number;
}

interface RenderContext {
  quoteLevel?: number;
  inFootnote?: boolean;
  inList?: boolean;
  calloutType?: DocxCalloutType;
}

interface ListMarkerContext {
  isOrdered: boolean;
  level: number;
  sequenceId: number | undefined;
  taskChecked?: boolean;
}

const TASK_MARKERS = {
  unchecked: "\u2610 ",
  checked: "\u2612 ",
} as const;

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * Hyperlink targets are restricted to a scheme allowlist so a malicious
 * document cannot embed e.g. file:// UNC links (NTLM credential leak when
 * clicked in Word on Windows) or other unexpected protocol handlers.
 * Relative/fragment targets resolve against the dummy base and inherit its
 * safe scheme; targets the URL parser rejects outright fail closed because
 * Word may still treat the raw string as an active hyperlink.
 */
function isSafeLinkUrl(url: string): boolean {
  let protocol: string;
  try {
    protocol = new URL(url, "https://relative-link.invalid/").protocol;
  } catch {
    return false;
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
    /** Offset applied so footnote IDs remain unique across sections. */
    footnoteIdOffset?: number;
    pluginRuntime?: PluginRuntime;
    pluginElementCounter?: { count: number };
    maxElements?: number;
    pluginSection?: {
      index: number;
      count: number;
      kind: "section" | "patch";
      placeholder?: string;
      contentWidthTwips: number;
    };
  } = {},
): Promise<{
  children: (Paragraph | Table)[];
  headings: { text: string; level: number; bookmarkId: string }[];
  maxSequenceId: number;
  footnotes: Record<string, { children: Paragraph[] }>;
}> {
  const children: (Paragraph | Table)[] = [];
  const headings: { text: string; level: number; bookmarkId: string }[] = [];
  const documentType = options.documentType || "document";
  const sequenceIdOffset = renderOptions.sequenceIdOffset || 0;
  const footnoteIdOffset = renderOptions.footnoteIdOffset || 0;
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
  const mermaidFallbackCodeParagraphs = new WeakSet<object>();
  const pluginCodeParagraphs = new WeakSet<object>();

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
      color: overrides.color || (node.link ? "0000FF" : "000000"),
      size: overrides.size || style.paragraphSize || 24,
      font: resolveFontFamily(style),
      rightToLeft: style.direction === "RTL",
    });
  }

  function unsupportedMathText(value: string, block: boolean): DocxTextNode {
    return {
      type: "text",
      value: block ? `$$\n${value}\n$$` : `$${value}$`,
    };
  }

  function renderMathNode(value: string, block: boolean): ParagraphChild {
    const parsed = parseTexMath(value);
    if (parsed.supported) {
      return renderNativeMath(parsed.children);
    }

    if (options.mathRendering?.unsupported === "throw") {
      throw new MarkdownConversionError("Unsupported math expression", {
        expression: value,
        reason: parsed.reason,
      });
    }

    return textRunFromNode(unsupportedMathText(value, block));
  }

  function renderInlineNodes(
    nodes: DocxInlineNode[],
    overrides: InlineOverrides = {},
  ): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    for (const node of nodes) {
      if (node.type === "crossReference") {
        out.push(
          new SimpleField(
            ` REF ${node.bookmarkId} \\h `,
            `${captionLabel(node.kind)} ${node.number}`,
          ),
        );
      } else if (node.type === "footnoteReference") {
        out.push(new FootnoteReferenceRun(node.id + footnoteIdOffset));
      } else if (node.type === "mathInline") {
        out.push(renderMathNode(node.value, false));
      } else if (node.link && !isSafeLinkUrl(node.link)) {
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
    nodes: DocxInlineNode[],
    context: RenderContext = {},
    overrides: InlineOverrides = {},
  ): Paragraph {
    const alignment = style.paragraphAlignment
      ? AlignmentType[style.paragraphAlignment]
      : AlignmentType.LEFT;
    const quoteStyle = context.quoteLevel
      ? blockquoteParagraphStyle(
          style,
          context.quoteLevel,
          context.calloutType,
        )
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
    nodes: DocxInlineNode[],
    isOrdered: boolean,
    level: number,
    sequenceId: number | undefined,
    context: RenderContext = {},
    taskChecked?: boolean,
  ): Paragraph {
    const quoteStyle = context.quoteLevel
      ? blockquoteParagraphStyle(
          style,
          context.quoteLevel,
          context.calloutType,
        )
      : undefined;
    const base = {
      children: renderInlineNodes(
        taskChecked === undefined
          ? nodes
          : [
              {
                type: "text",
                value: taskChecked
                  ? TASK_MARKERS.checked
                  : TASK_MARKERS.unchecked,
              },
              ...nodes,
            ],
        { size: style.listItemSize || 24 },
      ),
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
    nodes: DocxInlineNode[],
    level: number,
    context: RenderContext = {},
  ): Paragraph {
    const quoteStyle = context.quoteLevel
      ? blockquoteParagraphStyle(
          style,
          context.quoteLevel,
          context.calloutType,
        )
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

  function textFromInlineNodes(nodes: DocxInlineNode[]): string {
    return nodes
      .map((node) => {
        if (node.type === "text") {
          return node.value;
        }
        if (node.type === "crossReference") {
          return `${captionLabel(node.kind)} ${node.number}`;
        }
        return "";
      })
      .join("");
  }

  function captionLabel(kind: DocxCaption["kind"]): string {
    return kind === "figure"
      ? options.captions?.figureLabel ?? "Figure"
      : options.captions?.tableLabel ?? "Table";
  }

  function captionParagraph(caption: DocxCaption): Paragraph {
    const label = captionLabel(caption.kind);
    const sequenceName =
      caption.kind === "figure" ? "MdToDocxFigure" : "MdToDocxTable";
    const size = options.captions?.size ?? style.paragraphSize ?? 24;
    const forceItalic = options.captions?.italic ?? false;
    const alignment = options.captions?.alignment
      ? AlignmentType[options.captions.alignment]
      : AlignmentType.CENTER;
    const bookmark = new Bookmark({
      id: caption.bookmarkId,
      children: [
        textRunFromNode(
          { type: "text", value: `${label} ` },
          { forceItalic, size },
        ),
        new SimpleField(
          ` SEQ ${sequenceName} \\* ARABIC `,
          String(caption.number),
        ),
      ],
    });

    return new Paragraph({
      style: "Caption",
      children: [
        bookmark,
        textRunFromNode(
          { type: "text", value: ": " },
          { forceItalic, size },
        ),
        ...renderInlineNodes(caption.children, { forceItalic, size }),
      ],
      alignment,
      spacing: {
        before: style.paragraphSpacing / 2,
        after: style.paragraphSpacing,
        line: style.lineSpacing * 240,
      },
      bidirectional: style.direction === "RTL",
    });
  }

  function withCaption(
    node: Extract<DocxBlockNode, { type: "image" | "table" }>,
    rendered: (Paragraph | Table)[],
  ): (Paragraph | Table)[] {
    if (!node.caption) {
      return rendered;
    }

    const placement =
      node.type === "image"
        ? options.captions?.figurePlacement ?? "below"
        : options.captions?.tablePlacement ?? "below";
    const caption = captionParagraph(node.caption);
    return placement === "above"
      ? [caption, ...rendered]
      : [...rendered, caption];
  }

  async function renderBlockNode(
    node: DocxBlockNode,
    listLevel: number = 0,
    context: RenderContext = {},
  ): Promise<(Paragraph | Table)[]> {
    throwIfAborted(options.signal);

    switch (node.type) {
      case "heading": {
        if (context.inFootnote) {
          return [paragraphFromInlineNodes(node.children, context)];
        }

        const headingText = textFromInlineNodes(node.children);
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

      case "mathBlock": {
        const mathAlignment = style.paragraphAlignment
          ? AlignmentType[style.paragraphAlignment]
          : AlignmentType.LEFT;
        return [
          new Paragraph({
            children: [renderMathNode(node.value, true)],
            spacing: {
              before: style.paragraphSpacing,
              after: style.paragraphSpacing,
              line: style.lineSpacing * 240,
            },
            alignment: mathAlignment,
            bidirectional: style.direction === "RTL",
          }),
        ];
      }

      case "blockquote": {
        return renderBlockquote(node, listLevel, context);
      }

      case "image": {
        return withCaption(node, await renderImageNode(node, context));
      }

      case "mermaidBlock": {
        return renderMermaidNode(node, context);
      }

      case "chartBlock": {
        return renderChartNode(node, context);
      }

      case "pluginBlock": {
        return renderPluginNode(node, listLevel, context);
      }

      case "table": {
        return withCaption(node, [tableFromNode(node)]);
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
            ...blockquoteParagraphStyle(
              style,
              context.quoteLevel,
              context.calloutType,
            ),
          }),
        ];
      }

      case "pageBreak": {
        return [new Paragraph({ children: [new PageBreak()] })];
      }

      case "horizontalRule": {
        const quoteStyle = context.quoteLevel
          ? blockquoteParagraphStyle(
              style,
              context.quoteLevel,
              context.calloutType,
            )
          : undefined;
        return [processHorizontalRule(style, quoteStyle)];
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

    const quoteContext = {
      ...context,
      quoteLevel: (context.quoteLevel || 0) + 1,
      calloutType: node.calloutType || context.calloutType,
    };
    const out: (Paragraph | Table)[] = [];
    const blockquoteTextOverrides: InlineOverrides = node.calloutType
      ? { size: style.blockquoteSize || 24 }
      : {
          size: style.blockquoteSize || 24,
          forceItalic: true,
        };

    if (node.calloutType) {
      const calloutStyle = resolveCalloutStyle(style, node.calloutType);
      out.push(
        paragraphFromInlineNodes(
          [{ type: "text", value: calloutStyle.label }],
          quoteContext,
          {
            size: style.blockquoteSize || 24,
            forceBold: true,
            color: calloutStyle.titleColor,
          },
        ),
      );
    }

    if (node.children.length === 0) {
      if (!node.calloutType) {
        out.push(
          paragraphFromInlineNodes([], quoteContext, {
            size: style.blockquoteSize || 24,
            forceItalic: true,
          }),
        );
      }
      return out;
    }

    for (const child of node.children) {
      throwIfAborted(options.signal);

      if (child.type === "paragraph") {
        out.push(
          paragraphFromInlineNodes(
            child.children,
            quoteContext,
            blockquoteTextOverrides,
          ),
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

    const listContext: RenderContext = { ...context, inList: true };

    // Process children of list item
    for (const child of item.children) {
      throwIfAborted(options.signal);

      if (child.type === "list") {
        // Nested list - render recursively
        const nestedParagraphs = await renderList(
          child as DocxListNode,
          level + 1,
          listContext,
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
              listContext,
              item.checked,
            ),
          );
        } else {
          paragraphs.push(
            listContinuationParagraphFromInlineNodes(
              child.children,
              level,
              listContext,
            ),
          );
        }
      } else {
        // Other block types - render normally but they'll appear as part of list item
        const markerContext =
          paragraphs.length === 0
            ? {
                isOrdered,
                level,
                sequenceId,
                taskChecked: item.checked,
              }
            : undefined;
        const rendered = await renderBlockNodeWithListMarker(
          child,
          level,
          listContext,
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
        listParagraphFromInlineNodes(
          [],
          isOrdered,
          level,
          sequenceId,
          context,
          item.checked,
        ),
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
        ...blockquoteParagraphStyle(
          style,
          context.quoteLevel,
          context.calloutType,
        ),
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
    if (node.type === "horizontalRule") {
      const quoteStyle = context.quoteLevel
        ? blockquoteParagraphStyle(
            style,
            context.quoteLevel,
            context.calloutType,
          )
        : undefined;
      const quoteIndent = quoteStyle?.indent.left ?? 0;
      return [
        ...(listMarker
          ? [
              listParagraphFromInlineNodes(
                [],
                listMarker.isOrdered,
                listMarker.level,
                listMarker.sequenceId,
                context,
                listMarker.taskChecked,
              ),
            ]
          : []),
        processHorizontalRule(style, {
          ...quoteStyle,
          indent: { left: quoteIndent + 720 * (listLevel + 1) },
        }),
      ];
    }

    if (listMarker?.taskChecked !== undefined) {
      return [
        listParagraphFromInlineNodes(
          [],
          listMarker.isOrdered,
          listMarker.level,
          listMarker.sequenceId,
          context,
          listMarker.taskChecked,
        ),
        ...(await renderBlockNode(node, listLevel, context)),
      ];
    }

    if (node.type === "image" || node.type === "chartBlock") {
      return node.type === "image"
        ? renderImageNode(node, context, listMarker)
        : renderChartNode(node, context, listMarker);
    }

    if (node.type === "mermaidBlock") {
      return renderMermaidNode(node, context, listMarker);
    }

    if (node.type === "pluginBlock") {
      return renderPluginNode(node, listLevel, context, listMarker);
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
          listMarker.taskChecked,
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

  function chartCouldNotLoadParagraph(
    paragraphOptions: Partial<IParagraphOptions> = {},
  ): Paragraph {
    return new Paragraph({
      ...paragraphOptions,
      children: [
        new TextRun({
          text: "[Chart could not be loaded: image limit reached]",
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

  async function renderChartNode(
    node: Extract<DocxBlockNode, { type: "chartBlock" }>,
    context: RenderContext = {},
    listMarker?: ListMarkerContext,
  ): Promise<Paragraph[]> {
    throwIfAborted(options.signal);

    const paragraphOptions = imageParagraphOptions(context, listMarker);

    if (processedImageCounter.count >= imageHandling.maxImages) {
      return [chartCouldNotLoadParagraph(paragraphOptions)];
    }

    const { embedded, paragraphs } = await processChartBlock(
      node.value,
      style,
      options.chartRendering,
      options.imageHandling,
      paragraphOptions,
      options.signal,
    );
    if (embedded) {
      processedImageCounter.count++;
    }
    return paragraphs;
  }

  function mermaidCouldNotRenderParagraph(
    paragraphOptions: Partial<IParagraphOptions> = {},
  ): Paragraph {
    return new Paragraph({
      ...paragraphOptions,
      children: [
        new TextRun({
          text: "[Mermaid diagram could not be rendered]",
          italics: true,
          color: "FF0000",
          font: resolveFontFamily(style),
          rightToLeft: style.direction === "RTL",
        }),
      ],
      alignment: AlignmentType.CENTER,
      bidirectional: style.direction === "RTL",
    });
  }

  function renderMermaidFallback(
    node: Extract<DocxBlockNode, { type: "mermaidBlock" }>,
    paragraphOptions: Partial<IParagraphOptions>,
    reason?: unknown,
    context: RenderContext = {},
    listMarker?: ListMarkerContext,
  ): Paragraph[] {
    const failureMode = options.mermaidRendering?.failureMode ?? "codeBlock";

    if (failureMode === "throw") {
      throw new MarkdownConversionError(
        `Failed to render Mermaid diagram${
          reason instanceof Error ? `: ${reason.message}` : ""
        }`,
        { language: "mermaid", originalError: reason },
      );
    }

    if (failureMode === "placeholder") {
      return [mermaidCouldNotRenderParagraph(paragraphOptions)];
    }

    const codeBlock = processCodeBlock(
      node.value,
      "mermaid",
      style,
      options.codeHighlighting,
    );
    mermaidFallbackCodeParagraphs.add(codeBlock);

    if (!listMarker) {
      return [codeBlock];
    }

    return [
      listParagraphFromInlineNodes(
        [],
        listMarker.isOrdered,
        listMarker.level,
        listMarker.sequenceId,
        context,
      ),
      codeBlock,
    ];
  }

  async function renderMermaidNode(
    node: Extract<DocxBlockNode, { type: "mermaidBlock" }>,
    context: RenderContext = {},
    listMarker?: ListMarkerContext,
  ): Promise<Paragraph[]> {
    throwIfAborted(options.signal);

    const paragraphOptions = imageParagraphOptions(context, listMarker);
    const render = options.mermaidRendering?.render;
    if (!render) {
      return renderMermaidFallback(
        node,
        paragraphOptions,
        undefined,
        context,
        listMarker,
      );
    }

    if (processedImageCounter.count >= imageHandling.maxImages) {
      return renderMermaidFallback(
        node,
        paragraphOptions,
        new Error("Maximum embedded image count reached"),
        context,
        listMarker,
      );
    }

    try {
      const result = await render({
        code: node.value,
        meta: node.meta,
        signal: options.signal,
      });
      throwIfAborted(options.signal);

      if (!result) {
        return renderMermaidFallback(
          node,
          paragraphOptions,
          new Error("Mermaid renderer returned no image"),
          context,
          listMarker,
        );
      }

      const { embedded, paragraphs } = processImageData(
        {
          altText: "Mermaid diagram",
          data: result.data,
          contentType: result.contentType,
          source: result.source || "Mermaid diagram",
          widthHint: result.width,
          heightHint: result.height,
          maxImageBytes: imageHandling.maxImageBytes,
          paragraphOptions,
          signal: options.signal,
        },
        style,
      );

      if (embedded) {
        processedImageCounter.count++;
      }
      return paragraphs;
    } catch (error) {
      if (error instanceof MarkdownConversionError) {
        throw error;
      }
      return renderMermaidFallback(
        node,
        paragraphOptions,
        error,
        context,
        listMarker,
      );
    }
  }

  function pluginInlineNodes(
    content: PluginInlineContent | readonly PluginInlineContent[],
  ): DocxInlineNode[] {
    const values = Array.isArray(content) ? content : [content];
    return values.map((value) => {
      if (typeof value === "string") {
        return { type: "text", value };
      }
      if (
        !value ||
        value.type !== "text" ||
        typeof value.value !== "string"
      ) {
        throw new Error("Plugin inline content must be text or a text descriptor");
      }
      return { ...value, type: "text" };
    });
  }

  function pluginFallback(
    node: Extract<DocxBlockNode, { type: "pluginBlock" }>,
    listLevel: number,
    context: RenderContext,
    listMarker?: ListMarkerContext,
  ): Promise<(Paragraph | Table)[]> {
    const fallbackNode: DocxBlockNode =
      node.source.kind === "fence"
        ? {
            type: "codeBlock",
            value: node.source.value,
            language: node.source.language,
          }
        : {
            type: "paragraph",
            children: [{ type: "text", value: node.fallbackText }],
          };
    if (fallbackNode.type === "paragraph" && context.inList) {
      return Promise.resolve([
        listMarker
          ? listParagraphFromInlineNodes(
              fallbackNode.children,
              listMarker.isOrdered,
              listMarker.level,
              listMarker.sequenceId,
              context,
            )
          : listContinuationParagraphFromInlineNodes(
              fallbackNode.children,
              listLevel,
              context,
            ),
      ]);
    }
    return renderBlockNodeWithListMarker(
      fallbackNode,
      listLevel,
      context,
      listMarker,
    );
  }

  async function renderPluginChildren(
    node: Extract<DocxBlockNode, { type: "pluginBlock" }>,
    listLevel: number,
    context: RenderContext,
    listMarker?: ListMarkerContext,
  ): Promise<(Paragraph | Table)[]> {
    const rendered: (Paragraph | Table)[] = [];
    let marker = listMarker;
    for (const child of node.children) {
      const childOutput =
        context.inList && child.type === "paragraph"
          ? [
              marker
                ? listParagraphFromInlineNodes(
                    child.children,
                    marker.isOrdered,
                    marker.level,
                    marker.sequenceId,
                    context,
                  )
                : listContinuationParagraphFromInlineNodes(
                    child.children,
                    listLevel,
                    context,
                  ),
            ]
          : context.inFootnote && child.type === "table"
          ? tableFootnoteFallbackParagraphs(child)
          : await renderBlockNodeWithListMarker(
              child,
              listLevel,
              context,
              marker,
            );
      rendered.push(...childOutput);
      if (childOutput.length > 0) {
        marker = undefined;
      }
    }
    return rendered;
  }

  async function renderPluginBlockResult(
    result: PluginBlockResult,
    node: Extract<DocxBlockNode, { type: "pluginBlock" }>,
    listLevel: number,
    context: RenderContext,
    listMarker?: ListMarkerContext,
  ): Promise<(Paragraph | Table)[]> {
    if (!result || typeof result !== "object" || typeof result.type !== "string") {
      throw new Error("Plugin returned an invalid block result");
    }

    if (result.type === "skip") {
      return [];
    }
    if (result.type === "children") {
      return renderPluginChildren(node, listLevel, context, listMarker);
    }
    if (result.type === "image") {
      const paragraphOptions = imageParagraphOptions(context, listMarker);
      if (processedImageCounter.count >= imageHandling.maxImages) {
        return [
          imageCouldNotLoadParagraph(
            result.alt || "plugin image limit reached",
            paragraphOptions,
          ),
        ];
      }
      const { embedded, paragraphs } = processImageData(
        {
          altText: result.alt || "Plugin image",
          data: result.data,
          contentType: result.contentType,
          source: result.source || `${node.handler.pluginName} plugin image`,
          widthHint: result.width,
          heightHint: result.height,
          maxImageBytes: imageHandling.maxImageBytes,
          paragraphOptions,
          signal: options.signal,
        },
        style,
      );
      if (embedded) {
        processedImageCounter.count++;
      }
      return paragraphs;
    }

    let semanticNode: DocxBlockNode;
    if (result.type === "paragraph") {
      const inlineNodes = pluginInlineNodes(result.children);
      if (context.inList) {
        return [
          listMarker
            ? listParagraphFromInlineNodes(
                inlineNodes,
                listMarker.isOrdered,
                listMarker.level,
                listMarker.sequenceId,
                context,
              )
            : listContinuationParagraphFromInlineNodes(
                inlineNodes,
                listLevel,
                context,
              ),
        ];
      }
      semanticNode = {
        type: "paragraph",
        children: inlineNodes,
      };
    } else if (result.type === "heading") {
      semanticNode = {
        type: "heading",
        level: result.level,
        children: pluginInlineNodes(result.children),
      };
    } else if (result.type === "codeBlock") {
      semanticNode = {
        type: "codeBlock",
        value: result.value,
        language: result.language,
      };
    } else if (result.type === "table") {
      if (context.inList) {
        throw new Error("Plugin table results are not supported inside lists");
      }
      semanticNode = {
        type: "table",
        headers: result.headers.map(pluginInlineNodes),
        rows: result.rows.map((row) => row.map(pluginInlineNodes)),
        align: result.align ? [...result.align] : undefined,
      };
      if (context.inFootnote) {
        return tableFootnoteFallbackParagraphs(semanticNode);
      }
    } else {
      throw new Error(`Unsupported plugin result type: ${(result as { type: string }).type}`);
    }

    const rendered = await renderBlockNodeWithListMarker(
      semanticNode,
      listLevel,
      context,
      listMarker,
    );
    if (semanticNode.type === "codeBlock") {
      const codeParagraph = rendered[rendered.length - 1];
      if (codeParagraph instanceof Paragraph) {
        pluginCodeParagraphs.add(codeParagraph);
      }
    }
    return rendered;
  }

  async function renderPluginNode(
    node: Extract<DocxBlockNode, { type: "pluginBlock" }>,
    listLevel: number,
    context: RenderContext = {},
    listMarker?: ListMarkerContext,
  ): Promise<(Paragraph | Table)[]> {
    const runtime = renderOptions.pluginRuntime;
    const section = renderOptions.pluginSection;
    if (!runtime || !section) {
      return pluginFallback(node, listLevel, context, listMarker);
    }

    const snapshot = {
      headingsLength: headings.length,
      headingBookmarkCount: headingBookmarkCounter.count,
      imageCount: processedImageCounter.count,
      failedRemoteImageCount: failedRemoteImageCounter.count,
      maxSequenceId,
      pluginElementCount: renderOptions.pluginElementCounter?.count,
    };
    const restoreCoreState = (): void => {
      headings.splice(snapshot.headingsLength);
      headingBookmarkCounter.count = snapshot.headingBookmarkCount;
      processedImageCounter.count = snapshot.imageCount;
      failedRemoteImageCounter.count = snapshot.failedRemoteImageCount;
      maxSequenceId = snapshot.maxSequenceId;
      if (
        renderOptions.pluginElementCounter &&
        snapshot.pluginElementCount !== undefined
      ) {
        renderOptions.pluginElementCounter.count = snapshot.pluginElementCount;
      }
    };

    const detail =
      node.source.kind === "fence"
        ? { language: node.source.language }
        : { nodeType: node.source.nodeType };
    try {
      const result = await runtime.render(
        node.handler,
        node.source.kind === "fence"
          ? {
              language: node.source.language,
              value: node.source.value,
              meta: node.source.meta,
            }
          : { node: node.source.node, nodeType: node.source.nodeType },
        {
          signal: options.signal,
          style: freezePluginStyle(style),
          section: Object.freeze({ ...section }),
          resources: Object.freeze({
            imagesUsed: processedImageCounter.count,
            maxImages: imageHandling.maxImages,
          }),
          parent: context.inFootnote
            ? "footnote"
            : context.inList
              ? "list"
              : context.quoteLevel
                ? "blockquote"
                : "root",
          listDepth: context.inList ? listLevel + 1 : 0,
          blockquoteDepth: context.quoteLevel ?? 0,
        },
      );

      if (result === null || result === undefined) {
        throw new Error("Plugin renderer returned no result");
      }
      const blocks = Array.isArray(result) ? result : [result];
      const additionalElements = blocks.filter(
        (block) => block.type !== "children" && block.type !== "skip",
      ).length;
      if (renderOptions.pluginElementCounter) {
        renderOptions.pluginElementCounter.count += additionalElements;
        if (
          renderOptions.maxElements !== undefined &&
          renderOptions.pluginElementCounter.count > renderOptions.maxElements
        ) {
          throw new MarkdownConversionError(
            "Markdown element count exceeds maxElements",
            {
              ...detail,
              plugin: node.handler.pluginName,
              hook: node.handler.kind,
              section,
              elementCount: renderOptions.pluginElementCounter.count,
              maxElements: renderOptions.maxElements,
            },
          );
        }
      }
      const rendered: (Paragraph | Table)[] = [];
      let marker = listMarker;
      for (const block of blocks) {
        const output = await renderPluginBlockResult(
          block,
          node,
          listLevel,
          context,
          marker,
        );
        rendered.push(...output);
        if (output.length > 0) {
          marker = undefined;
        }
      }
      return rendered;
    } catch (error) {
      if (options.signal?.aborted) {
        throwIfAborted(options.signal);
      }
      if (
        error instanceof MarkdownConversionError &&
        error.message === "Markdown element count exceeds maxElements"
      ) {
        throw error;
      }
      if (node.handler.failureMode === "skip") {
        restoreCoreState();
        return [];
      }
      if (node.handler.failureMode === "fallback") {
        restoreCoreState();
        return pluginFallback(node, listLevel, context, listMarker);
      }
      throw pluginConversionError(
        `Plugin "${node.handler.pluginName}" ${node.handler.kind} renderer failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        node.handler,
        section,
        detail,
        error,
      );
    }
  }

  function footnoteFallbackParagraph(text: string): Paragraph {
    return paragraphFromInlineNodes([
      {
        type: "text",
        value: text,
        italic: true,
      },
    ]);
  }

  function tableFootnoteFallbackParagraphs(
    node: Extract<DocxBlockNode, { type: "table" }>,
  ): Paragraph[] {
    const rows = [node.headers, ...node.rows];
    return rows.map((row) =>
      paragraphFromInlineNodes([
        {
          type: "text",
          value: row.map((cell) => textFromInlineNodes(cell)).join(" | "),
        },
      ]),
    );
  }

  async function renderFootnoteBlockNode(
    node: DocxBlockNode,
  ): Promise<Paragraph[]> {
    if (node.type === "table") {
      return tableFootnoteFallbackParagraphs(node);
    }

    const rendered = await renderBlockNode(node, 0, { inFootnote: true });
    const paragraphs: Paragraph[] = [];

    for (const child of rendered) {
      if (child instanceof Paragraph) {
        paragraphs.push(child);
      } else {
        paragraphs.push(
          footnoteFallbackParagraph("[Unsupported footnote content omitted]"),
        );
      }
    }

    return paragraphs;
  }

  async function renderFootnotes(): Promise<
    Record<string, { children: Paragraph[] }>
  > {
    const footnotes: Record<string, { children: Paragraph[] }> = {};

    for (const footnote of model.footnotes ?? []) {
      const footnoteChildren: Paragraph[] = [];
      for (const child of footnote.children) {
        footnoteChildren.push(...(await renderFootnoteBlockNode(child)));
      }

      footnotes[String(footnote.id + footnoteIdOffset)] = {
        children:
          footnoteChildren.length > 0
            ? footnoteChildren
            : [paragraphFromInlineNodes([])],
      };
    }

    return footnotes;
  }

  // Process all top-level nodes
  let previousRenderedAsCode = false;
  for (const node of model.children) {
    throwIfAborted(options.signal);

    const rendered = await renderBlockNode(node);
    const currentRenderedAsCode =
      node.type === "codeBlock" ||
      (node.type === "mermaidBlock" &&
        rendered.some((child) => mermaidFallbackCodeParagraphs.has(child))) ||
      (node.type === "pluginBlock" &&
        rendered.some((child) => pluginCodeParagraphs.has(child)));

    // Insert a blank spacer paragraph between back-to-back code blocks so
    // Word doesn't collapse the shared borders into a single visual block.
    if (currentRenderedAsCode && previousRenderedAsCode) {
      children.push(
        new Paragraph({ children: [], spacing: { before: 0, after: 0 } }),
      );
    }

    children.push(...rendered);

    previousRenderedAsCode = currentRenderedAsCode;
  }

  return {
    children,
    headings,
    maxSequenceId,
    footnotes: await renderFootnotes(),
  };
}
