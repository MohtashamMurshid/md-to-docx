import type { Code } from "mdast";
import type { DocxBlockNode } from "../docxModel.js";
import type { ConversionContext } from "./context.js";

/** A fenced block's language as written, and lowercased for matching. */
interface FenceLanguage {
  readonly language: string | undefined;
  readonly normalized: string | undefined;
}

function isMermaidFence(context: ConversionContext, fence: FenceLanguage) {
  return (
    context.options.mermaidRendering?.enabled === true &&
    fence.normalized === "mermaid"
  );
}

function isChartFence(context: ConversionContext, fence: FenceLanguage) {
  return (
    context.options.chartRendering?.enabled === true &&
    (fence.normalized === "chart" || fence.normalized === "chartjs")
  );
}

function withLanguage(fence: FenceLanguage) {
  return fence.language !== undefined ? { language: fence.language } : {};
}

function withMeta(code: Code) {
  return code.meta ? { meta: code.meta } : {};
}

function pluginFenceBlock(
  context: ConversionContext,
  code: Code,
  language: string | undefined,
): DocxBlockNode | null {
  if (!language) {
    return null;
  }
  const handler = context.pluginRuntime?.fence(language);
  if (!handler) {
    return null;
  }
  return {
    type: "pluginBlock",
    handler,
    source: {
      kind: "fence",
      language,
      value: code.value || "",
      ...withMeta(code),
    },
    children: [],
    fallbackText: code.value || "",
  };
}

/**
 * Enabled `mermaid` and `chart`/`chartjs` fences become diagram blocks, a
 * plugin-registered language becomes a plugin block, and anything else is a
 * plain code block.
 */
export function processCodeBlock(
  context: ConversionContext,
  code: Code,
): DocxBlockNode {
  const language = code.lang || undefined;
  const fence: FenceLanguage = {
    language,
    normalized: language?.trim().toLowerCase(),
  };

  if (isMermaidFence(context, fence)) {
    return { type: "mermaidBlock", value: code.value || "", ...withMeta(code) };
  }
  if (isChartFence(context, fence)) {
    return { type: "chartBlock", ...withLanguage(fence), value: code.value || "" };
  }
  return (
    pluginFenceBlock(context, code, fence.normalized) ?? {
      type: "codeBlock",
      ...withLanguage(fence),
      value: code.value || "",
    }
  );
}
