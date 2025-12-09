import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";

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

