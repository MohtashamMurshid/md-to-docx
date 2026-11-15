import type { Root, RootContent } from "mdast";
import { resolveMarkdownReferences } from "./markdownAst.js";
import type { DocxBlockNode, DocxDocumentModel } from "./docxModel.js";
import type { Options } from "./types.js";
import {
  captionAt,
  bindCrossReferenceCaptions,
} from "./crossReferences.js";
import type {
  CrossReferenceRegistry,
  ResolvedCaption,
} from "./crossReferences.js";
import type { PluginRuntime } from "./pluginRuntime.js";
import type { ConversionContext } from "./mdastModel/context.js";
import { blockResultToArray } from "./mdastModel/context.js";
import {
  classifyHtmlNode,
  convertBlockNode,
  htmlNodeValue,
} from "./mdastModel/blocks.js";
import { createFootnoteState } from "./mdastModel/footnotes.js";
import { processReferencedFootnotes } from "./mdastModel/footnoteDefinitions.js";
import { processInlineNodes } from "./mdastModel/inline.js";

/** Collaborators the conversion consults when the document uses them. */
interface ConversionServices {
  crossReferences?: CrossReferenceRegistry | undefined;
  pluginRuntime?: PluginRuntime | undefined;
}

/** What one top-level child contributes, and how many root children it used. */
interface RootStep {
  blocks: DocxBlockNode[];
  consumed: number;
}

/** Standalone `[TOC]` and `\pagebreak` paragraphs are document markers. */
function rootParagraphMarker(child: RootContent): DocxBlockNode | null {
  if (child.type !== "paragraph") {
    return null;
  }
  const textContent = child.children
    .filter((c) => c.type === "text")
    .map((c) => c.value)
    .join("")
    .trim();
  if (textContent === "[TOC]") {
    return { type: "tocPlaceholder" };
  }
  return textContent === "\\pagebreak" ? { type: "pageBreak" } : null;
}

/**
 * Attaches the caption paragraph that follows an image or table. Returns
 * whether it did, in which case the caption paragraph is consumed.
 */
function attachCaption(
  context: ConversionContext,
  block: DocxBlockNode,
  caption: ResolvedCaption | undefined,
): boolean {
  if (!caption || (block.type !== "image" && block.type !== "table")) {
    return false;
  }
  block.caption = {
    id: caption.id,
    kind: caption.kind,
    number: caption.number,
    bookmarkId: caption.bookmarkId,
    children: processInlineNodes(context, caption.children),
  };
  return true;
}

function convertRootChild(
  context: ConversionContext,
  root: Root,
  index: number,
): RootStep {
  // Bounded by the caller's loop condition.
  const child = root.children[index]!;
  const resolvedCaption = captionAt(context.crossReferences, root, index);
  const marker = rootParagraphMarker(child);
  if (marker) {
    return { blocks: [marker], consumed: 1 };
  }
  if (child.type === "html") {
    return { blocks: blockResultToArray(classifyHtmlNode(htmlNodeValue(child))), consumed: 1 };
  }
  if (child.type === "footnoteDefinition") {
    return { blocks: [], consumed: 1 };
  }

  const processed = context.convertBlock(child, {});
  const captioned =
    processed !== null &&
    !Array.isArray(processed) &&
    attachCaption(context, processed, resolvedCaption);
  return {
    blocks: blockResultToArray(processed),
    consumed: captioned ? 2 : 1,
  };
}

/**
 * Converts mdast AST to internal docx-friendly model
 * Handles nested lists properly using AST structure
 */
export function mdastToDocxModel(
  root: Root,
  options: Options,
  { crossReferences, pluginRuntime }: ConversionServices = {},
): DocxDocumentModel {
  resolveMarkdownReferences(root);
  bindCrossReferenceCaptions(crossReferences, root);
  const context: ConversionContext = {
    options,
    crossReferences,
    pluginRuntime,
    footnotes: createFootnoteState(root),
    listSequenceIds: new Map(),
    convertBlock: (node, processOptions) =>
      convertBlockNode(context, node, processOptions),
  };

  const children: DocxBlockNode[] = [];
  for (let index = 0; index < root.children.length; ) {
    const step = convertRootChild(context, root, index);
    children.push(...step.blocks);
    index += step.consumed;
  }

  return { children, footnotes: processReferencedFootnotes(context) };
}
