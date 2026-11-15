import type { DocxBlockNode } from "../docxModel.js";
import { throwIfAborted } from "../processingLimits.js";
import { MarkdownConversionError } from "../errors.js";
import { freezePluginStyle, pluginConversionError } from "../pluginRuntime.js";
import type { PluginRuntime } from "../pluginRuntime.js";
import type {
  Block,
  ModelToDocxRenderOptions,
  Placement,
  RenderContext,
  RenderEnv,
} from "./context.js";
import { listItemParagraph, withoutTaskBox } from "./lists.js";
import {
  pluginResultElementCount,
  renderPluginBlockResult,
  renderSequence,
} from "./pluginResults.js";
import type { PluginNode } from "./pluginResults.js";

type PluginSection = NonNullable<ModelToDocxRenderOptions["pluginSection"]>;
type RenderArgs = Parameters<PluginRuntime["render"]>;

/** One plugin render call, and the state to put back if it fails. */
interface PluginCall {
  node: PluginNode;
  section: PluginSection;
  at: Placement;
  snapshot: CoreStateSnapshot;
}

/** Core state a failed plugin render may have advanced. */
interface CoreStateSnapshot {
  headingsLength: number;
  headingBookmarkCount: number;
  imageCount: number;
  failedRemoteImageCount: number;
  maxSequenceId: number;
  pluginElementCount: number | undefined;
}

const MAX_ELEMENTS_MESSAGE = "Markdown element count exceeds maxElements";

function snapshotCoreState(env: RenderEnv): CoreStateSnapshot {
  return {
    headingsLength: env.headings.length,
    headingBookmarkCount: env.headingBookmarkCounter.count,
    imageCount: env.processedImageCounter.count,
    failedRemoteImageCount: env.failedRemoteImageCounter.count,
    maxSequenceId: env.maxSequenceId,
    pluginElementCount: env.renderOptions.pluginElementCounter?.count,
  };
}

function restoreCoreState(env: RenderEnv, snapshot: CoreStateSnapshot): void {
  env.headings.splice(snapshot.headingsLength);
  env.headingBookmarkCounter.count = snapshot.headingBookmarkCount;
  env.processedImageCounter.count = snapshot.imageCount;
  env.failedRemoteImageCounter.count = snapshot.failedRemoteImageCount;
  env.maxSequenceId = snapshot.maxSequenceId;
  const counter = env.renderOptions.pluginElementCounter;
  if (counter && snapshot.pluginElementCount !== undefined) {
    counter.count = snapshot.pluginElementCount;
  }
}

/** The block's source as the plugin sees it: a fence or a Markdown node. */
function pluginRenderInput(node: PluginNode): RenderArgs[1] {
  return node.source.kind === "fence"
    ? {
        language: node.source.language,
        value: node.source.value,
        meta: node.source.meta,
      }
    : { node: node.source.node, nodeType: node.source.nodeType };
}

/** Error-context detail naming the fence language or node type. */
function sourceDetail(
  node: PluginNode,
): { language: string } | { nodeType: string } {
  return node.source.kind === "fence"
    ? { language: node.source.language }
    : { nodeType: node.source.nodeType };
}

function pluginParent(
  context: RenderContext,
): "footnote" | "list" | "blockquote" | "root" {
  if (context.inFootnote) return "footnote";
  if (context.inList) return "list";
  if (context.quoteLevel) return "blockquote";
  return "root";
}

function pluginRenderContext(
  env: RenderEnv,
  section: PluginSection,
  at: Placement,
): RenderArgs[2] {
  const { context } = at;
  return {
    signal: env.options.signal,
    style: freezePluginStyle(env.style),
    section: Object.freeze({ ...section }),
    resources: Object.freeze({
      imagesUsed: env.processedImageCounter.count,
      maxImages: env.imageHandling.maxImages,
    }),
    parent: pluginParent(context),
    listDepth: context.inList ? at.listLevel + 1 : 0,
    blockquoteDepth: context.quoteLevel ?? 0,
  };
}

/** Charges the plugin's blocks to the document's `maxElements` budget. */
function chargeElements(
  env: RenderEnv,
  call: PluginCall,
  blocks: readonly unknown[],
): void {
  const additionalElements = blocks.reduce<number>(
    (count, block) => count + pluginResultElementCount(block),
    0,
  );
  const { pluginElementCounter: counter, maxElements } = env.renderOptions;
  if (!counter) return;
  counter.count += additionalElements;
  if (maxElements === undefined || counter.count <= maxElements) return;
  throw new MarkdownConversionError(MAX_ELEMENTS_MESSAGE, {
    ...sourceDetail(call.node),
    plugin: call.node.handler.pluginName,
    hook: call.node.handler.kind,
    section: call.section,
    elementCount: counter.count,
    maxElements,
  });
}

/** What the block renders as without its plugin: the fence as code, or the node's text. */
function pluginFallbackNode(node: PluginNode): DocxBlockNode {
  return node.source.kind === "fence"
    ? {
        type: "codeBlock",
        value: node.source.value,
        language: node.source.language,
      }
    : {
        type: "paragraph",
        children: [{ type: "text", value: node.fallbackText }],
      };
}

function renderPluginFallback(
  env: RenderEnv,
  node: PluginNode,
  at: Placement,
): Promise<Block[]> {
  const fallbackNode = pluginFallbackNode(node);
  if (fallbackNode.type === "paragraph" && at.context.inList) {
    return Promise.resolve([
      listItemParagraph(env, fallbackNode.children, withoutTaskBox(at)),
    ]);
  }
  return env.blocks.renderWithMarker(env, fallbackNode, at);
}

/** Errors that stop the conversion whatever the plugin's failure mode says. */
function isFatalPluginError(error: unknown): boolean {
  if (!(error instanceof MarkdownConversionError)) return false;
  return (
    error.message === MAX_ELEMENTS_MESSAGE ||
    (error.context as { missingImageAltText?: unknown } | undefined)
      ?.missingImageAltText === "throw"
  );
}

/** Applies the handler's `failureMode`: skip the block, fall back, or throw. */
function handlePluginFailure(
  env: RenderEnv,
  call: PluginCall,
  error: unknown,
): Promise<Block[]> {
  const { signal, onWarning } = env.options;
  if (signal?.aborted) {
    throwIfAborted(signal);
  }
  if (isFatalPluginError(error)) {
    throw error;
  }
  const { handler } = call.node;
  const message = error instanceof Error ? error.message : undefined;
  if (handler.failureMode !== "throw")
    onWarning?.({
      code: "PLUGIN_FALLBACK",
      message: message ?? "Plugin rendering failed",
      source: handler.pluginName,
    });
  if (handler.failureMode === "skip") {
    restoreCoreState(env, call.snapshot);
    return Promise.resolve([]);
  }
  if (handler.failureMode === "fallback") {
    restoreCoreState(env, call.snapshot);
    return renderPluginFallback(env, call.node, call.at);
  }
  throw pluginConversionError({
    message: `Plugin "${handler.pluginName}" ${handler.kind} renderer failed: ${
      message ?? "Unknown error"
    }`,
    reference: handler,
    section: call.section,
    extra: sourceDetail(call.node),
    originalError: error,
  });
}

async function runPlugin(
  env: RenderEnv,
  runtime: PluginRuntime,
  call: PluginCall,
): Promise<Block[]> {
  const { node, section, at } = call;
  // Third-party renderer output: validated block by block below.
  const result: unknown = await runtime.render(
    node.handler,
    pluginRenderInput(node),
    pluginRenderContext(env, section, at),
  );
  if (result === null || result === undefined) {
    throw new Error("Plugin renderer returned no result");
  }
  const blocks: readonly unknown[] = Array.isArray(result) ? result : [result];
  chargeElements(env, call, blocks);
  return renderSequence(blocks, at, (block, blockAt) =>
    renderPluginBlockResult(env, block, node, blockAt),
  );
}

/**
 * Renders a block a plugin claimed. Without a plugin runtime the block falls
 * back; a failing plugin follows its handler's `failureMode`.
 */
export async function renderPluginNode(
  env: RenderEnv,
  node: PluginNode,
  at: Placement,
): Promise<Block[]> {
  const { pluginRuntime: runtime, pluginSection: section } = env.renderOptions;
  if (!runtime || !section) {
    return renderPluginFallback(env, node, at);
  }

  const call: PluginCall = {
    node,
    section,
    at,
    snapshot: snapshotCoreState(env),
  };
  try {
    return await runPlugin(env, runtime, call);
  } catch (error) {
    return handlePluginFailure(env, call, error);
  }
}
