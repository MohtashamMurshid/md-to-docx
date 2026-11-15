import type { Node, Root } from "mdast";
import type { CalloutStyle, Options, Style } from "./types.js";
import type {
  AnyMarkdownDocxPlugin,
  PluginAstTransformContext,
  PluginBlockNodeHandler,
  PluginFenceHandler,
  PluginRenderContext,
  PluginRenderResult,
  PluginResolvedOptions,
  PluginSectionContext,
} from "./pluginTypes.js";
import { MarkdownConversionError } from "./errors.js";
import { throwIfAborted } from "./processingLimits.js";
import { resolveImageHandlingOptions } from "./renderers/imageRenderer.js";

const PLUGIN_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const HANDLER_NAME = /^[A-Za-z][A-Za-z0-9._-]*$/;
const FENCE_NAME = /^[A-Za-z0-9][A-Za-z0-9_+.-]*$/;
const BUILT_IN_BLOCK_NODES = new Set([
  "root",
  "heading",
  "paragraph",
  "list",
  "listItem",
  "code",
  "math",
  "blockquote",
  "image",
  "table",
  "tableRow",
  "tableCell",
  "html",
  "thematicBreak",
  "footnoteDefinition",
  "footnoteReference",
  "definition",
  "yaml",
]);

interface RegisteredPlugin {
  plugin: AnyMarkdownDocxPlugin;
  registrationIndex: number;
  state: unknown;
}

export interface PluginHandlerReference {
  pluginName: string;
  kind: "fence" | "blockNode";
  handlerIndex: number;
  failureMode: "fallback" | "skip" | "throw";
}

interface PluginRuntimeOptions {
  options: Options;
  sectionCount: number;
}

/** Plugin fields read as `unknown`: plugins are third-party objects. */
type PluginFields = Partial<Record<keyof AnyMarkdownDocxPlugin, unknown>>;
type HandlerFields = Partial<
  Record<"languages" | "nodeTypes" | "failureMode" | "render", unknown>
>;

/** Handlers may be plain objects or functions carrying the handler fields. */
function handlerFields(handler: unknown): HandlerFields {
  return (typeof handler === "object" && handler !== null) ||
    typeof handler === "function"
    ? handler
    : {};
}

function isMdastRoot(value: unknown): value is Root {
  return (
    ((typeof value === "object" && value !== null) ||
      typeof value === "function") &&
    "type" in value &&
    value.type === "root" &&
    "children" in value &&
    Array.isArray(value.children)
  );
}

function pluginContext(
  pluginName: string,
  hook: string,
  section?: PluginSectionContext,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    plugin: pluginName,
    hook,
    ...(section ? { section } : {}),
    ...extra,
  };
}

export interface PluginConversionErrorOptions {
  message: string;
  reference: Pick<PluginHandlerReference, "pluginName" | "kind">;
  section: PluginSectionContext;
  extra: Record<string, unknown>;
  originalError?: unknown;
}

/**
 * Normalize an error thrown by a plugin lifecycle hook: conversion errors pass
 * through unchanged, anything else is wrapped with the plugin and hook name.
 */
function pluginHookError(
  error: unknown,
  plugin: { readonly name: string },
  failure: { label: string; hook: string; section?: PluginSectionContext },
): MarkdownConversionError {
  if (error instanceof MarkdownConversionError) {
    return error;
  }
  return new MarkdownConversionError(
    `Plugin "${plugin.name}" ${failure.label} failed: ${
      error instanceof Error ? error.message : "Unknown error"
    }`,
    pluginContext(plugin.name, failure.hook, failure.section, {
      originalError: error,
    }),
  );
}

export function pluginConversionError({
  message,
  reference,
  section,
  extra,
  originalError,
}: PluginConversionErrorOptions): MarkdownConversionError {
  return new MarkdownConversionError(message, {
    ...pluginContext(reference.pluginName, reference.kind, section, extra),
    ...(originalError !== undefined ? { originalError } : {}),
  });
}

function resolvedPluginOptions(options: Options): PluginResolvedOptions {
  const imageHandling = resolveImageHandlingOptions(options.imageHandling);
  return Object.freeze({
    documentType: options.documentType ?? "document",
    maxInputLength: options.maxInputLength,
    maxElements: options.maxElements,
    imageHandling: Object.freeze({
      ...imageHandling,
      remote: Object.freeze({
        ...imageHandling.remote,
        allowedHosts: imageHandling.remote.allowedHosts
          ? Object.freeze([...imageHandling.remote.allowedHosts])
          : undefined,
      }),
      dataUrls: Object.freeze({ ...imageHandling.dataUrls }),
    }),
  });
}

export function freezePluginStyle(style: Style): Readonly<Style> {
  const calloutStyles = style.calloutStyles
    ? Object.freeze(
        Object.fromEntries(
          // Style comes from caller options, so an entry may still be undefined.
          Object.entries<CalloutStyle | undefined>(style.calloutStyles).map(([name, value]) => [
            name,
            value ? Object.freeze({ ...value }) : value,
          ]),
        ),
      )
    : undefined;
  return Object.freeze({
    ...style,
    ...(calloutStyles ? { calloutStyles } : {}),
  });
}

function priority(plugin: AnyMarkdownDocxPlugin): number {
  return plugin.priority ?? 0;
}

function validateFailureMode(
  value: unknown,
  pluginName: string,
  hook: string,
): void {
  if (
    value !== undefined &&
    (typeof value !== "string" || !["fallback", "skip", "throw"].includes(value))
  ) {
    throw new MarkdownConversionError(
      "Invalid plugin failureMode: must be fallback, skip, or throw",
      pluginContext(pluginName, hook, undefined, { failureMode: value }),
    );
  }
}

/** Per-kind field and label used when validating fence/blockNode handlers. */
const HANDLER_KINDS = {
  fence: { namesField: "languages", renderLabel: "fence" },
  blockNode: { namesField: "nodeTypes", renderLabel: "block-node" },
} as const;

type HandlerKind = keyof typeof HANDLER_KINDS;
type ValidatedHandler<K extends HandlerKind> = HandlerFields &
  Record<(typeof HANDLER_KINDS)[K]["namesField"], readonly string[]>;

/** Validate a handler's names, failureMode and render function. */
function validateHandler<K extends HandlerKind>(
  handler: HandlerFields,
  handlerIndex: number,
  pluginName: string,
  hook: K,
): asserts handler is ValidatedHandler<K> {
  const { namesField, renderLabel } = HANDLER_KINDS[hook];
  validateHandlerNames(handler[namesField], pluginName, hook);
  validateFailureMode(handler.failureMode, pluginName, hook);
  if (typeof handler.render !== "function") {
    throw new MarkdownConversionError(
      `Invalid plugin ${renderLabel} render: must be a function`,
      pluginContext(pluginName, hook, undefined, { handlerIndex }),
    );
  }
}

function validateHandlerNames(
  names: unknown,
  pluginName: string,
  hook: "fence" | "blockNode",
): asserts names is readonly string[] {
  if (!Array.isArray(names) || names.length === 0) {
    throw new MarkdownConversionError(
      `Plugin ${hook} handler must declare at least one name`,
      pluginContext(pluginName, hook),
    );
  }

  const nameList: readonly unknown[] = names;
  const normalized = nameList.map((name) =>
    typeof name === "string"
      ? hook === "fence"
        ? name.trim().toLowerCase()
        : name.trim()
      : "",
  );
  const namePattern = hook === "fence" ? FENCE_NAME : HANDLER_NAME;
  if (normalized.some((name) => !namePattern.test(name))) {
    throw new MarkdownConversionError(
      `Invalid plugin ${hook} handler name`,
      pluginContext(pluginName, hook, undefined, { names }),
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new MarkdownConversionError(
      `Duplicate plugin ${hook} handler name`,
      pluginContext(pluginName, hook, undefined, { names }),
    );
  }
}

/** Validates shape and all deterministic registration rules without running code. */
export function validatePluginConfiguration(options: Options): void {
  // Plain-JS callers can pass anything, so read these values as unknown.
  const plugins: unknown = options.plugins;
  const pluginOptions: unknown = options.pluginOptions;
  if (!plugins) {
    return;
  }
  if (!Array.isArray(plugins)) {
    throw new MarkdownConversionError(
      "Invalid plugins: must be an array of trusted programmatic plugin objects",
    );
  }
  if (
    pluginOptions !== undefined &&
    (!pluginOptions ||
      typeof pluginOptions !== "object" ||
      Array.isArray(pluginOptions))
  ) {
    throw new MarkdownConversionError("Invalid pluginOptions: must be an object");
  }
  if (
    options.pluginOptions?.conflictPolicy !== undefined &&
    !["error", "use-priority"].includes(options.pluginOptions.conflictPolicy)
  ) {
    throw new MarkdownConversionError(
      "Invalid plugin conflictPolicy: must be error or use-priority",
    );
  }

  const names = new Set<string>();
  const fenceOwners = new Map<string, string>();
  const nodeOwners = new Map<string, string>();
  const conflictPolicy = options.pluginOptions?.conflictPolicy ?? "error";
  const pluginList: readonly unknown[] = plugins;

  pluginList.forEach((plugin, registrationIndex) => {
    if (!plugin || typeof plugin !== "object") {
      throw new MarkdownConversionError("Invalid plugin: must be an object", {
        registrationIndex,
      });
    }
    const fields: PluginFields = plugin;
    if (fields.apiVersion !== 1) {
      throw new MarkdownConversionError("Unsupported plugin apiVersion", {
        plugin: fields.name,
        apiVersion: fields.apiVersion,
      });
    }
    const pluginName = fields.name;
    if (typeof pluginName !== "string" || !PLUGIN_NAME.test(pluginName)) {
      throw new MarkdownConversionError(
        "Invalid plugin name: use a stable lowercase identifier",
        { plugin: pluginName, registrationIndex },
      );
    }
    if (names.has(pluginName)) {
      throw new MarkdownConversionError("Duplicate plugin name", {
        plugin: pluginName,
      });
    }
    names.add(pluginName);

    const pluginPriority = fields.priority;
    if (
      pluginPriority !== undefined &&
      (typeof pluginPriority !== "number" ||
        !Number.isSafeInteger(pluginPriority) ||
        Math.abs(pluginPriority) > 1000)
    ) {
      throw new MarkdownConversionError(
        "Invalid plugin priority: must be an integer from -1000 to 1000",
        { plugin: pluginName, priority: pluginPriority },
      );
    }
    if (fields.setup !== undefined && typeof fields.setup !== "function") {
      throw new MarkdownConversionError("Invalid plugin setup: must be a function", {
        plugin: pluginName,
      });
    }
    if (
      fields.transformAst !== undefined &&
      typeof fields.transformAst !== "function"
    ) {
      throw new MarkdownConversionError(
        "Invalid plugin transformAst: must be a function",
        { plugin: pluginName },
      );
    }

    const fencedBlocks = fields.fencedBlocks;
    if (fencedBlocks !== undefined && !Array.isArray(fencedBlocks)) {
      throw new MarkdownConversionError(
        "Invalid plugin fencedBlocks: must be an array",
        { plugin: pluginName },
      );
    }
    const blockNodes = fields.blockNodes;
    if (blockNodes !== undefined && !Array.isArray(blockNodes)) {
      throw new MarkdownConversionError(
        "Invalid plugin blockNodes: must be an array",
        { plugin: pluginName },
      );
    }
    const fenceHandlers: readonly unknown[] | undefined = fencedBlocks;
    const blockNodeHandlers: readonly unknown[] | undefined = blockNodes;

    fenceHandlers?.forEach((rawHandler, handlerIndex) => {
      const handler = handlerFields(rawHandler);
      validateHandler(handler, handlerIndex, pluginName, "fence");
      for (const rawLanguage of handler.languages) {
        const language = rawLanguage.trim().toLowerCase();
        const builtInEnabled =
          (language === "mermaid" && options.mermaidRendering?.enabled === true) ||
          ((language === "chart" || language === "chartjs") &&
            options.chartRendering?.enabled === true);
        if (builtInEnabled) {
          throw new MarkdownConversionError(
            "Plugin fence conflicts with an enabled built-in renderer",
            pluginContext(pluginName, "fence", undefined, { language }),
          );
        }
        const owner = fenceOwners.get(language);
        if (owner === pluginName) {
          throw new MarkdownConversionError("Duplicate plugin fence handler", {
            plugin: pluginName,
            language,
          });
        }
        if (owner && conflictPolicy === "error") {
          throw new MarkdownConversionError("Conflicting plugin fence handlers", {
            language,
            plugins: [owner, pluginName],
          });
        }
        fenceOwners.set(language, owner ?? pluginName);
      }
    });

    blockNodeHandlers?.forEach((rawHandler, handlerIndex) => {
      const handler = handlerFields(rawHandler);
      validateHandler(handler, handlerIndex, pluginName, "blockNode");
      for (const nodeType of handler.nodeTypes) {
        if (BUILT_IN_BLOCK_NODES.has(nodeType)) {
          throw new MarkdownConversionError(
            "Plugin block-node handler cannot override a built-in node type",
            pluginContext(pluginName, "blockNode", undefined, { nodeType }),
          );
        }
        const owner = nodeOwners.get(nodeType);
        if (owner === pluginName) {
          throw new MarkdownConversionError("Duplicate plugin block-node handler", {
            plugin: pluginName,
            nodeType,
          });
        }
        if (owner && conflictPolicy === "error") {
          throw new MarkdownConversionError(
            "Conflicting plugin block-node handlers",
            { nodeType, plugins: [owner, pluginName] },
          );
        }
        nodeOwners.set(nodeType, owner ?? pluginName);
      }
    });
  });
}

export class PluginRuntime {
  private readonly plugins: RegisteredPlugin[];
  private readonly fences = new Map<string, PluginHandlerReference>();
  private readonly blockNodes = new Map<string, PluginHandlerReference>();
  private readonly resolvedOptions: PluginResolvedOptions;
  readonly sectionCount: number;

  private constructor(runtimeOptions: PluginRuntimeOptions) {
    const { options, sectionCount } = runtimeOptions;
    validatePluginConfiguration(options);
    this.resolvedOptions = resolvedPluginOptions(options);
    this.sectionCount = sectionCount;
    this.plugins = (options.plugins ?? [])
      .map((plugin, registrationIndex) => ({
        plugin,
        registrationIndex,
        state: undefined,
      }))
      .sort(
        (left, right) =>
          priority(right.plugin) - priority(left.plugin) ||
          left.registrationIndex - right.registrationIndex,
      );

    for (const registered of this.plugins) {
      registered.plugin.fencedBlocks?.forEach((handler, handlerIndex) => {
        for (const rawLanguage of handler.languages) {
          const language = rawLanguage.trim().toLowerCase();
          if (!this.fences.has(language)) {
            this.fences.set(language, {
              pluginName: registered.plugin.name,
              kind: "fence",
              handlerIndex,
              failureMode: handler.failureMode ?? "fallback",
            });
          }
        }
      });
      registered.plugin.blockNodes?.forEach((handler, handlerIndex) => {
        for (const nodeType of handler.nodeTypes) {
          if (!this.blockNodes.has(nodeType)) {
            this.blockNodes.set(nodeType, {
              pluginName: registered.plugin.name,
              kind: "blockNode",
              handlerIndex,
              failureMode: handler.failureMode ?? "fallback",
            });
          }
        }
      });
    }
  }

  static async create(runtimeOptions: PluginRuntimeOptions): Promise<PluginRuntime | undefined> {
    if (!runtimeOptions.options.plugins?.length) {
      return undefined;
    }
    const runtime = new PluginRuntime(runtimeOptions);
    await runtime.setup(runtimeOptions.options.signal);
    return runtime;
  }

  private async setup(signal: AbortSignal | undefined): Promise<void> {
    for (const registered of this.plugins) {
      throwIfAborted(signal);
      if (!registered.plugin.setup) {
        continue;
      }
      try {
        registered.state = await registered.plugin.setup({
          pluginName: registered.plugin.name,
          signal,
          options: this.resolvedOptions,
        });
        throwIfAborted(signal);
      } catch (error) {
        throw pluginHookError(error, registered.plugin, {
          label: "setup",
          hook: "setup",
        });
      }
    }
  }

  private registered(reference: PluginHandlerReference): RegisteredPlugin {
    return this.plugins.find(
      ({ plugin }) => plugin.name === reference.pluginName,
    )!;
  }

  fence(language: string): PluginHandlerReference | undefined {
    return this.fences.get(language.trim().toLowerCase());
  }

  blockNode(nodeType: string): PluginHandlerReference | undefined {
    return this.blockNodes.get(nodeType);
  }

  async transformAst(
    root: Root,
    style: Style,
    section: PluginSectionContext,
    signal: AbortSignal | undefined,
  ): Promise<Root> {
    let current = root;
    for (const registered of this.plugins) {
      throwIfAborted(signal);
      const transform = registered.plugin.transformAst;
      if (!transform) {
        continue;
      }
      const context: PluginAstTransformContext = {
        pluginName: registered.plugin.name,
        signal,
        style: freezePluginStyle(style),
        options: this.resolvedOptions,
        section: Object.freeze({ ...section }),
        state: registered.state,
      };
      try {
        // Third-party transforms may return anything; validate before use.
        const transformed = (await transform(current, context)) ?? current;
        if (!isMdastRoot(transformed)) {
          throw new Error("AST transform must return an mdast Root or void");
        }
        current = transformed;
        throwIfAborted(signal);
      } catch (error) {
        throw pluginHookError(error, registered.plugin, {
          label: "AST transform",
          hook: "transformAst",
          section,
        });
      }
    }
    return current;
  }

  async render(
    reference: PluginHandlerReference,
    input: { language: string; value: string; meta?: string | undefined } | { node: Readonly<Node>; nodeType: string },
    context: Omit<PluginRenderContext, "pluginName" | "options" | "state" | "renderChildren">,
  ): Promise<PluginRenderResult> {
    const registered = this.registered(reference);
    const renderContext: PluginRenderContext = {
      ...context,
      pluginName: reference.pluginName,
      options: this.resolvedOptions,
      state: registered.state,
      renderChildren: () => ({ type: "children" }),
    };
    throwIfAborted(context.signal);
    const handler =
      reference.kind === "fence"
        ? registered.plugin.fencedBlocks?.[reference.handlerIndex]
        : registered.plugin.blockNodes?.[reference.handlerIndex];
    const result = reference.kind === "fence"
      ? await (handler as PluginFenceHandler).render(
          input as { language: string; value: string; meta?: string | undefined },
          renderContext,
        )
      : await (handler as PluginBlockNodeHandler).render(
          input as { node: Readonly<Node>; nodeType: string },
          renderContext,
        );
    throwIfAborted(context.signal);
    return result;
  }
}
