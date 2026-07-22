import JSZip from "jszip";
import { MarkdownConversionError } from "./errors.js";
import { yieldToAbortSignal } from "./processingLimits.js";
import type {
  Options,
  ReferenceDocxErrorCode,
  ReferenceDocxErrorContext,
  ReferenceDocxGenerationOptions,
  ReferenceDocxBytes,
  ReferenceDocxModeOptions,
  ReferenceDocxPackageLimits,
  ReferenceDocxStyleRole,
  ReferenceDocxStyleSelector,
  SectionPageConfig,
} from "./types.js";

const DEFAULT_LIMITS: Required<ReferenceDocxPackageLimits> = {
  maxCompressedBytes: 16 * 1024 * 1024,
  maxUncompressedBytes: 64 * 1024 * 1024,
  maxEntryUncompressedBytes: 16 * 1024 * 1024,
  maxEntries: 512,
};

const REQUIRED_PARTS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
  "word/_rels/document.xml.rels",
  "word/styles.xml",
] as const;

const RELATIONSHIP_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

type StyleType = "paragraph" | "character" | "table" | string;

interface ReferenceStyle {
  id: string;
  name?: string;
  type: StyleType;
  xml: string;
}

interface Relationship {
  id: string;
  type: string;
  target: string;
  targetMode?: string;
  xml: string;
}

interface ContentTypes {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
}

export interface LoadedReferenceDocx {
  zip: JSZip;
  contentTypesXml: string;
  documentXml: string;
  documentRelationshipsXml: string;
  stylesXml: string;
  numberingXml?: string;
  finalSectionProperties?: string;
  page?: SectionPageConfig;
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

function referenceError(
  message: string,
  code: ReferenceDocxErrorCode,
  details: Omit<ReferenceDocxErrorContext, "phase" | "code"> = {},
): MarkdownConversionError {
  return new MarkdownConversionError(message, {
    phase: "reference-docx",
    code,
    ...details,
  } satisfies ReferenceDocxErrorContext);
}

function throwIfReferenceAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw referenceError("Reference DOCX generation was aborted", "ABORTED", {
      originalError: signal.reason,
    });
  }
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw referenceError(
      `${name} must be a positive safe integer`,
      "INVALID_INPUT",
      { actual: value },
    );
  }
}

function resolveLimits(
  limits: ReferenceDocxPackageLimits | undefined,
): Required<ReferenceDocxPackageLimits> {
  const resolved = { ...DEFAULT_LIMITS, ...(limits || {}) };
  for (const [name, value] of Object.entries(resolved)) {
    validatePositiveInteger(value, `reference.limits.${name}`);
  }
  return resolved;
}

async function inputToBytes(
  input: ReferenceDocxBytes,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfReferenceAborted(signal);

  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    const bytes = new Uint8Array(await input.arrayBuffer());
    throwIfReferenceAborted(signal);
    return bytes;
  }

  throw referenceError(
    "Reference DOCX must be provided as Buffer, Uint8Array, ArrayBuffer, or Blob bytes",
    "INVALID_INPUT",
  );
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function encodeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getAttribute(xml: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`(?:\\s|<)${escapedName}\\s*=\\s*(["'])(.*?)\\1`),
  );
  return match ? decodeXml(match[2]) : undefined;
}

function replaceAttribute(xml: string, name: string, value: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(${escapedName}\\s*=\\s*)(["'])(.*?)\\2`);
  if (pattern.test(xml)) {
    return xml.replace(pattern, `$1"${encodeXml(value)}"`);
  }
  return xml.replace(/\s*\/>$/, ` ${name}="${encodeXml(value)}"/>`);
}

function assertSafeXml(xml: string, entry: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw referenceError(
      `Reference DOCX XML part ${entry} contains a prohibited DTD or entity declaration`,
      "MALFORMED_XML",
      { entry },
    );
  }
}

async function readXml(zip: JSZip, entry: string): Promise<string> {
  const file = zip.file(entry);
  if (!file) {
    throw referenceError(
      `Reference DOCX is missing required package part ${entry}`,
      "MISSING_PACKAGE_PART",
      { entry },
    );
  }
  let xml: string;
  try {
    xml = await file.async("string");
  } catch (error) {
    throw referenceError(
      `Reference DOCX package part ${entry} could not be decompressed`,
      "INVALID_ZIP",
      { entry, originalError: error },
    );
  }
  assertSafeXml(xml, entry);
  return xml;
}

function unsafeEntryReason(name: string): boolean {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return true;
  }
  const normalized = decoded.replace(/\\/g, "/");
  return (
    decoded.includes("\\") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "..")
  );
}

function validateZipEntries(
  zip: JSZip,
  limits: Required<ReferenceDocxPackageLimits>,
): void {
  const entries = Object.values(zip.files);
  if (entries.length > limits.maxEntries) {
    throw referenceError(
      `Reference DOCX contains ${entries.length} ZIP entries; limit is ${limits.maxEntries}`,
      "PACKAGE_LIMIT_EXCEEDED",
      { limit: limits.maxEntries, actual: entries.length },
    );
  }

  let totalUncompressed = 0;
  for (const entry of entries) {
    const metadata = entry as typeof entry & {
      unsafeOriginalName?: string;
      _data?: { uncompressedSize?: number; compressedSize?: number };
    };
    const originalName = metadata.unsafeOriginalName ?? entry.name;
    if (
      originalName !== entry.name ||
      unsafeEntryReason(originalName) ||
      unsafeEntryReason(entry.name)
    ) {
      throw referenceError(
        `Reference DOCX contains an unsafe ZIP entry path: ${originalName}`,
        "UNSAFE_ENTRY_PATH",
        { entry: originalName },
      );
    }

    const size = metadata._data?.uncompressedSize ?? 0;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw referenceError(
        `Reference DOCX has invalid size metadata for ${entry.name}`,
        "INVALID_ZIP",
        { entry: entry.name, actual: size },
      );
    }
    if (size > limits.maxEntryUncompressedBytes) {
      throw referenceError(
        `Reference DOCX entry ${entry.name} exceeds the uncompressed entry limit`,
        "PACKAGE_LIMIT_EXCEEDED",
        {
          entry: entry.name,
          limit: limits.maxEntryUncompressedBytes,
          actual: size,
        },
      );
    }
    totalUncompressed += size;
    if (totalUncompressed > limits.maxUncompressedBytes) {
      throw referenceError(
        "Reference DOCX exceeds the total uncompressed package limit",
        "PACKAGE_LIMIT_EXCEEDED",
        { limit: limits.maxUncompressedBytes, actual: totalUncompressed },
      );
    }
  }
}

function extractFinalSectionProperties(documentXml: string): string | undefined {
  const matches = Array.from(
    documentXml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g),
    (match) => match[0],
  );
  return matches.at(-1);
}

function numericAttribute(xml: string, name: string): number | undefined {
  const value = getAttribute(xml, name);
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

function extractPageConfig(
  sectionProperties: string | undefined,
): SectionPageConfig | undefined {
  if (!sectionProperties) return undefined;
  const pageSize = sectionProperties.match(/<w:pgSz\b[^>]*\/?\s*>/)?.[0];
  const pageMargin = sectionProperties.match(/<w:pgMar\b[^>]*\/?\s*>/)?.[0];
  if (!pageSize && !pageMargin) return undefined;

  return {
    ...(pageSize
      ? {
          size: {
            width: numericAttribute(pageSize, "w:w"),
            height: numericAttribute(pageSize, "w:h"),
            orientation:
              getAttribute(pageSize, "w:orient") === "landscape"
                ? ("LANDSCAPE" as const)
                : ("PORTRAIT" as const),
          },
        }
      : {}),
    ...(pageMargin
      ? {
          margin: {
            top: numericAttribute(pageMargin, "w:top"),
            right: numericAttribute(pageMargin, "w:right"),
            bottom: numericAttribute(pageMargin, "w:bottom"),
            left: numericAttribute(pageMargin, "w:left"),
            header: numericAttribute(pageMargin, "w:header"),
            footer: numericAttribute(pageMargin, "w:footer"),
            gutter: numericAttribute(pageMargin, "w:gutter"),
          },
        }
      : {}),
  };
}

export async function loadReferenceDocx(
  input: ReferenceDocxBytes,
  mode: ReferenceDocxModeOptions = {},
  signal?: AbortSignal,
): Promise<LoadedReferenceDocx> {
  try {
    const limits = resolveLimits(mode.limits);
    const bytes = await inputToBytes(input, signal);
    if (bytes.byteLength > limits.maxCompressedBytes) {
      throw referenceError(
        "Reference DOCX exceeds the compressed package limit",
        "PACKAGE_LIMIT_EXCEEDED",
        { limit: limits.maxCompressedBytes, actual: bytes.byteLength },
      );
    }
    if (bytes.byteLength < 4) {
      throw referenceError("Reference DOCX is not a valid ZIP package", "INVALID_ZIP");
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes, { createFolders: false });
    } catch (error) {
      throw referenceError("Reference DOCX is not a valid ZIP package", "INVALID_ZIP", {
        originalError: error,
      });
    }
    throwIfReferenceAborted(signal);
    validateZipEntries(zip, limits);
    for (const entry of REQUIRED_PARTS) {
      if (!zip.file(entry)) {
        throw referenceError(
          `Reference DOCX is missing required package part ${entry}`,
          "MISSING_PACKAGE_PART",
          { entry },
        );
      }
    }

    const [contentTypesXml, rootRelsXml, documentXml, documentRelationshipsXml, stylesXml] =
      await Promise.all([
        readXml(zip, "[Content_Types].xml"),
        readXml(zip, "_rels/.rels"),
        readXml(zip, "word/document.xml"),
        readXml(zip, "word/_rels/document.xml.rels"),
        readXml(zip, "word/styles.xml"),
      ]);
    throwIfReferenceAborted(signal);

    if (
      !/wordprocessingml\.document\.main\+xml/.test(contentTypesXml) ||
      !/relationships\/officeDocument/.test(rootRelsXml) ||
      !/<w:document\b/.test(documentXml) ||
      !/<w:styles\b/.test(stylesXml)
    ) {
      throw referenceError(
        "Reference ZIP is not a valid WordprocessingML DOCX package",
        "INVALID_PACKAGE",
      );
    }

    const numberingXml = zip.file("word/numbering.xml")
      ? await readXml(zip, "word/numbering.xml")
      : undefined;
    const finalSectionProperties = extractFinalSectionProperties(documentXml);

    return {
      zip,
      contentTypesXml,
      documentXml,
      documentRelationshipsXml,
      stylesXml,
      numberingXml,
      finalSectionProperties,
      page: extractPageConfig(finalSectionProperties),
    };
  } catch (error) {
    if (error instanceof MarkdownConversionError) throw error;
    throw referenceError("Failed to inspect reference DOCX package", "INVALID_PACKAGE", {
      originalError: error,
    });
  }
}

export function buildReferenceConversionOptions(
  options: ReferenceDocxGenerationOptions,
  reference: LoadedReferenceDocx,
): Options {
  const { reference: mode, ...conversionOptions } = options;
  if ((mode?.preservePageLayout ?? true) && reference.page) {
    const page = reference.page;
    conversionOptions.template = {
      ...(conversionOptions.template || {}),
      page,
    };
    if (conversionOptions.sections) {
      conversionOptions.sections = conversionOptions.sections.map((section) => ({
        ...section,
        page,
      }));
    }
  }
  return conversionOptions;
}

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

function resolveStyleByName(
  styles: ReferenceStyle[],
  name: string,
  duplicateBehavior: "first" | "throw",
  role: ReferenceDocxStyleRole,
  selector?: ReferenceDocxStyleSelector,
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

function validateResolvedStyle(
  role: ReferenceDocxStyleRole,
  selector: ReferenceDocxStyleSelector | undefined,
  style: ReferenceStyle | undefined,
  missingBehavior: "fallback" | "throw",
  explicit: boolean,
): ReferenceStyle | undefined {
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
    if (!explicit || missingBehavior === "fallback") return undefined;
    throw referenceError(
      `Reference style ${style.id} has type ${style.type}; ${role} requires ${expected}`,
      "STYLE_TYPE_MISMATCH",
      { role, selector: selector ?? { id: style.id } },
    );
  }
  return style;
}

function resolveStyleMap(
  styles: ReferenceStyle[],
  mode: ReferenceDocxModeOptions,
): Partial<Record<ReferenceDocxStyleRole, string>> {
  const resolved: Partial<Record<ReferenceDocxStyleRole, string>> = {};
  const missingBehavior = mode.missingStyleBehavior ?? "fallback";
  const duplicateBehavior = mode.duplicateStyleNameBehavior ?? "throw";

  for (const role of Object.keys(AUTO_STYLE_CANDIDATES) as ReferenceDocxStyleRole[]) {
    const explicitSelector = mode.styles?.[role];
    if (explicitSelector === null) continue;
    const explicit = explicitSelector !== undefined;
    let style: ReferenceStyle | undefined;

    if (explicitSelector) {
      const hasId = typeof explicitSelector.id === "string";
      const hasName = typeof explicitSelector.name === "string";
      if (hasId === hasName) {
        throw referenceError(
          `Reference style selector for ${role} must specify exactly one of id or name`,
          "INVALID_INPUT",
          { role, selector: explicitSelector },
        );
      }
      const selectedValue = hasId ? explicitSelector.id : explicitSelector.name;
      if (!selectedValue || selectedValue.trim().length === 0) {
        throw referenceError(
          `Reference style selector for ${role} must not be empty`,
          "INVALID_INPUT",
          { role, selector: explicitSelector },
        );
      }
      style = hasId
        ? styles.find((candidate) => candidate.id === explicitSelector.id)
        : resolveStyleByName(
            styles,
            explicitSelector.name as string,
            duplicateBehavior,
            role,
            explicitSelector,
          );
    } else {
      const candidates = AUTO_STYLE_CANDIDATES[role];
      style = candidates.ids
        .map((id) => styles.find((candidate) => candidate.id === id))
        .find(Boolean);
      if (!style) {
        for (const name of candidates.names) {
          style = resolveStyleByName(styles, name, duplicateBehavior, role);
          if (style) break;
        }
      }
    }

    const valid = validateResolvedStyle(
      role,
      explicitSelector ?? undefined,
      style,
      missingBehavior,
      explicit,
    );
    if (valid) resolved[role] = valid.id;
  }
  return resolved;
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

function replaceParagraphStyle(paragraph: string, styleId: string): string {
  const styleElement = `<w:pStyle w:val="${encodeXml(styleId)}"/>`;
  const pPrMatch = paragraph.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/);
  if (!pPrMatch) {
    return paragraph.replace(/^(<w:p\b[^>]*>)/, `$1<w:pPr>${styleElement}</w:pPr>`);
  }
  let pPr = pPrMatch[0].replace(/<w:pStyle\b[^>]*\/?\s*>/g, "");
  pPr = pPr.replace(/^(<w:pPr\b[^>]*>)/, `$1${styleElement}`);
  return paragraph.replace(pPrMatch[0], pPr);
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
  const styleElement = `<w:rStyle w:val="${encodeXml(styleId)}"/>`;
  const rPrMatch = run.match(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/);
  if (!rPrMatch) {
    return run.replace(/^(<w:r\b[^>]*>)/, `$1<w:rPr>${styleElement}</w:rPr>`);
  }
  let rPr = rPrMatch[0].replace(/<w:rStyle\b[^>]*\/?\s*>/g, "");
  rPr = rPr.replace(/^(<w:rPr\b[^>]*>)/, `$1${styleElement}`);
  return run.replace(rPrMatch[0], rPr);
}

function applyRunStyles(
  paragraph: string,
  styleMap: Partial<Record<ReferenceDocxStyleRole, string>>,
): string {
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
  return rewritten.replace(/<w:r\b[\s\S]*?<\/w:r>/g, (originalRun) => {
    let run = originalRun;
    const isInlineCode =
      /<w:shd\b/.test(run) ||
      /<w:rFonts\b[^>]*(?:Courier|Consolas|monospace)/i.test(run);
    const isStrong = /<w:b\b/.test(run);
    const isEmphasis = /<w:i\b/.test(run);
    const existingStyle = run.match(/<w:rStyle\b[^>]*w:val=["']([^"']+)["']/)?.[1];
    const isHyperlink =
      existingStyle === "Hyperlink" || existingStyle === styleMap.hyperlink;

    const role: ReferenceDocxStyleRole | undefined = isInlineCode
      ? "inlineCode"
      : isHyperlink
        ? "hyperlink"
        : isStrong
          ? "strong"
          : isEmphasis
            ? "emphasis"
            : undefined;
    if (role && styleMap[role]) {
      run = replaceRunStyle(run, styleMap[role]);
      if (role === "inlineCode") {
        run = run.replace(/<w:(?:shd|rFonts|color|sz|szCs)\b[^>]*\/?\s*>/g, "");
      }
    }
    return run;
  });
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
  styleMap: Partial<Record<ReferenceDocxStyleRole, string>>,
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

function parseRelationships(xml: string, entry: string): Relationship[] {
  if (!/<Relationships\b/.test(xml)) {
    throw referenceError(`Relationship part ${entry} is malformed`, "MALFORMED_XML", {
      entry,
    });
  }
  return Array.from(xml.matchAll(/<Relationship\b[^>]*\/?\s*>/g), (match) => {
    const relation = match[0];
    const id = getAttribute(relation, "Id");
    const type = getAttribute(relation, "Type");
    const target = getAttribute(relation, "Target");
    if (!id || !type || !target) {
      throw referenceError(`Relationship part ${entry} is malformed`, "MALFORMED_XML", {
        entry,
      });
    }
    return {
      id,
      type,
      target,
      targetMode: getAttribute(relation, "TargetMode"),
      xml: relation,
    };
  });
}

function parseContentTypes(xml: string): ContentTypes {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const match of xml.matchAll(/<Default\b[^>]*\/?\s*>/g)) {
    const extension = getAttribute(match[0], "Extension");
    const contentType = getAttribute(match[0], "ContentType");
    if (extension && contentType) defaults.set(extension.toLowerCase(), contentType);
  }
  for (const match of xml.matchAll(/<Override\b[^>]*\/?\s*>/g)) {
    const partName = getAttribute(match[0], "PartName");
    const contentType = getAttribute(match[0], "ContentType");
    if (partName && contentType) overrides.set(partName, contentType);
  }
  return { defaults, overrides };
}

function relationshipPartPath(part: string): string {
  const slash = part.lastIndexOf("/");
  const directory = slash >= 0 ? part.slice(0, slash + 1) : "";
  const basename = slash >= 0 ? part.slice(slash + 1) : part;
  return `${directory}_rels/${basename}.rels`;
}

function resolvePartTarget(sourcePart: string, target: string): string {
  if (unsafeEntryReason(target) || target.startsWith("/")) {
    throw referenceError(
      `Relationship target contains an unsafe package path: ${target}`,
      "UNSAFE_ENTRY_PATH",
      { entry: target },
    );
  }
  const base = sourcePart.slice(0, sourcePart.lastIndexOf("/") + 1);
  const segments = `${base}${target}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) {
        throw referenceError(
          `Relationship target escapes the DOCX package: ${target}`,
          "UNSAFE_ENTRY_PATH",
          { entry: target },
        );
      }
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

function relativeTarget(fromPart: string, toPart: string): string {
  const from = fromPart.split("/").slice(0, -1);
  const to = toPart.split("/");
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common++;
  }
  return `${"../".repeat(from.length - common)}${to.slice(common).join("/")}`;
}

function contentTypeForPart(types: ContentTypes, part: string): string | undefined {
  const override = types.overrides.get(`/${part}`);
  if (override) return override;
  const extension = part.includes(".") ? part.split(".").pop()?.toLowerCase() : undefined;
  return extension ? types.defaults.get(extension) : undefined;
}

function addContentType(
  xml: string,
  part: string,
  contentType: string,
): string {
  const types = parseContentTypes(xml);
  if (types.overrides.has(`/${part}`)) return xml;
  const entry = `<Override PartName="/${encodeXml(part)}" ContentType="${encodeXml(contentType)}"/>`;
  return xml.replace("</Types>", `${entry}</Types>`);
}

function addDefaultContentTypes(outputXml: string, referenceXml: string): string {
  const output = parseContentTypes(outputXml);
  const reference = parseContentTypes(referenceXml);
  let rewritten = outputXml;
  for (const [extension, contentType] of reference.defaults) {
    if (!output.defaults.has(extension)) {
      rewritten = rewritten.replace(
        "</Types>",
        `<Default Extension="${encodeXml(extension)}" ContentType="${encodeXml(contentType)}"/></Types>`,
      );
      output.defaults.set(extension, contentType);
    }
  }
  return rewritten;
}

function nextRelationshipId(relationships: Relationship[]): string {
  const used = new Set(relationships.map((relation) => relation.id));
  let counter = 1;
  while (used.has(`rIdReference${counter}`)) counter++;
  return `rIdReference${counter}`;
}

function relationshipXml(relationship: Relationship): string {
  return `<Relationship Id="${encodeXml(relationship.id)}" Type="${encodeXml(relationship.type)}" Target="${encodeXml(relationship.target)}"${
    relationship.targetMode
      ? ` TargetMode="${encodeXml(relationship.targetMode)}"`
      : ""
  }/>`;
}

function replaceOrAddRelationship(
  xml: string,
  relationship: Relationship,
  existing?: Relationship,
): string {
  if (existing) return xml.replace(existing.xml, relationshipXml(relationship));
  return xml.replace("</Relationships>", `${relationshipXml(relationship)}</Relationships>`);
}

async function importReferencePartGraph(
  outputZip: JSZip,
  reference: LoadedReferenceDocx,
  sourcePart: string,
  imported: Map<string, string>,
  allowedInternalTypes: Set<string>,
  signal?: AbortSignal,
): Promise<string> {
  const existing = imported.get(sourcePart);
  if (existing) return existing;
  if (unsafeEntryReason(sourcePart) || !reference.zip.file(sourcePart)) {
    throw referenceError(
      `Reference relationship target is missing or unsafe: ${sourcePart}`,
      "MISSING_PACKAGE_PART",
      { entry: sourcePart },
    );
  }

  const destination = `word/reference-package/${sourcePart}`;
  imported.set(sourcePart, destination);
  const sourceFile = reference.zip.file(sourcePart);
  const bytes = await sourceFile!.async("uint8array");
  throwIfReferenceAborted(signal);
  if (sourcePart.toLowerCase().endsWith(".xml")) {
    assertSafeXml(new TextDecoder().decode(bytes), sourcePart);
  }
  outputZip.file(destination, bytes);

  const referenceTypes = parseContentTypes(reference.contentTypesXml);
  const contentType = contentTypeForPart(referenceTypes, sourcePart);
  if (!contentType) {
    throw referenceError(
      `Reference package has no content type for ${sourcePart}`,
      "INVALID_PACKAGE",
      { entry: sourcePart },
    );
  }

  const relsPath = relationshipPartPath(sourcePart);
  const relsFile = reference.zip.file(relsPath);
  if (relsFile) {
    let relsXml = await readXml(reference.zip, relsPath);
    const relationships = parseRelationships(relsXml, relsPath);
    for (const relationship of relationships) {
      const typeSuffix = relationship.type.slice(RELATIONSHIP_NS.length);
      if (relationship.targetMode?.toLowerCase() === "external") {
        if (typeSuffix !== "hyperlink") {
          throw referenceError(
            `Unsupported external reference relationship type: ${relationship.type}`,
            "UNSUPPORTED_RELATIONSHIP",
            { entry: relsPath, relationshipType: relationship.type },
          );
        }
        continue;
      }
      if (!allowedInternalTypes.has(typeSuffix)) {
        throw referenceError(
          `Unsupported reference relationship type: ${relationship.type}`,
          "UNSUPPORTED_RELATIONSHIP",
          { entry: relsPath, relationshipType: relationship.type },
        );
      }
      const targetPart = resolvePartTarget(sourcePart, relationship.target);
      await importReferencePartGraph(
        outputZip,
        reference,
        targetPart,
        imported,
        allowedInternalTypes,
        signal,
      );
    }
    outputZip.file(relationshipPartPath(destination), relsXml);
  }

  return destination;
}

function presentationTags(sectionProperties: string): string {
  const names = [
    "type",
    "pgSz",
    "pgMar",
    "paperSrc",
    "pgBorders",
    "lnNumType",
    "pgNumType",
    "cols",
    "formProt",
    "vAlign",
    "noEndnote",
    "titlePg",
    "textDirection",
    "bidi",
    "rtlGutter",
    "docGrid",
  ];
  return names
    .map((name) => {
      const expression = new RegExp(
        `<w:${name}\\b(?:[^>]*\\/>|[^>]*>[\\s\\S]*?<\\/w:${name}>)`,
      );
      return sectionProperties.match(expression)?.[0] ?? "";
    })
    .join("");
}

function removePresentationTags(sectionProperties: string): string {
  let rewritten = sectionProperties;
  for (const tag of [
    "type",
    "pgSz",
    "pgMar",
    "paperSrc",
    "pgBorders",
    "lnNumType",
    "pgNumType",
    "cols",
    "formProt",
    "vAlign",
    "noEndnote",
    "titlePg",
    "textDirection",
    "bidi",
    "rtlGutter",
    "docGrid",
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
}

async function adoptSectionPresentation(
  documentXml: string,
  outputZip: JSZip,
  outputRelationshipsXml: string,
  outputContentTypesXml: string,
  reference: LoadedReferenceDocx,
  mode: ReferenceDocxModeOptions,
  signal?: AbortSignal,
): Promise<{
  documentXml: string;
  relationshipsXml: string;
  contentTypesXml: string;
}> {
  const section = reference.finalSectionProperties;
  if (!section) {
    return {
      documentXml,
      relationshipsXml: outputRelationshipsXml,
      contentTypesXml: outputContentTypesXml,
    };
  }

  let relationshipsXml = outputRelationshipsXml;
  let contentTypesXml = addDefaultContentTypes(
    outputContentTypesXml,
    reference.contentTypesXml,
  );
  let outputRelationships = parseRelationships(
    relationshipsXml,
    "word/_rels/document.xml.rels",
  );
  const referenceRelationships = parseRelationships(
    reference.documentRelationshipsXml,
    "word/_rels/document.xml.rels",
  );
  const imported = new Map<string, string>();
  const rewrittenHeaderFooterReferences: string[] = [];

  if (mode.preserveHeadersAndFooters ?? true) {
    const references = Array.from(
      section.matchAll(/<w:(headerReference|footerReference)\b[^>]*\/?\s*>/g),
      (match) => ({ kind: match[1], xml: match[0] }),
    );
    for (const referenceElement of references) {
      const referenceId = getAttribute(referenceElement.xml, "r:id");
      const relationship = referenceRelationships.find(
        (candidate) => candidate.id === referenceId,
      );
      const expectedSuffix =
        referenceElement.kind === "headerReference" ? "header" : "footer";
      if (
        !relationship ||
        !relationship.type.endsWith(`/${expectedSuffix}`) ||
        relationship.targetMode?.toLowerCase() === "external"
      ) {
        throw referenceError(
          `Reference ${expectedSuffix} relationship is missing or unsupported`,
          "UNSUPPORTED_RELATIONSHIP",
          { relationshipType: relationship?.type },
        );
      }
      const sourcePart = resolvePartTarget("word/document.xml", relationship.target);
      const destination = await importReferencePartGraph(
        outputZip,
        reference,
        sourcePart,
        imported,
        new Set(["image"]),
        signal,
      );
      const id = nextRelationshipId(outputRelationships);
      const importedRelationship: Relationship = {
        id,
        type: relationship.type,
        target: relativeTarget("word/document.xml", destination),
        xml: "",
      };
      relationshipsXml = replaceOrAddRelationship(
        relationshipsXml,
        importedRelationship,
      );
      outputRelationships.push(importedRelationship);
      rewrittenHeaderFooterReferences.push(
        replaceAttribute(referenceElement.xml, "r:id", id),
      );
    }
  }

  const referenceTypes = parseContentTypes(reference.contentTypesXml);
  for (const [source, destination] of imported) {
    const contentType = contentTypeForPart(referenceTypes, source);
    if (contentType) {
      contentTypesXml = addContentType(contentTypesXml, destination, contentType);
    }
  }

  const layout =
    mode.preservePageLayout ?? true ? presentationTags(section) : "";
  const preserveHeaders = mode.preserveHeadersAndFooters ?? true;
  documentXml = documentXml.replace(
    /<w:sectPr\b[\s\S]*?<\/w:sectPr>/g,
    (generatedSection) => {
      let rewritten = generatedSection;
      if (mode.preservePageLayout ?? true) {
        rewritten = removePresentationTags(rewritten);
      }
      if (preserveHeaders) {
        rewritten = rewritten.replace(
          /<w:(?:headerReference|footerReference)\b[^>]*\/?\s*>/g,
          "",
        );
      }
      const additions = `${rewrittenHeaderFooterReferences.join("")}${layout}`;
      return rewritten.replace(/^(<w:sectPr\b[^>]*>)/, `$1${additions}`);
    },
  );

  return { documentXml, relationshipsXml, contentTypesXml };
}

async function importSingletonPresentationPart(
  relationSuffix: "theme" | "fontTable",
  outputZip: JSZip,
  outputRelationshipsXml: string,
  outputContentTypesXml: string,
  reference: LoadedReferenceDocx,
  signal?: AbortSignal,
): Promise<{ relationshipsXml: string; contentTypesXml: string }> {
  const referenceRelationship = parseRelationships(
    reference.documentRelationshipsXml,
    "word/_rels/document.xml.rels",
  ).find((relationship) => relationship.type.endsWith(`/${relationSuffix}`));
  if (!referenceRelationship || referenceRelationship.targetMode) {
    return {
      relationshipsXml: outputRelationshipsXml,
      contentTypesXml: outputContentTypesXml,
    };
  }
  const sourcePart = resolvePartTarget(
    "word/document.xml",
    referenceRelationship.target,
  );
  const imported = new Map<string, string>();
  const destination = await importReferencePartGraph(
    outputZip,
    reference,
    sourcePart,
    imported,
    relationSuffix === "fontTable" ? new Set(["font"]) : new Set(),
    signal,
  );

  let relationshipsXml = outputRelationshipsXml;
  const outputRelationships = parseRelationships(
    relationshipsXml,
    "word/_rels/document.xml.rels",
  );
  const existing = outputRelationships.find((relationship) =>
    relationship.type.endsWith(`/${relationSuffix}`),
  );
  const relation: Relationship = {
    id: existing?.id ?? nextRelationshipId(outputRelationships),
    type: referenceRelationship.type,
    target: relativeTarget("word/document.xml", destination),
    xml: "",
  };
  relationshipsXml = replaceOrAddRelationship(relationshipsXml, relation, existing);

  let contentTypesXml = addDefaultContentTypes(
    outputContentTypesXml,
    reference.contentTypesXml,
  );
  const referenceTypes = parseContentTypes(reference.contentTypesXml);
  for (const [source, importedDestination] of imported) {
    const contentType = contentTypeForPart(referenceTypes, source);
    if (contentType) {
      contentTypesXml = addContentType(
        contentTypesXml,
        importedDestination,
        contentType,
      );
    }
  }
  return { relationshipsXml, contentTypesXml };
}

export async function applyReferenceDocxPresentation(
  generatedDocx: ArrayBuffer,
  reference: LoadedReferenceDocx,
  mode: ReferenceDocxModeOptions = {},
  signal?: AbortSignal,
): Promise<Uint8Array> {
  try {
    throwIfReferenceAborted(signal);
    const outputZip = await JSZip.loadAsync(generatedDocx);
    let documentXml = await readXml(outputZip, "word/document.xml");
    const generatedStylesXml = await readXml(outputZip, "word/styles.xml");
    const generatedNumberingXml = await readXml(outputZip, "word/numbering.xml");
    let relationshipsXml = await readXml(
      outputZip,
      "word/_rels/document.xml.rels",
    );
    let contentTypesXml = await readXml(outputZip, "[Content_Types].xml");
    await yieldToAbortSignal(signal);

    const referenceStyles = parseStyles(reference.stylesXml);
    const styleMap = resolveStyleMap(referenceStyles, mode);
    const numbering = remapReferenceNumbering(
      generatedNumberingXml,
      reference.numberingXml,
    );
    const remappedReferenceStyles = rewriteStyleNumbering(
      reference.stylesXml,
      numbering.numIdMap,
    );
    const stylesXml = mergeStyles(remappedReferenceStyles, generatedStylesXml);
    documentXml = applyStyleMapToDocument(documentXml, styleMap);

    const sectionResult = await adoptSectionPresentation(
      documentXml,
      outputZip,
      relationshipsXml,
      contentTypesXml,
      reference,
      mode,
      signal,
    );
    documentXml = sectionResult.documentXml;
    relationshipsXml = sectionResult.relationshipsXml;
    contentTypesXml = sectionResult.contentTypesXml;

    for (const relationSuffix of ["theme", "fontTable"] as const) {
      const imported = await importSingletonPresentationPart(
        relationSuffix,
        outputZip,
        relationshipsXml,
        contentTypesXml,
        reference,
        signal,
      );
      relationshipsXml = imported.relationshipsXml;
      contentTypesXml = imported.contentTypesXml;
    }

    outputZip.file("word/document.xml", documentXml);
    outputZip.file("word/styles.xml", stylesXml);
    outputZip.file("word/numbering.xml", numbering.xml);
    outputZip.file("word/_rels/document.xml.rels", relationshipsXml);
    outputZip.file("[Content_Types].xml", contentTypesXml);

    throwIfReferenceAborted(signal);
    const output = await outputZip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    throwIfReferenceAborted(signal);
    return output;
  } catch (error) {
    if (error instanceof MarkdownConversionError) throw error;
    throw referenceError(
      "Failed to generate DOCX from reference presentation",
      "INVALID_PACKAGE",
      { originalError: error },
    );
  }
}
