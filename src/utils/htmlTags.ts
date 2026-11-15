/**
 * Facts about HTML shared by the Markdown pass, which groups inline tags,
 * and the HTML parser, which loads only when a document has raw HTML.
 */

/**
 * Deeper HTML is left as it was without `htmlRendering`. The hast utilities
 * recurse, and docx/html keeps only the text past this depth anyway.
 */
export const MAX_HTML_DEPTH = 512;

/** Elements that never have content or an end tag. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
