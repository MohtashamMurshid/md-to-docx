import type { Node, Root } from "mdast";
import type { Options, Style } from "./types.js";
import type {
  MarkdownDocxPlugin,
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
  plugin: MarkdownDocxPlugin<any>;
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

export function pluginConversionError(
  message: string,
  reference: Pick<PluginHandlerReference, "pluginName" | "kind">,
  section: PluginSectionContext,
  extra: Record<string, unknown>,
  originalError?: unknown,
): MarkdownConversionError {
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
          Object.entries(style.calloutStyles).map(([name, value]) => [
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

function priority(plugin: MarkdownDocxPlugin): number {
  return plugin.priority ?? 0;
}

function validateFailureMode(
  value: string | undefined,
  pluginName: string,
  hook: string,
): void {
  if (value !== undefined && !["fallback", "skip", "throw"].includes(value)) {
    throw new MarkdownConversionError(
      "Invalid plugin failureMode: must be fallback, skip, or throw",
      pluginContext(pluginName, hook, undefined, { failureMode: value }),
    );
  }
}

function validateHandlerNames(
  names: readonly string[],
  pluginName: string,
  hook: "fence" | "blockNode",
): void {
  if (!Array.isArray(names) || names.length === 0) {
    throw new MarkdownConversionError(
      `Plugin ${hook} handler must declare at least one name`,
      pluginContext(pluginName, hook),
    );
  }

  const normalized = names.map((name) =>
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
  if (!options.plugins) {
    return;
  }
  if (!Array.isArray(options.plugins)) {
    throw new MarkdownConversionError(
      "Invalid plugins: must be an array of trusted programmatic plugin objects",
    );
  }
  if (
    options.pluginOptions !== undefined &&
    (!options.pluginOptions ||
      typeof options.pluginOptions !== "object" ||
      Array.isArray(options.pluginOptions))
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

  options.plugins.forEach((plugin, registrationIndex) => {
    if (!plugin || typeof plugin !== "object") {
      throw new MarkdownConversionError("Invalid plugin: must be an object", {
        registrationIndex,
      });
    }
    if (plugin.apiVersion !== 1) {
      throw new MarkdownConversionError("Unsupported plugin apiVersion", {
        plugin: plugin.name,
        apiVersion: plugin.apiVersion,
      });
    }
    if (typeof plugin.name !== "string" || !PLUGIN_NAME.test(plugin.name)) {
      throw new MarkdownConversionError(
        "Invalid plugin name: use a stable lowercase identifier",
        { plugin: plugin.name, registrationIndex },
      );
    }
    if (names.has(plugin.name)) {
      throw new MarkdownConversionError("Duplicate plugin name", {
        plugin: plugin.name,
      });
    }
    names.add(plugin.name);

    if (
      plugin.priority !== undefined &&
      (!Number.isSafeInteger(plugin.priority) || Math.abs(plugin.priority) > 1000)
    ) {
      throw new MarkdownConversionError(
        "Invalid plugin priority: must be an integer from -1000 to 1000",
        { plugin: plugin.name, priority: plugin.priority },
      );
    }
    if (plugin.setup !== undefined && typeof plugin.setup !== "function") {
      throw new MarkdownConversionError("Invalid plugin setup: must be a function", {
        plugin: plugin.name,
      });
    }
    if (
      plugin.transformAst !== undefined &&
      typeof plugin.transformAst !== "function"
    ) {
      throw new MarkdownConversionError(
        "Invalid plugin transformAst: must be a function",
        { plugin: plugin.name },
      );
    }

    if (
      plugin.fencedBlocks !== undefined &&
      !Array.isArray(plugin.fencedBlocks)
    ) {
      throw new MarkdownConversionError(
        "Invalid plugin fencedBlocks: must be an array",
        { plugin: plugin.name },
      );
    }
    if (
      plugin.blockNodes !== undefined &&
      !Array.isArray(plugin.blockNodes)
    ) {
      throw new MarkdownConversionError(
        "Invalid plugin blockNodes: must be an array",
        { plugin: plugin.name },
      );
    }

    plugin.fencedBlocks?.forEach((
      handler: PluginFenceHandler<any>,
      handlerIndex: number,
    ) => {
      validateHandlerNames(handler.languages, plugin.name, "fence");
      validateFailureMode(handler.failureMode, plugin.name, "fence");
      if (typeof handler.render !== "function") {
        throw new MarkdownConversionError(
          "Invalid plugin fence render: must be a function",
          pluginContext(plugin.name, "fence", undefined, { handlerIndex }),
        );
      }
      for (const rawLanguage of handler.languages) {
        const language = rawLanguage.trim().toLowerCase();
        const builtInEnabled =
          (language === "mermaid" && options.mermaidRendering?.enabled === true) ||
          ((language === "chart" || language === "chartjs") &&
            options.chartRendering?.enabled === true);
        if (builtInEnabled) {
          throw new MarkdownConversionError(
            "Plugin fence conflicts with an enabled built-in renderer",
            pluginContext(plugin.name, "fence", undefined, { language }),
          );
        }
        const owner = fenceOwners.get(language);
        if (owner === plugin.name) {
          throw new MarkdownConversionError("Duplicate plugin fence handler", {
            plugin: plugin.name,
            language,
          });
        }
        if (owner && conflictPolicy === "error") {
          throw new MarkdownConversionError("Conflicting plugin fence handlers", {
            language,
            plugins: [owner, plugin.name],
          });
        }
        fenceOwners.set(language, owner ?? plugin.name);
      }
    });

    plugin.blockNodes?.forEach((
      handler: PluginBlockNodeHandler<any>,
      handlerIndex: number,
    ) => {
      validateHandlerNames(handler.nodeTypes, plugin.name, "blockNode");
      validateFailureMode(handler.failureMode, plugin.name, "blockNode");
      if (typeof handler.render !== "function") {
        throw new MarkdownConversionError(
          "Invalid plugin block-node render: must be a function",
          pluginContext(plugin.name, "blockNode", undefined, { handlerIndex }),
        );
      }
      for (const nodeType of handler.nodeTypes) {
        if (BUILT_IN_BLOCK_NODES.has(nodeType)) {
          throw new MarkdownConversionError(
            "Plugin block-node handler cannot override a built-in node type",
            pluginContext(plugin.name, "blockNode", undefined, { nodeType }),
          );
        }
        const owner = nodeOwners.get(nodeType);
        if (owner === plugin.name) {
          throw new MarkdownConversionError("Duplicate plugin block-node handler", {
            plugin: plugin.name,
            nodeType,
          });
        }
        if (owner && conflictPolicy === "error") {
          throw new MarkdownConversionError(
            "Conflicting plugin block-node handlers",
            { nodeType, plugins: [owner, plugin.name] },
          );
        }
        nodeOwners.set(nodeType, owner ?? plugin.name);
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
        if (error instanceof MarkdownConversionError) {
          throw error;
        }
        throw new MarkdownConversionError(
          `Plugin "${registered.plugin.name}" setup failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          pluginContext(registered.plugin.name, "setup", undefined, {
            originalError: error,
          }),
        );
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
        current = (await transform(current, context)) ?? current;
        if (
          !current ||
          current.type !== "root" ||
          !Array.isArray(current.children)
        ) {
          throw new Error("AST transform must return an mdast Root or void");
        }
        throwIfAborted(signal);
      } catch (error) {
        if (error instanceof MarkdownConversionError) {
          throw error;
        }
        throw new MarkdownConversionError(
          `Plugin "${registered.plugin.name}" AST transform failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          pluginContext(registered.plugin.name, "transformAst", section, {
            originalError: error,
          }),
        );
      }
    }
    return current;
  }

  async render(
    reference: PluginHandlerReference,
    input: { language: string; value: string; meta?: string } | { node: Readonly<Node>; nodeType: string },
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
        ? registered.plugin.fencedBlocks?.[reference.handlerIndex] as PluginFenceHandler | undefined
        : registered.plugin.blockNodes?.[reference.handlerIndex] as PluginBlockNodeHandler | undefined;
    const result = reference.kind === "fence"
      ? await (handler as PluginFenceHandler).render(
          input as { language: string; value: string; meta?: string },
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
