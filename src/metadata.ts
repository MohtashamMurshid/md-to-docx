import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type {
  Document as XmlDocument,
  Element as XmlElement,
} from "@xmldom/xmldom";
import JSZip from "jszip";
import { validateOoxmlText } from "./accessibility.js";
import { MarkdownConversionError } from "./errors.js";
import { throwIfAborted, yieldToAbortSignal } from "./processingLimits.js";
import type { DocumentMetadata } from "./types.js";

const CORE_NS =
  "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
const APP_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
const CUSTOM_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties";
const VT_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes";
const CONTENT_TYPES_NS =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const CUSTOM_FMTID = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";

export const MAX_METADATA_VALUE_LENGTH = 4_096;
export const MAX_METADATA_LANGUAGE_LENGTH = 64;
export const MAX_METADATA_KEYWORDS = 128;
export const MAX_CUSTOM_PROPERTIES = 64;
export const MAX_CUSTOM_PROPERTY_NAME_LENGTH = 255;

type NormalizedMetadata = {
  title?: string;
  subject?: string;
  description?: string;
  creator?: string;
  keywords?: string;
  category?: string;
  company?: string;
  language?: string;
  created?: string;
  modified?: string;
  custom?: Readonly<Record<string, string>>;
};

type MetadataMode = "new" | "patch";
type MetadataOutputType = "blob" | "arraybuffer" | "nodebuffer";

function normalizeTimestamp(value: Date | string, context: string): string {
  if (!(value instanceof Date) && typeof value !== "string") {
    throw new MarkdownConversionError(`${context} must be a Date or ISO date string`, {
      context,
      valueType: typeof value,
    });
  }
  if (
    typeof value === "string" &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    )
  ) {
    throw new MarkdownConversionError(`${context} must be a valid ISO date`, {
      context,
    });
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new MarkdownConversionError(`${context} must be a valid date`, { context });
  }
  return date.toISOString();
}

function normalizeKeywords(
  keywords: string | readonly string[] | undefined,
): string | undefined {
  if (keywords === undefined) return undefined;
  if (typeof keywords === "string") {
    validateOoxmlText(
      keywords,
      "metadata.keywords",
      MAX_METADATA_VALUE_LENGTH,
    );
    return keywords;
  }
  if (!Array.isArray(keywords)) {
    throw new MarkdownConversionError(
      "metadata.keywords must be a string or an array of strings",
      { valueType: typeof keywords },
    );
  }
  if (keywords.length === 0 || keywords.length > MAX_METADATA_KEYWORDS) {
    throw new MarkdownConversionError(
      `metadata.keywords must contain between 1 and ${MAX_METADATA_KEYWORDS} entries`,
      { count: keywords.length, maxCount: MAX_METADATA_KEYWORDS },
    );
  }
  keywords.forEach((keyword, index) =>
    validateOoxmlText(
      keyword,
      `metadata.keywords[${index}]`,
      MAX_METADATA_VALUE_LENGTH,
    ),
  );
  const joined = keywords.join("; ");
  validateOoxmlText(joined, "metadata.keywords", MAX_METADATA_VALUE_LENGTH);
  return joined;
}

function validateCustomProperties(
  custom: Readonly<Record<string, string>> | undefined,
): void {
  if (custom === undefined) return;
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) {
    throw new MarkdownConversionError("metadata.custom must be an object");
  }
  const entries = Object.entries(custom);
  if (entries.length > MAX_CUSTOM_PROPERTIES) {
    throw new MarkdownConversionError(
      `metadata.custom exceeds the maximum of ${MAX_CUSTOM_PROPERTIES} properties`,
      { count: entries.length, maxCount: MAX_CUSTOM_PROPERTIES },
    );
  }
  const names = new Set<string>();
  for (const [name, value] of entries) {
    validateOoxmlText(
      name,
      "metadata.custom property name",
      MAX_CUSTOM_PROPERTY_NAME_LENGTH,
    );
    const normalizedName = name.toLocaleLowerCase("en-US");
    if (names.has(normalizedName)) {
      throw new MarkdownConversionError(
        "metadata.custom property names must be unique ignoring case",
        { name },
      );
    }
    names.add(normalizedName);
    validateOoxmlText(
      value,
      `metadata.custom.${name}`,
      MAX_METADATA_VALUE_LENGTH,
      { allowEmpty: true },
    );
  }
}

export function normalizeDocumentMetadata(
  metadata: DocumentMetadata,
): NormalizedMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new MarkdownConversionError("metadata must be an object");
  }

  const stringFields = [
    "title",
    "subject",
    "description",
    "creator",
    "author",
    "category",
    "company",
  ] as const;
  for (const field of stringFields) {
    if (metadata[field] !== undefined) {
      validateOoxmlText(
        metadata[field],
        `metadata.${field}`,
        MAX_METADATA_VALUE_LENGTH,
      );
    }
  }

  if (metadata.language !== undefined) {
    validateOoxmlText(
      metadata.language,
      "metadata.language",
      MAX_METADATA_LANGUAGE_LENGTH,
    );
    if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(metadata.language)) {
      throw new MarkdownConversionError(
        "metadata.language must be a BCP 47-style language tag",
        { language: metadata.language },
      );
    }
  }

  validateCustomProperties(metadata.custom);

  return {
    title: metadata.title,
    subject: metadata.subject,
    description: metadata.description,
    creator: metadata.creator ?? metadata.author,
    keywords: normalizeKeywords(metadata.keywords),
    category: metadata.category,
    company: metadata.company,
    language: metadata.language,
    created:
      metadata.created === undefined
        ? undefined
        : normalizeTimestamp(metadata.created, "metadata.created"),
    modified:
      metadata.modified === undefined
        ? undefined
        : normalizeTimestamp(metadata.modified, "metadata.modified"),
    custom: metadata.custom,
  };
}

export function validateDocumentMetadata(
  metadata: DocumentMetadata | undefined,
): void {
  if (metadata !== undefined) normalizeDocumentMetadata(metadata);
}

function parseXml(xml: string, path: string): XmlDocument {
  if (/<!DOCTYPE/i.test(xml)) {
    throw new MarkdownConversionError(
      `Invalid DOCX metadata part ${path}: document types are not allowed`,
      { path },
    );
  }
  let document: XmlDocument;
  try {
    document = new DOMParser({
      onError(level, message) {
        if (level !== "warning") throw new Error(message);
      },
    }).parseFromString(xml, "application/xml");
  } catch (error) {
    throw new MarkdownConversionError(`Invalid XML in DOCX metadata part ${path}`, {
      path,
      originalError: error,
    });
  }
  if (!document.documentElement || document.getElementsByTagName("parsererror").length) {
    throw new MarkdownConversionError(`Invalid XML in DOCX metadata part ${path}`, {
      path,
    });
  }
  return document;
}

function rootOf(document: XmlDocument): XmlElement {
  if (!document.documentElement) {
    throw new MarkdownConversionError("Invalid XML document: missing root element");
  }
  return document.documentElement;
}

function serializeXml(document: XmlDocument): string {
  const body = new XMLSerializer()
    .serializeToString(document)
    .replace(/^\s*<\?xml[^?]*\?>\s*/u, "");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
}

function createCoreDocument(): XmlDocument {
  const document = new DOMImplementation().createDocument(
    CORE_NS,
    "cp:coreProperties",
    null,
  );
  const root = rootOf(document);
  root.setAttribute("xmlns:dc", DC_NS);
  root.setAttribute("xmlns:dcterms", DCTERMS_NS);
  root.setAttribute("xmlns:xsi", XSI_NS);
  return document;
}

function createAppDocument(): XmlDocument {
  const document = new DOMImplementation().createDocument(APP_NS, "Properties", null);
  rootOf(document).setAttribute("xmlns:vt", VT_NS);
  return document;
}

function createCustomDocument(): XmlDocument {
  const document = new DOMImplementation().createDocument(
    CUSTOM_NS,
    "Properties",
    null,
  );
  rootOf(document).setAttribute("xmlns:vt", VT_NS);
  return document;
}

function directChildren(root: XmlElement): XmlElement[] {
  const children: XmlElement[] = [];
  for (let index = 0; index < root.childNodes.length; index++) {
    const child = root.childNodes.item(index);
    if (child?.nodeType === 1) children.push(child as XmlElement);
  }
  return children;
}

function replaceElement(
  document: XmlDocument,
  namespace: string,
  qualifiedName: string,
  localName: string,
  value: string | undefined,
  attributes: readonly [string, string, string][] = [],
): void {
  const root = rootOf(document);
  for (const child of directChildren(root)) {
    if (child.namespaceURI === namespace && child.localName === localName) {
      root.removeChild(child);
    }
  }
  if (value === undefined) return;
  const element = document.createElementNS(namespace, qualifiedName);
  for (const [attributeNamespace, name, attributeValue] of attributes) {
    element.setAttributeNS(attributeNamespace, name, attributeValue);
  }
  element.appendChild(document.createTextNode(value));
  root.appendChild(element);
}

async function readXmlPart(
  zip: JSZip,
  path: string,
): Promise<XmlDocument | undefined> {
  const file = zip.file(path);
  return file ? parseXml(await file.async("string"), path) : undefined;
}

function shouldSet(mode: MetadataMode, value: unknown): boolean {
  return mode === "new" || value !== undefined;
}

async function writeCoreProperties(
  zip: JSZip,
  metadata: NormalizedMetadata,
  source: DocumentMetadata,
  mode: MetadataMode,
): Promise<boolean> {
  const coreTouched =
    mode === "new" ||
    source.title !== undefined ||
    source.subject !== undefined ||
    source.description !== undefined ||
    source.creator !== undefined ||
    source.author !== undefined ||
    source.keywords !== undefined ||
    source.category !== undefined ||
    source.language !== undefined ||
    source.created !== undefined ||
    source.modified !== undefined;
  if (!coreTouched) return false;

  const document =
    mode === "patch"
      ? (await readXmlPart(zip, "docProps/core.xml")) ?? createCoreDocument()
      : createCoreDocument();
  const fields = [
    [DC_NS, "dc:title", "title", metadata.title, source.title],
    [DC_NS, "dc:subject", "subject", metadata.subject, source.subject],
    [DC_NS, "dc:description", "description", metadata.description, source.description],
    [DC_NS, "dc:creator", "creator", metadata.creator, source.creator ?? source.author],
    [CORE_NS, "cp:keywords", "keywords", metadata.keywords, source.keywords],
    [CORE_NS, "cp:category", "category", metadata.category, source.category],
    [DC_NS, "dc:language", "language", metadata.language, source.language],
  ] as const;
  for (const [namespace, name, localName, value, sourceValue] of fields) {
    if (shouldSet(mode, sourceValue)) {
      replaceElement(document, namespace, name, localName, value);
    }
  }
  if (shouldSet(mode, source.created)) {
    replaceElement(document, DCTERMS_NS, "dcterms:created", "created", metadata.created, [
      [XSI_NS, "xsi:type", "dcterms:W3CDTF"],
    ]);
  }
  if (shouldSet(mode, source.modified)) {
    replaceElement(
      document,
      DCTERMS_NS,
      "dcterms:modified",
      "modified",
      metadata.modified,
      [[XSI_NS, "xsi:type", "dcterms:W3CDTF"]],
    );
  }
  zip.file("docProps/core.xml", serializeXml(document));
  return true;
}

async function writeAppProperties(
  zip: JSZip,
  metadata: NormalizedMetadata,
  source: DocumentMetadata,
): Promise<boolean> {
  if (source.company === undefined) return false;
  const document =
    (await readXmlPart(zip, "docProps/app.xml")) ?? createAppDocument();
  replaceElement(document, APP_NS, "Company", "Company", metadata.company);
  zip.file("docProps/app.xml", serializeXml(document));
  return true;
}

function customPropertyName(element: XmlElement): string {
  return element.getAttribute("name") ?? "";
}

async function writeCustomProperties(
  zip: JSZip,
  metadata: NormalizedMetadata,
  source: DocumentMetadata,
  mode: MetadataMode,
): Promise<boolean> {
  if (mode === "patch" && source.custom === undefined) return false;
  if (mode === "new" && source.custom === undefined) return false;

  const document =
    mode === "patch"
      ? (await readXmlPart(zip, "docProps/custom.xml")) ?? createCustomDocument()
      : createCustomDocument();
  const root = rootOf(document);
  const incoming = new Map(
    Object.entries(metadata.custom ?? {}).map(([name, value]) => [
      name.toLocaleLowerCase("en-US"),
      { name, value },
    ]),
  );
  let maxPid = 1;
  for (const child of directChildren(root)) {
    if (child.localName !== "property") continue;
    const pid = Number.parseInt(child.getAttribute("pid") ?? "", 10);
    if (Number.isFinite(pid)) maxPid = Math.max(maxPid, pid);
    if (incoming.has(customPropertyName(child).toLocaleLowerCase("en-US"))) {
      root.removeChild(child);
    }
  }
  for (const { name, value } of incoming.values()) {
    const property = document.createElementNS(CUSTOM_NS, "property");
    property.setAttribute("fmtid", CUSTOM_FMTID);
    property.setAttribute("pid", String(++maxPid));
    property.setAttribute("name", name);
    const propertyValue = document.createElementNS(VT_NS, "vt:lpwstr");
    propertyValue.appendChild(document.createTextNode(value));
    property.appendChild(propertyValue);
    root.appendChild(property);
  }
  zip.file("docProps/custom.xml", serializeXml(document));
  return true;
}

async function ensureContentType(
  zip: JSZip,
  partName: string,
  contentType: string,
): Promise<void> {
  const document =
    (await readXmlPart(zip, "[Content_Types].xml")) ??
    new DOMImplementation().createDocument(CONTENT_TYPES_NS, "Types", null);
  const root = rootOf(document);
  const exists = directChildren(root).some(
    (child) => child.localName === "Override" && child.getAttribute("PartName") === partName,
  );
  if (!exists) {
    const override = document.createElementNS(CONTENT_TYPES_NS, "Override");
    override.setAttribute("PartName", partName);
    override.setAttribute("ContentType", contentType);
    root.appendChild(override);
    zip.file("[Content_Types].xml", serializeXml(document));
  }
}

async function ensureRelationship(
  zip: JSZip,
  target: string,
  type: string,
): Promise<void> {
  const path = "_rels/.rels";
  const document =
    (await readXmlPart(zip, path)) ??
    new DOMImplementation().createDocument(RELATIONSHIPS_NS, "Relationships", null);
  const root = rootOf(document);
  const relationships = directChildren(root);
  if (relationships.some((child) => child.getAttribute("Type") === type)) return;
  const ids = new Set(relationships.map((child) => child.getAttribute("Id")));
  let index = 1;
  while (ids.has(`rId${index}`)) index++;
  const relationship = document.createElementNS(RELATIONSHIPS_NS, "Relationship");
  relationship.setAttribute("Id", `rId${index}`);
  relationship.setAttribute("Type", type);
  relationship.setAttribute("Target", target);
  root.appendChild(relationship);
  zip.file(path, serializeXml(document));
}

async function ensurePackagePartRegistration(
  zip: JSZip,
  kind: "core" | "app" | "custom",
): Promise<void> {
  const values = {
    core: {
      part: "/docProps/core.xml",
      target: "docProps/core.xml",
      contentType: "application/vnd.openxmlformats-package.core-properties+xml",
      relationship:
        "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
    },
    app: {
      part: "/docProps/app.xml",
      target: "docProps/app.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.extended-properties+xml",
      relationship:
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
    },
    custom: {
      part: "/docProps/custom.xml",
      target: "docProps/custom.xml",
      contentType:
        "application/vnd.openxmlformats-officedocument.custom-properties+xml",
      relationship:
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties",
    },
  }[kind];
  await ensureContentType(zip, values.part, values.contentType);
  await ensureRelationship(zip, values.target, values.relationship);
}

export async function applyDocumentMetadata(
  data: Blob | ArrayBuffer | Buffer,
  source: DocumentMetadata,
  mode: MetadataMode,
  outputType: MetadataOutputType,
  signal?: AbortSignal,
): Promise<Blob | ArrayBuffer | Buffer> {
  throwIfAborted(signal);
  const metadata = normalizeDocumentMetadata(source);
  const zipInput =
    typeof Blob !== "undefined" && data instanceof Blob
      ? await data.arrayBuffer()
      : data;
  const zip = await JSZip.loadAsync(zipInput);
  await yieldToAbortSignal(signal);

  const coreWritten = await writeCoreProperties(zip, metadata, source, mode);
  const appWritten = await writeAppProperties(zip, metadata, source);
  const customWritten = await writeCustomProperties(zip, metadata, source, mode);
  if (coreWritten) await ensurePackagePartRegistration(zip, "core");
  if (appWritten) await ensurePackagePartRegistration(zip, "app");
  if (customWritten) await ensurePackagePartRegistration(zip, "custom");

  throwIfAborted(signal);
  const options = { compression: "DEFLATE" as const };
  let output: Blob | ArrayBuffer | Buffer;
  if (outputType === "blob") {
    output = await zip.generateAsync({ ...options, type: "blob" });
  } else if (outputType === "arraybuffer") {
    output = await zip.generateAsync({ ...options, type: "arraybuffer" });
  } else {
    output = await zip.generateAsync({ ...options, type: "nodebuffer" });
  }
  await yieldToAbortSignal(signal);
  return output;
}
