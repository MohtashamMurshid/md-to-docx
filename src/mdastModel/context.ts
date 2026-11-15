import type { List, Node } from "mdast";
import type { DocxBlockNode } from "../docxModel.js";
import type { CrossReferenceRegistry } from "../crossReferences.js";
import type { PluginRuntime } from "../pluginRuntime.js";
import type { Options } from "../types.js";
import type { FootnoteState } from "./footnotes.js";

/** Per-subtree switches that nested block and inline conversion inherit. */
export interface ProcessOptions {
  allowFootnoteReferences?: boolean;
}

/** What converting one mdast block yields: one node, several, or nothing. */
export type BlockResult = DocxBlockNode | DocxBlockNode[] | null;

/**
 * State shared by every converter during one `mdastToDocxModel` call. Block
 * converters recurse through `convertBlock`, so modules that handle container
 * nodes (lists, tables, blockquotes) never import the dispatcher itself.
 */
export interface ConversionContext {
  readonly options: Options;
  readonly crossReferences: CrossReferenceRegistry | undefined;
  readonly pluginRuntime: PluginRuntime | undefined;
  readonly footnotes: FootnoteState;
  /** Sequence ID per ordered list, assigned in document (pre-)order. */
  readonly listSequenceIds: Map<List, number>;
  readonly convertBlock: (node: Node, options: ProcessOptions) => BlockResult;
}

export function blockResultToArray(result: BlockResult): DocxBlockNode[] {
  if (!result) {
    return [];
  }
  return Array.isArray(result) ? result : [result];
}

/** Converts each node in order and concatenates the results. */
export function convertBlocks(
  context: ConversionContext,
  nodes: readonly Node[],
  options: ProcessOptions,
): DocxBlockNode[] {
  return nodes.flatMap((node) =>
    blockResultToArray(context.convertBlock(node, options)),
  );
}

/** List items and footnotes with no block content still need one paragraph. */
export function orEmptyParagraph(blocks: DocxBlockNode[]): DocxBlockNode[] {
  if (blocks.length === 0) {
    blocks.push({ type: "paragraph", children: [] });
  }
  return blocks;
}
