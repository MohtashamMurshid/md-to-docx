import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { findAndReplace } from "mdast-util-find-and-replace";
import type { Root } from "mdast";
import type { TextReplacement } from "./types.js";

/**
 * Parses markdown string into an mdast AST tree
 * @param markdown - The markdown string to parse
 * @returns The parsed AST root node
 */
export async function parseMarkdownToAst(markdown: string): Promise<Root> {
  const processor = unified().use(remarkParse).use(remarkGfm);
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
  replacements: TextReplacement[]
): Root {
  if (!replacements || replacements.length === 0) {
    return ast;
  }

  // Convert replacements to the format expected by mdast-util-find-and-replace
  const findReplacePairs: Array<[string | RegExp, string | ((...args: any[]) => any)]> = 
    replacements.map((replacement) => [
      replacement.find,
      replacement.replace,
    ]);

  // Apply all replacements to the AST
  findAndReplace(ast, findReplacePairs);

  return ast;
}

