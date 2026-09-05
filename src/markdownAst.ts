import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { FindAndReplaceList } from "mdast-util-find-and-replace";
import type { Root, Node, Definition } from "mdast";
import type { TextReplacement, TextReplacementMode } from "./types.js";

const MAX_REPLACEMENTS = 50;
const MAX_REPLACEMENT_PATTERN_LENGTH = 256;
const MAX_REPLACEMENT_TEXT_LENGTH = 4096;

function isUnsafeRegex(pattern: RegExp): boolean {
  const source = pattern.source;
  if (source.length > MAX_REPLACEMENT_PATTERN_LENGTH) {
    return true;
  }

  // Reject common catastrophic-backtracking shapes such as (a+)+,
  // ([a-z]*)+, and alternations nested inside a quantified group.
  return (
    /\((?:[^()\\]|\\.)*[*+?](?:[^()\\]|\\.)*\)[*+?{]/.test(source) ||
    /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)[*+?{]/.test(source)
  );
}

/**
 * Parses markdown string into an mdast AST tree
 * @param markdown - The markdown string to parse
 * @param mathEnabled - Whether TeX math syntax should become mdast math nodes
 * @returns The parsed AST root node
 */
export async function parseMarkdownToAst(
  markdown: string,
  mathEnabled = true,
): Promise<Root> {
  const processor = unified().use(remarkParse).use(remarkGfm);
  if (mathEnabled) {
    processor.use(remarkMath);
  }
  const result = await processor.parse(markdown);
  return result as Root;
}

/**
 * Applies text replacements to the markdown AST
 * @param ast - The markdown AST root node
 * @param replacements - Array of text replacement configurations
 * @returns The AST with replacements applied (mutates the original AST)
 */
export function applyTextReplacements(
  ast: Root,
  replacements: TextReplacement[],
  mode: TextReplacementMode = "trusted",
): Root {
  if (mode !== "trusted" && mode !== "untrusted") {
    throw new Error(
      "Invalid textReplacementMode: Must be trusted or untrusted",
    );
  }

  if (!replacements || replacements.length === 0) {
    return ast;
  }

  if (replacements.length > MAX_REPLACEMENTS) {
    throw new Error(
      `textReplacements supports at most ${MAX_REPLACEMENTS} entries`,
    );
  }

  for (const replacement of replacements) {
    if (mode === "untrusted" && typeof replacement.replace === "function") {
      throw new Error(
        'Function textReplacements are not allowed when textReplacementMode is "untrusted"',
      );
    }
    if (
      typeof replacement.replace === "string" &&
      replacement.replace.length > MAX_REPLACEMENT_TEXT_LENGTH
    ) {
      throw new Error("textReplacements replacement text is too large");
    }
    if (replacement.find instanceof RegExp && isUnsafeRegex(replacement.find)) {
      throw new Error("Unsafe textReplacements RegExp rejected");
    }
    if (
      typeof replacement.find === "string" &&
      replacement.find.length > MAX_REPLACEMENT_PATTERN_LENGTH
    ) {
      throw new Error("textReplacements string pattern is too large");
    }
  }

  // Convert replacements to the format expected by mdast-util-find-and-replace.
  // RegExp entries are intentionally constrained above; string entries are the
  // recommended mode for untrusted callers.
  const findReplacePairs: FindAndReplaceList = replacements.map(
    (replacement) => [replacement.find, replacement.replace],
  );

  // Apply all replacements to the AST
  findAndReplace(ast, findReplacePairs);

  return ast;
}

/** Resolve CommonMark definitions before caption discovery and rendering. */
export function resolveMarkdownReferences(root: Root): void {
  // Resolve both full and collapsed CommonMark references before any block/inline
  // handling. Definitions may be nested and the first definition wins.
  const definitions = new Map<string, Definition>();
  const normalizeReference = (id: string): string =>
    id.replace(/\s+/g, " ").trim().toUpperCase();
  function collect(node: Node): void {
    if (node.type === "definition") {
      const def = node as Definition;
      const key = normalizeReference(def.identifier);
      if (!definitions.has(key)) definitions.set(key, def);
    }
    if ("children" in node)
      for (const child of node.children as Node[]) collect(child);
  }
  collect(root);
  function resolve(node: Node): Node {
    const ref = node as Node & {
      identifier?: string;
      alt?: string;
      children?: Node[];
    };
    const definition =
      ref.identifier && definitions.get(normalizeReference(ref.identifier));
    if (
      definition &&
      (node.type === "linkReference" || node.type === "imageReference")
    ) {
      return node.type === "imageReference"
        ? ({
            type: "image",
            url: definition.url,
            title: definition.title,
            alt: ref.alt ?? "",
          } as Node)
        : ({
            type: "link",
            url: definition.url,
            title: definition.title,
            children: ref.children?.map(resolve) ?? [],
          } as Node);
    }
    if (ref.children) ref.children = ref.children.map(resolve);
    return node;
  }
  resolve(root);
}
