import type { Root } from "mdast";
import { MarkdownConversionError } from "./errors.js";
import type { Options } from "./types.js";

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw new MarkdownConversionError("Markdown conversion was aborted", {
    reason: signal.reason,
  });
}

export function enforceInputLength(markdown: string, options: Options): void {
  if (options.maxInputLength === undefined) {
    return;
  }

  const inputLength =
    options.sections?.reduce((total, section) => {
      return total + section.markdown.length;
    }, 0) ?? markdown.length;

  if (inputLength > options.maxInputLength) {
    throw new MarkdownConversionError(
      "Markdown input length exceeds maxInputLength",
      {
        inputLength,
        maxInputLength: options.maxInputLength,
      }
    );
  }
}

export function enforceElementLimit(
  root: Root,
  maxElements: number | undefined,
  currentCount: number,
  signal: AbortSignal | undefined
): number {
  if (maxElements === undefined) {
    return currentCount;
  }

  const stack: unknown[] = [...root.children];
  let elementCount = currentCount;

  while (stack.length > 0) {
    if (elementCount % 1000 === 0) {
      throwIfAborted(signal);
    }

    const node = stack.pop();
    elementCount++;

    if (elementCount > maxElements) {
      throw new MarkdownConversionError(
        "Markdown element count exceeds maxElements",
        {
          elementCount,
          maxElements,
        }
      );
    }

    const children = (node as { children?: unknown }).children;
    if (Array.isArray(children)) {
      for (const child of children) {
        stack.push(child);
      }
    }
  }

  return elementCount;
}
