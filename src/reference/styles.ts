import type {
  ReferenceDocxModeOptions,
  ReferenceDocxStyleRole,
  ReferenceDocxStyleSelector,
} from "../types.js";
import {
  encodeXml,
  getAttribute,
  referenceError,
  replaceAttribute,
} from "./packageXml.js";
import type { ReferencePresentationState } from "./presentation.js";

/** Reference styles and numbering: resolve the style map, merge styles.xml and numbering.xml, restyle the body. */

type StyleMap = Partial<Record<ReferenceDocxStyleRole, string>>;

/**
 * Adopt the reference's styles: map each Markdown role to a reference style,
 * merge the reference's numbering and styles into the generated ones, and
 * point the body's paragraphs, runs and tables at the mapped styles.
 */
export function applyReferenceStyles(state: ReferencePresentationState): void {
  const { reference, mode } = state;
  const referenceStyles = parseStyles(reference.stylesXml);
  const styleMap = resolveStyleMap(referenceStyles, mode);
  const numbering = remapReferenceNumbering(
    state.numberingXml,
    reference.numberingXml,
  );
  const remappedReferenceStyles = rewriteStyleNumbering(
    reference.stylesXml,
    numbering.numIdMap,
  );
  state.stylesXml = mergeStyles(remappedReferenceStyles, state.stylesXml);
  state.numberingXml = numbering.xml;
  state.documentXml = applyStyleMapToDocument(state.documentXml, styleMap);
}

/** Usually "paragraph", "character" or "table", but any w:type is kept. */
type StyleType = string;

interface ReferenceStyle {
  id: string;
  name?: string | undefined;
  type: StyleType;
  xml: string;
}

const AUTO_STYLE_CANDIDATES: Record<
  ReferenceDocxStyleRole,
  { ids: string[]; names: string[] }
> = {
  normal: { ids: ["Normal"], names: ["Normal"] },
  title: { ids: ["Title"], names: ["Title"] },
  heading1: { ids: ["Heading1"], names: ["Heading 1", "heading 1"] },
  heading2: { ids: ["Heading2"], names: ["Heading 2", "heading 2"] },
  heading3: { ids: ["Heading3"], names: ["Heading 3", "heading 3"] },
  heading4: { ids: ["Heading4"], names: ["Heading 4", "heading 4"] },
  heading5: { ids: ["Heading5"], names: ["Heading 5", "heading 5"] },
  heading6: { ids: ["Heading6"], names: ["Heading 6", "heading 6"] },
  blockquote: {
    ids: ["BlockQuote", "Quote", "IntenseQuote"],
    names: ["Block Quote", "Quote", "Intense Quote"],
  },
  codeBlock: {
    ids: ["CodeBlock", "Code"],
    names: ["Code Block", "Code"],
  },
  caption: { ids: ["Caption"], names: ["Caption"] },
  listParagraph: {
    ids: ["ListParagraph"],
    names: ["List Paragraph"],
  },
  table: {
    ids: ["TableNormal"],
    names: ["Normal Table", "Table Normal"],
  },
  strong: { ids: ["Strong"], names: ["Strong"] },
  emphasis: { ids: ["Emphasis"], names: ["Emphasis"] },
  inlineCode: {
    ids: ["InlineCode", "CodeChar"],
    names: ["Inline Code", "Code Char"],
  },
  hyperlink: { ids: ["Hyperlink"], names: ["Hyperlink"] },
};

const PARAGRAPH_ROLES = new Set<ReferenceDocxStyleRole>([
  "normal",
  "title",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
  "blockquote",
  "codeBlock",
  "caption",
  "listParagraph",
]);

const CHARACTER_ROLES = new Set<ReferenceDocxStyleRole>([
  "strong",
  "emphasis",
  "inlineCode",
  "hyperlink",
]);

function parseStyles(stylesXml: string): ReferenceStyle[] {
  const styles = Array.from(
    stylesXml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g),
    (match) => {
      const xml = match[0];
      const open = xml.match(/^<w:style\b[^>]*>/)?.[0] ?? xml;
      const nameElement = xml.match(/<w:name\b[^>]*\/?\s*>/)?.[0];
      return {
        id: getAttribute(open, "w:styleId") ?? "",
        type: getAttribute(open, "w:type") ?? "paragraph",
        name: nameElement ? getAttribute(nameElement, "w:val") : undefined,
        xml,
      };
    },
  );

  const seen = new Set<string>();
  for (const style of styles) {
    if (!style.id || seen.has(style.id)) {
      throw referenceError(
        `Reference styles.xml contains a missing or duplicate style ID: ${style.id || "(empty)"}`,
        "MALFORMED_XML",
        { entry: "word/styles.xml" },
      );
    }
    seen.add(style.id);
  }
  return styles;
}

function expectedStyleType(role: ReferenceDocxStyleRole): StyleType {
  if (PARAGRAPH_ROLES.has(role)) return "paragraph";
  if (CHARACTER_ROLES.has(role)) return "character";
  return "table";
}

interface NameLookup {
  name: string;
  duplicateBehavior: "first" | "throw";
  role: ReferenceDocxStyleRole;
  selector?: ReferenceDocxStyleSelector;
}

function resolveStyleByName(
  styles: ReferenceStyle[],
  { name, duplicateBehavior, role, selector }: NameLookup,
): ReferenceStyle | undefined {
  const matches = styles.filter((style) => style.name === name);
  if (matches.length > 1 && duplicateBehavior === "throw") {
    throw referenceError(
      `Reference DOCX style name ${name} is duplicated; select by style ID or set duplicateStyleNameBehavior to "first"`,
      "DUPLICATE_STYLE_NAME",
      { role, selector: selector ?? { name } },
    );
  }
  return matches[0];
}

/** One role's lookup result, checked against the caller's missing-style policy. */
interface StyleCandidate {
  role: ReferenceDocxStyleRole;
  selector: ReferenceDocxStyleSelector | undefined;
  style: ReferenceStyle | undefined;
  missingBehavior: "fallback" | "throw";
}

function validateResolvedStyle({
  role,
  selector,
  style,
  missingBehavior,
}: StyleCandidate): ReferenceStyle | undefined {
  const explicit = selector !== undefined;
  if (!style) {
    if (explicit && missingBehavior === "throw") {
      throw referenceError(
        `Reference DOCX style for ${role} could not be found`,
        "MISSING_STYLE",
        { role, selector },
      );
    }
    return undefined;
  }
  const expected = expectedStyleType(role);
  if (style.type !== expected) {
    // Only an explicit selector reaches the throw, so `selector` is set.
    if (!explicit || missingBehavior === "fallback") return undefined;
    throw referenceError(
      `Reference style ${style.id} has type ${style.type}; ${role} requires ${expected}`,
      "STYLE_TYPE_MISMATCH",
      { role, selector },
    );
  }
  return style;
}

/** The style list and the caller's policies, shared by every role's lookup. */
interface StyleResolution {
  styles: ReferenceStyle[];
  missingBehavior: "fallback" | "throw";
  duplicateBehavior: "first" | "throw";
}

function resolveStyleMap(
  styles: ReferenceStyle[],
  mode: ReferenceDocxModeOptions,
): StyleMap {
  const resolved: StyleMap = {};
  const resolution: StyleResolution = {
    styles,
    missingBehavior: mode.missingStyleBehavior ?? "fallback",
    duplicateBehavior: mode.duplicateStyleNameBehavior ?? "throw",
  };

  for (const role of Object.keys(AUTO_STYLE_CANDIDATES) as ReferenceDocxStyleRole[]) {
    const explicitSelector = mode.styles?.[role];
    if (explicitSelector === null) continue;
    const style = explicitSelector
      ? resolveExplicitStyle(resolution, role, explicitSelector)
      : resolveAutomaticStyle(styles, role);
    const valid = validateResolvedStyle({
      role,
      selector: explicitSelector,
      style,
      missingBehavior: resolution.missingBehavior,
    });
    if (valid) resolved[role] = valid.id;
  }
  return resolved;
}

function resolveExplicitStyle(
  { styles, duplicateBehavior }: StyleResolution,
  role: ReferenceDocxStyleRole,
  selector: ReferenceDocxStyleSelector,
): ReferenceStyle | undefined {
  const hasId = typeof selector.id === "string";
  const hasName = typeof selector.name === "string";
  if (hasId === hasName) {
    throw referenceError(
      `Reference style selector for ${role} must specify exactly one of id or name`,
      "INVALID_INPUT",
      { role, selector },
    );
  }
  const selectedValue = hasId ? selector.id : selector.name;
  if (!selectedValue || selectedValue.trim().length === 0) {
    throw referenceError(
      `Reference style selector for ${role} must not be empty`,
      "INVALID_INPUT",
      { role, selector },
    );
  }
  return hasId
    ? styles.find((candidate) => candidate.id === selector.id)
    : resolveStyleByName(styles, {
        name: selector.name,
        duplicateBehavior,
        role,
        selector,
      });
}

function resolveAutomaticStyle(
  styles: ReferenceStyle[],
  role: ReferenceDocxStyleRole,
): ReferenceStyle | undefined {
  const candidates = AUTO_STYLE_CANDIDATES[role];
  const byId = candidates.ids
    .map((id) => styles.find((candidate) => candidate.id === id))
    .find(Boolean);
  if (byId) return byId;
  for (const name of candidates.names) {
    // Automatic conventional-name lookup is deterministic by document
    // order. The caller-controlled duplicate policy applies only to an
    // explicit { name } selector, where ambiguity should be surfaced.
    const style = resolveStyleByName(styles, {
      name,
      duplicateBehavior: "first",
      role,
    });
    if (style) return style;
  }
  return undefined;
}

function idsFromXml(xml: string, pattern: RegExp): number[] {
  return Array.from(xml.matchAll(pattern), (match) => Number(match[1])).filter(
    Number.isSafeInteger,
  );
}

function remapReferenceNumbering(
  generatedNumberingXml: string,
  referenceNumberingXml: string | undefined,
): { xml: string; numIdMap: Map<number, number> } {
  const numIdMap = new Map<number, number>();
  if (!referenceNumberingXml) {
    return { xml: generatedNumberingXml, numIdMap };
  }

  const generatedAbstractIds = idsFromXml(
    generatedNumberingXml,
    /<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"/g,
  );
  const generatedNumIds = idsFromXml(
    generatedNumberingXml,
    /<w:num\b[^>]*w:numId="(\d+)"/g,
  );
  let nextAbstractId = Math.max(0, ...generatedAbstractIds) + 1;
  let nextNumId = Math.max(0, ...generatedNumIds) + 1;
  const abstractIdMap = new Map<number, number>();

  const abstractDefinitions = Array.from(
    referenceNumberingXml.matchAll(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g),
    (match) => match[0],
  ).map((definition) => {
    const id = Number(
      getAttribute(definition.match(/^<w:abstractNum\b[^>]*>/)?.[0] ?? definition, "w:abstractNumId"),
    );
    if (!Number.isSafeInteger(id)) {
      throw referenceError(
        "Reference numbering.xml contains an invalid abstract numbering ID",
        "MALFORMED_XML",
        { entry: "word/numbering.xml" },
      );
    }
    const mapped = nextAbstractId++;
    abstractIdMap.set(id, mapped);
    return replaceAttribute(definition, "w:abstractNumId", String(mapped));
  });

  const numDefinitions = Array.from(
    referenceNumberingXml.matchAll(/<w:num\b[\s\S]*?<\/w:num>/g),
    (match) => match[0],
  ).map((definition) => {
    const open = definition.match(/^<w:num\b[^>]*>/)?.[0] ?? definition;
    const id = Number(getAttribute(open, "w:numId"));
    const abstractElement = definition.match(/<w:abstractNumId\b[^>]*\/?\s*>/)?.[0];
    const abstractId = Number(
      abstractElement ? getAttribute(abstractElement, "w:val") : undefined,
    );
    if (!Number.isSafeInteger(id) || !abstractIdMap.has(abstractId)) {
      throw referenceError(
        "Reference numbering.xml contains an invalid numbering definition",
        "MALFORMED_XML",
        { entry: "word/numbering.xml" },
      );
    }
    const mapped = nextNumId++;
    numIdMap.set(id, mapped);
    let rewritten = replaceAttribute(definition, "w:numId", String(mapped));
    rewritten = rewritten.replace(
      /<w:abstractNumId\b[^>]*\/?\s*>/,
      (element) => replaceAttribute(element, "w:val", String(abstractIdMap.get(abstractId))),
    );
    return rewritten;
  });

  const additions = [...abstractDefinitions, ...numDefinitions].join("");
  return {
    xml: generatedNumberingXml.replace("</w:numbering>", `${additions}</w:numbering>`),
    numIdMap,
  };
}

function rewriteStyleNumbering(
  stylesXml: string,
  numIdMap: Map<number, number>,
): string {
  if (numIdMap.size === 0) return stylesXml;
  return stylesXml.replace(/<w:numId\b[^>]*\/?\s*>/g, (element) => {
    const id = Number(getAttribute(element, "w:val"));
    const mapped = numIdMap.get(id);
    return mapped === undefined
      ? element
      : replaceAttribute(element, "w:val", String(mapped));
  });
}

function mergeStyles(referenceStylesXml: string, generatedStylesXml: string): string {
  const referenceStyles = parseStyles(referenceStylesXml);
  const referenceIds = new Set(referenceStyles.map((style) => style.id));
  const generatedStyles = Array.from(
    generatedStylesXml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/g),
    (match) => match[0],
  );
  const appended: string[] = [];
  for (const xml of generatedStyles) {
    const open = xml.match(/^<w:style\b[^>]*>/)?.[0] ?? xml;
    const id = getAttribute(open, "w:styleId");
    if (id && !referenceIds.has(id)) {
      referenceIds.add(id);
      appended.push(xml);
    }
  }
  if (!referenceStylesXml.includes("</w:styles>")) {
    throw referenceError(
      "Reference styles.xml is malformed",
      "MALFORMED_XML",
      { entry: "word/styles.xml" },
    );
  }
  return referenceStylesXml.replace(
    "</w:styles>",
    `${appended.join("")}</w:styles>`,
  );
}

interface StyleReferencePattern {
  /** Style reference element name, e.g. `pStyle`. */
  styleTag: "pStyle" | "rStyle";
  /** Property container name, e.g. `pPr`. */
  propertiesTag: "pPr" | "rPr";
  /** Matches the first property container block. */
  properties: RegExp;
  /** Captures the opening tag of the paragraph or run element. */
  elementOpen: RegExp;
  /** Matches every existing style reference element (global). */
  styleReference: RegExp;
  /** Captures the opening tag of the property container. */
  propertiesOpen: RegExp;
}

const PARAGRAPH_STYLE_PATTERN: StyleReferencePattern = {
  styleTag: "pStyle",
  propertiesTag: "pPr",
  properties: /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/,
  elementOpen: /^(<w:p\b[^>]*>)/,
  styleReference: /<w:pStyle\b[^>]*\/?\s*>/g,
  propertiesOpen: /^(<w:pPr\b[^>]*>)/,
};

const RUN_STYLE_PATTERN: StyleReferencePattern = {
  styleTag: "rStyle",
  propertiesTag: "rPr",
  properties: /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/,
  elementOpen: /^(<w:r\b[^>]*>)/,
  styleReference: /<w:rStyle\b[^>]*\/?\s*>/g,
  propertiesOpen: /^(<w:rPr\b[^>]*>)/,
};

/**
 * Replace any style reference in a paragraph or run with `styleId`, creating
 * the property container when it is missing.
 */
function replaceStyleReference(
  element: string,
  styleId: string,
  pattern: StyleReferencePattern,
): string {
  const { styleTag, propertiesTag } = pattern;
  const styleElement = `<w:${styleTag} w:val="${encodeXml(styleId)}"/>`;
  const propertiesMatch = element.match(pattern.properties);
  if (!propertiesMatch) {
    return element.replace(
      pattern.elementOpen,
      `$1<w:${propertiesTag}>${styleElement}</w:${propertiesTag}>`,
    );
  }
  let properties = propertiesMatch[0].replace(pattern.styleReference, "");
  properties = properties.replace(pattern.propertiesOpen, `$1${styleElement}`);
  return element.replace(propertiesMatch[0], properties);
}

function replaceParagraphStyle(paragraph: string, styleId: string): string {
  return replaceStyleReference(paragraph, styleId, PARAGRAPH_STYLE_PATTERN);
}

function stripParagraphDirectFormatting(paragraph: string): string {
  return paragraph.replace(
    /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/,
    (pPr) => {
      let rewritten = pPr;
      for (const tag of [
        "bidi",
        "spacing",
        "jc",
        "pBdr",
        "shd",
        "ind",
        "keepNext",
        "keepLines",
        "widowControl",
      ]) {
        rewritten = rewritten.replace(
          new RegExp(
            `<w:${tag}\\b(?:[^>]*\\/>|[^>]*>[\\s\\S]*?<\\/w:${tag}>)`,
            "g",
          ),
          "",
        );
      }
      return rewritten;
    },
  );
}

function stripBaseRunFormatting(run: string): string {
  return run.replace(
    /<w:(?:color|sz|szCs|rFonts|rtl)\b[^>]*\/?\s*>/g,
    "",
  );
}

function replaceRunStyle(run: string, styleId: string): string {
  return replaceStyleReference(run, styleId, RUN_STYLE_PATTERN);
}

function applyRunStyles(paragraph: string, styleMap: StyleMap): string {
  let rewritten = paragraph;
  if (styleMap.hyperlink) {
    rewritten = rewritten.replace(
      /<w:hyperlink\b[\s\S]*?<\/w:hyperlink>/g,
      (hyperlink) =>
        hyperlink.replace(/<w:r\b[\s\S]*?<\/w:r>/g, (run) =>
          replaceRunStyle(run, styleMap.hyperlink!),
        ),
    );
  }
  return rewritten.replace(/<w:r\b[\s\S]*?<\/w:r>/g, (run) =>
    restyleRun(run, styleMap),
  );
}

function restyleRun(originalRun: string, styleMap: StyleMap): string {
  const role = runRole(originalRun, styleMap);
  if (!role || !styleMap[role]) return originalRun;
  const run = replaceRunStyle(originalRun, styleMap[role]);
  return role === "inlineCode"
    ? run.replace(/<w:(?:shd|rFonts|color|sz|szCs)\b[^>]*\/?\s*>/g, "")
    : run;
}

/** Inline code wins over a hyperlink, a hyperlink over bold, bold over italics. */
function runRole(
  run: string,
  styleMap: StyleMap,
): ReferenceDocxStyleRole | undefined {
  if (
    /<w:shd\b/.test(run) ||
    /<w:rFonts\b[^>]*(?:Courier|Consolas|monospace)/i.test(run)
  )
    return "inlineCode";
  const existingStyle = run.match(/<w:rStyle\b[^>]*w:val=["']([^"']+)["']/)?.[1];
  if (existingStyle === "Hyperlink" || existingStyle === styleMap.hyperlink)
    return "hyperlink";
  if (/<w:b\b/.test(run)) return "strong";
  if (/<w:i\b/.test(run)) return "emphasis";
  return undefined;
}

function paragraphRole(paragraph: string): ReferenceDocxStyleRole | undefined {
  const pPr = paragraph.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
  const styleIds = Array.from(
    pPr.matchAll(/<w:pStyle\b[^>]*w:val=["']([^"']+)["']/g),
    (match) => match[1],
  );
  for (let level = 1; level <= 6; level++) {
    if (styleIds.includes(`Heading${level}`) || styleIds.includes(String(level))) {
      return `heading${level}` as ReferenceDocxStyleRole;
    }
  }
  if (styleIds.includes("Title")) return "title";
  if (styleIds.includes("Caption")) return "caption";
  if (styleIds.includes("ListParagraph")) return "listParagraph";
  if (/<w:shd\b/.test(pPr)) return "codeBlock";
  if (/<w:pBdr\b/.test(pPr)) return "blockquote";
  if (styleIds.length === 0) return "normal";
  return undefined;
}

function applyStyleMapToDocument(
  documentXml: string,
  styleMap: StyleMap,
): string {
  let rewritten = documentXml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) => {
    const role = paragraphRole(paragraph);
    const styleId = role ? styleMap[role] : undefined;
    let output = paragraph;
    if (styleId) {
      output = replaceParagraphStyle(output, styleId);
      output = stripParagraphDirectFormatting(output);
      output = output.replace(/<w:r\b[\s\S]*?<\/w:r>/g, stripBaseRunFormatting);
    }
    return applyRunStyles(output, styleMap);
  });

  const tableStyle = styleMap.table;
  if (tableStyle) {
    rewritten = rewritten.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (table) => {
      const tblPrMatch = table.match(/<w:tblPr\b[^>]*>[\s\S]*?<\/w:tblPr>/);
      const styleElement = `<w:tblStyle w:val="${encodeXml(tableStyle)}"/>`;
      if (!tblPrMatch) {
        return table.replace(/^(<w:tbl\b[^>]*>)/, `$1<w:tblPr>${styleElement}</w:tblPr>`);
      }
      let tblPr = tblPrMatch[0].replace(/<w:tblStyle\b[^>]*\/?\s*>/g, "");
      tblPr = tblPr.replace(/^(<w:tblPr\b[^>]*>)/, `$1${styleElement}`);
      return table.replace(tblPrMatch[0], tblPr);
    });
  }
  return rewritten;
}
