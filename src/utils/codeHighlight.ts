import { TextRun } from "docx";
import { common, createLowlight } from "lowlight";
import type { Root, RootContent } from "hast";
import { CodeHighlightOptions, CodeHighlightTheme, Style } from "../types.js";

/**
 * Built-in GitHub-light inspired palette. Token class names match the
 * highlight.js class names emitted by lowlight (without the `hljs-`
 * prefix). Users can override any subset of these via
 * `Options.codeHighlighting.theme`.
 */
export const DEFAULT_CODE_HIGHLIGHT_THEME: CodeHighlightTheme = {
  default: "24292E",
  background: "FFFFFF",
  border: "D0D7DE",
  languageLabel: "6A737D",

  keyword: "D73A49",
  "keyword.control": "D73A49",
  "keyword.operator": "D73A49",
  built_in: "005CC5",
  type: "6F42C1",
  literal: "005CC5",
  number: "005CC5",
  string: "032F62",
  regexp: "032F62",
  symbol: "005CC5",
  title: "6F42C1",
  "title.function": "6F42C1",
  "title.class": "6F42C1",
  "title.function.invoke": "6F42C1",
  params: "24292E",
  comment: "6A737D",
  doctag: "D73A49",
  meta: "6A737D",
  "meta.keyword": "D73A49",
  "meta.string": "032F62",
  section: "005CC5",
  tag: "22863A",
  name: "22863A",
  attr: "6F42C1",
  attribute: "005CC5",
  variable: "E36209",
  "variable.language": "D73A49",
  "variable.constant": "005CC5",
  template_variable: "E36209",
  template_tag: "D73A49",
  operator: "D73A49",
  punctuation: "24292E",
  deletion: "B31D28",
  addition: "22863A",
  property: "005CC5",
  "selector-tag": "22863A",
  "selector-id": "6F42C1",
  "selector-class": "6F42C1",
  "selector-attr": "6F42C1",
  "selector-pseudo": "6F42C1",
  link: "032F62",
  emphasis: "24292E",
  strong: "24292E",
  bullet: "24292E",
  quote: "6A737D",
  code: "24292E",
  formula: "005CC5",
  "class .title": "6F42C1",
  "function .title": "6F42C1",
};

type LowlightInstance = ReturnType<typeof createLowlight>;

/**
 * Cache of configured lowlight instances keyed by the list of language
 * names (or `__common__` when using the default bundle). Instances are
 * expensive to construct, so we memoize per process.
 */
const instanceCache = new Map<string, LowlightInstance>();

/**
 * Returns (and lazily creates) a lowlight instance configured with the
 * requested languages. Unknown language names are tolerated and simply
 * not registered, in which case callers must fall back to plain
 * rendering.
 */
export function getLowlightInstance(languages?: string[]): LowlightInstance {
  if (!languages || languages.length === 0) {
    let instance = instanceCache.get("__common__");
    if (!instance) {
      instance = createLowlight(common);
      instanceCache.set("__common__", instance);
    }
    return instance;
  }

  const key = [...languages].sort().join("|");
  let instance = instanceCache.get(key);
  if (instance) {
    return instance;
  }

  const grammars: Record<string, (typeof common)[keyof typeof common]> = {};
  for (const name of languages) {
    if (name in common) {
      grammars[name] = (common as Record<string, (typeof common)[keyof typeof common]>)[name];
    }
  }
  instance = createLowlight(grammars);
  instanceCache.set(key, instance);
  return instance;
}

/**
 * Merges the user-provided theme (if any) over the built-in default
 * theme, producing the palette used at render time.
 */
export function resolveTheme(
  theme?: CodeHighlightTheme
): CodeHighlightTheme {
  if (!theme) {
    return DEFAULT_CODE_HIGHLIGHT_THEME;
  }
  return { ...DEFAULT_CODE_HIGHLIGHT_THEME, ...theme };
}

/**
 * Looks up the color for a stack of active hljs classes. The deepest
 * class wins; within a single class we try the full dotted name first
 * (e.g. `title.function`) and fall back to the first segment (`title`)
 * before giving up on it and moving up the stack.
 */
function colorForClassStack(
  classStack: string[],
  theme: CodeHighlightTheme
): string | undefined {
  for (let i = classStack.length - 1; i >= 0; i--) {
    const raw = classStack[i];
    const normalized = raw.startsWith("hljs-") ? raw.slice(5) : raw;
    const direct = theme[normalized];
    if (typeof direct === "string") {
      return direct;
    }
    const dotIdx = normalized.indexOf(".");
    if (dotIdx > 0) {
      const prefix = normalized.slice(0, dotIdx);
      const prefixColor = theme[prefix];
      if (typeof prefixColor === "string") {
        return prefixColor;
      }
    }
  }
  return undefined;
}

function extractClassNames(node: RootContent): string[] {
  if (node.type !== "element") {
    return [];
  }
  const className = (node.properties as Record<string, unknown> | undefined)
    ?.className;
  if (Array.isArray(className)) {
    return className.filter((c): c is string => typeof c === "string");
  }
  if (typeof className === "string") {
    return className.split(/\s+/).filter(Boolean);
  }
  return [];
}

/**
 * Emits a run (or a break) for the given text and color, splitting on
 * embedded newlines so Word renders line breaks correctly.
 */
function pushTextRuns(
  out: TextRun[],
  text: string,
  color: string,
  style: Style
): void {
  if (text.length === 0) {
    return;
  }
  const size = style.codeBlockSize || 20;
  const rtl = style.direction === "RTL";
  const parts = text.split("\n");
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    if (segment.length > 0) {
      const leadingSpaces = segment.match(/^\s*/)?.[0].length || 0;
      const processed =
        "\u00A0".repeat(leadingSpaces) + segment.slice(leadingSpaces);
      out.push(
        new TextRun({
          text: processed,
          font: "Courier New",
          size,
          color,
          rightToLeft: rtl,
        })
      );
    }
    if (i < parts.length - 1) {
      out.push(
        new TextRun({
          text: "\n",
          font: "Courier New",
          size,
          break: 1,
          rightToLeft: rtl,
        })
      );
    }
  }
}

function walkHast(
  nodes: RootContent[],
  classStack: string[],
  theme: CodeHighlightTheme,
  style: Style,
  out: TextRun[]
): void {
  for (const node of nodes) {
    if (node.type === "text") {
      const color =
        colorForClassStack(classStack, theme) ||
        theme.default ||
        DEFAULT_CODE_HIGHLIGHT_THEME.default ||
        "24292E";
      pushTextRuns(out, node.value, color, style);
      continue;
    }
    if (node.type === "element") {
      const classes = extractClassNames(node);
      classStack.push(...classes);
      walkHast(node.children as RootContent[], classStack, theme, style, out);
      for (let i = 0; i < classes.length; i++) {
        classStack.pop();
      }
      continue;
    }
  }
}

/**
 * Tokenizes `code` as `language` using lowlight and returns a list of
 * colored `TextRun`s ready to be placed inside a code block paragraph.
 *
 * Returns `null` if the language is not registered or tokenization
 * throws, signaling that callers should fall back to the plain
 * rendering path.
 */
export function tokenizeToRuns(
  code: string,
  language: string,
  style: Style,
  options: CodeHighlightOptions
): TextRun[] | null {
  try {
    const lowlight = getLowlightInstance(options.languages);
    if (!lowlight.registered(language)) {
      return null;
    }
    const tree: Root = lowlight.highlight(language, code);
    const theme = resolveTheme(options.theme);
    const runs: TextRun[] = [];
    walkHast(tree.children, [], theme, style, runs);
    return runs;
  } catch {
    return null;
  }
}
