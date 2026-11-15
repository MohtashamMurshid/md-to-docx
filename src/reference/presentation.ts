import type JSZip from "jszip";
import { renumberProcessWideIds } from "../packageRepairs.js";
import type { ReferenceDocxModeOptions } from "../types.js";
import {
  RELATIONSHIP_NS,
  assertSafeXml,
  encodeXml,
  getAttribute,
  readXml,
  referenceError,
  replaceAttribute,
  throwIfReferenceAborted,
  unsafeEntryReason,
  type LoadedReferenceDocx,
} from "./packageXml.js";

/**
 * Reference presentation import: the generated package's parts as the stages
 * rewrite them, and the stages that bring in the reference's headers,
 * footers, section layout, theme and font table.
 */

const DOCUMENT_RELS = "word/_rels/document.xml.rels";
const EMPTY_NUMBERING_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:numbering>';

interface PresentationInput {
  outputZip: JSZip;
  reference: LoadedReferenceDocx;
  mode: ReferenceDocxModeOptions;
  signal: AbortSignal | undefined;
}

/** The generated package's rewritten parts, threaded through every presentation stage. */
export interface ReferencePresentationState extends PresentationInput {
  /** The generated package had no numbering part, so one must be registered. */
  hasGeneratedNumbering: boolean;
  documentXml: string;
  /** Generated styles, then merged with the reference's. */
  stylesXml: string;
  /** Generated numbering (or an empty part), then merged with the reference's. */
  numberingXml: string;
  relationshipsXml: string;
  contentTypesXml: string;
}

/** Read the generated parts every later stage rewrites. */
export async function readGeneratedParts(
  input: PresentationInput,
): Promise<ReferencePresentationState> {
  const { outputZip } = input;
  const documentXml = await readXml(outputZip, "word/document.xml");
  const stylesXml = await readXml(outputZip, "word/styles.xml");
  const hasGeneratedNumbering = Boolean(outputZip.file("word/numbering.xml"));
  const numberingXml = hasGeneratedNumbering
    ? await readXml(outputZip, "word/numbering.xml")
    : EMPTY_NUMBERING_XML;
  const relationshipsXml = await readXml(outputZip, DOCUMENT_RELS);
  const contentTypesXml = await readXml(outputZip, "[Content_Types].xml");
  return {
    ...input,
    hasGeneratedNumbering,
    documentXml,
    stylesXml,
    numberingXml,
    relationshipsXml,
    contentTypesXml,
  };
}

/** A numbering part created for the reference's lists needs a relationship and a content type. */
export function ensureNumberingRelationship(
  state: ReferencePresentationState,
): void {
  if (state.hasGeneratedNumbering) return;
  const outputRelationships = parseRelationships(
    state.relationshipsXml,
    DOCUMENT_RELS,
  );
  const existingNumberingRelationship = outputRelationships.find(
    (relationship) => relationship.type.endsWith("/numbering"),
  );
  state.relationshipsXml = replaceOrAddRelationship(
    state.relationshipsXml,
    {
      id:
        existingNumberingRelationship?.id ??
        nextRelationshipId(outputRelationships),
      type: `${RELATIONSHIP_NS}numbering`,
      target: "numbering.xml",
      xml: "",
    },
    existingNumberingRelationship,
  );
  state.contentTypesXml = addContentType(
    state.contentTypesXml,
    "word/numbering.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
  );
}

/** Header and footer imports for the reference's final section. */
interface SectionImport {
  section: string;
  outputRelationships: Relationship[];
  referenceRelationships: Relationship[];
  /** Source part to destination, for every part this section pulled in. */
  imported: Map<string, string>;
  /** Header and footer references rewritten to the output's relationship IDs. */
  references: string[];
}

/**
 * Give every generated section the reference's final-section headers,
 * footers and page layout, as `mode` allows.
 */
export async function adoptSectionPresentation(
  state: ReferencePresentationState,
): Promise<void> {
  const section = state.reference.finalSectionProperties;
  if (!section) return;

  state.contentTypesXml = addDefaultContentTypes(
    state.contentTypesXml,
    state.reference.contentTypesXml,
  );
  const sectionImport: SectionImport = {
    section,
    outputRelationships: parseRelationships(
      state.relationshipsXml,
      DOCUMENT_RELS,
    ),
    referenceRelationships: parseRelationships(
      state.reference.documentRelationshipsXml,
      DOCUMENT_RELS,
    ),
    imported: new Map(),
    references: [],
  };
  if (state.mode.preserveHeadersAndFooters ?? true)
    await importHeadersAndFooters(state, sectionImport);
  registerImportedContentTypes(state, sectionImport.imported);
  state.documentXml = rewriteGeneratedSections(
    state,
    section,
    sectionImport.references,
  );
}

async function importHeadersAndFooters(
  state: ReferencePresentationState,
  sectionImport: SectionImport,
): Promise<void> {
  const references = Array.from(
    sectionImport.section.matchAll(
      /<w:(headerReference|footerReference)\b[^>]*\/?\s*>/g,
    ),
    (match) => ({ kind: match[1], xml: match[0] }),
  );
  for (const referenceElement of references)
    await importHeaderOrFooter(state, sectionImport, referenceElement);
}

async function importHeaderOrFooter(
  state: ReferencePresentationState,
  sectionImport: SectionImport,
  referenceElement: { kind: string | undefined; xml: string },
): Promise<void> {
  const referenceId = getAttribute(referenceElement.xml, "r:id");
  const relationship = sectionImport.referenceRelationships.find(
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
    partGraph(state, sectionImport.imported, new Set(["image"])),
    sourcePart,
  );
  const id = nextRelationshipId(sectionImport.outputRelationships);
  const importedRelationship: Relationship = {
    id,
    type: relationship.type,
    target: relativeTarget("word/document.xml", destination),
    xml: "",
  };
  state.relationshipsXml = replaceOrAddRelationship(
    state.relationshipsXml,
    importedRelationship,
  );
  sectionImport.outputRelationships.push(importedRelationship);
  sectionImport.references.push(
    replaceAttribute(referenceElement.xml, "r:id", id),
  );
}

function rewriteGeneratedSections(
  state: ReferencePresentationState,
  section: string,
  headerFooterReferences: string[],
): string {
  const { mode } = state;
  const layout =
    mode.preservePageLayout ?? true ? presentationTags(section) : "";
  const preserveHeaders = mode.preserveHeadersAndFooters ?? true;
  return state.documentXml.replace(
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
      const additions = `${headerFooterReferences.join("")}${layout}`;
      return rewritten.replace(/^(<w:sectPr\b[^>]*>)/, `$1${additions}`);
    },
  );
}

/** Import the reference's theme and font table, replacing the generated ones. */
export async function importSingletonPresentationParts(
  state: ReferencePresentationState,
): Promise<void> {
  for (const relationSuffix of ["theme", "fontTable"] as const)
    await importSingletonPresentationPart(state, relationSuffix);
}

async function importSingletonPresentationPart(
  state: ReferencePresentationState,
  relationSuffix: "theme" | "fontTable",
): Promise<void> {
  const referenceRelationship = parseRelationships(
    state.reference.documentRelationshipsXml,
    DOCUMENT_RELS,
  ).find((relationship) => relationship.type.endsWith(`/${relationSuffix}`));
  if (!referenceRelationship || referenceRelationship.targetMode) return;
  const sourcePart = resolvePartTarget(
    "word/document.xml",
    referenceRelationship.target,
  );
  const imported = new Map<string, string>();
  const destination = await importReferencePartGraph(
    partGraph(
      state,
      imported,
      relationSuffix === "fontTable" ? new Set(["font"]) : new Set<string>(),
    ),
    sourcePart,
  );

  const outputRelationships = parseRelationships(
    state.relationshipsXml,
    DOCUMENT_RELS,
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
  state.relationshipsXml = replaceOrAddRelationship(
    state.relationshipsXml,
    relation,
    existing,
  );
  state.contentTypesXml = addDefaultContentTypes(
    state.contentTypesXml,
    state.reference.contentTypesXml,
  );
  registerImportedContentTypes(state, imported);
}

/** Give each imported part the content type the reference declared for it. */
function registerImportedContentTypes(
  state: ReferencePresentationState,
  imported: Map<string, string>,
): void {
  const referenceTypes = parseContentTypes(state.reference.contentTypesXml);
  for (const [source, destination] of imported) {
    const contentType = contentTypeForPart(referenceTypes, source);
    if (contentType) {
      state.contentTypesXml = addContentType(
        state.contentTypesXml,
        destination,
        contentType,
      );
    }
  }
}

/** Write the rewritten parts back and make process-wide IDs unique across the package. */
export async function writePresentationParts(
  state: ReferencePresentationState,
): Promise<void> {
  const { outputZip } = state;
  outputZip.file("word/document.xml", state.documentXml);
  outputZip.file("word/styles.xml", state.stylesXml);
  outputZip.file("word/numbering.xml", state.numberingXml);
  outputZip.file(DOCUMENT_RELS, state.relationshipsXml);
  outputZip.file("[Content_Types].xml", state.contentTypesXml);
  // Imported headers, footers and nested parts keep the reference's own
  // drawing and bookmark IDs; renumber across the whole package so none
  // collides with the generated body's.
  await renumberProcessWideIds(outputZip);
}

/** One walk over a reference part and everything its relationships reach. */
interface PartGraphImport {
  outputZip: JSZip;
  reference: LoadedReferenceDocx;
  /** Source part to destination, so a part reached twice is copied once. */
  imported: Map<string, string>;
  /** Relationship type suffixes an imported part may point at internally. */
  allowedInternalTypes: Set<string>;
  signal: AbortSignal | undefined;
}

function partGraph(
  state: ReferencePresentationState,
  imported: Map<string, string>,
  allowedInternalTypes: Set<string>,
): PartGraphImport {
  return {
    outputZip: state.outputZip,
    reference: state.reference,
    imported,
    allowedInternalTypes,
    signal: state.signal,
  };
}

/**
 * Copy `sourcePart` under `word/reference-package/`, with its relationships
 * and every part they reach. Each part is checked for a safe path, safe XML,
 * a declared content type and allowed relationship types before it lands.
 */
async function importReferencePartGraph(
  graph: PartGraphImport,
  sourcePart: string,
): Promise<string> {
  const existing = graph.imported.get(sourcePart);
  if (existing) return existing;
  if (unsafeEntryReason(sourcePart) || !graph.reference.zip.file(sourcePart)) {
    throw referenceError(
      `Reference relationship target is missing or unsafe: ${sourcePart}`,
      "MISSING_PACKAGE_PART",
      { entry: sourcePart },
    );
  }

  const destination = `word/reference-package/${sourcePart}`;
  graph.imported.set(sourcePart, destination);
  await copyReferencePart(graph, sourcePart, destination);
  assertDeclaredContentType(graph.reference, sourcePart);
  await importPartRelationships(graph, sourcePart, destination);
  return destination;
}

async function copyReferencePart(
  graph: PartGraphImport,
  sourcePart: string,
  destination: string,
): Promise<void> {
  const sourceFile = graph.reference.zip.file(sourcePart);
  const bytes = await sourceFile!.async("uint8array");
  throwIfReferenceAborted(graph.signal);
  if (sourcePart.toLowerCase().endsWith(".xml")) {
    assertSafeXml(new TextDecoder().decode(bytes), sourcePart);
  }
  graph.outputZip.file(destination, bytes);
}

function assertDeclaredContentType(
  reference: LoadedReferenceDocx,
  sourcePart: string,
): void {
  const referenceTypes = parseContentTypes(reference.contentTypesXml);
  if (!contentTypeForPart(referenceTypes, sourcePart)) {
    throw referenceError(
      `Reference package has no content type for ${sourcePart}`,
      "INVALID_PACKAGE",
      { entry: sourcePart },
    );
  }
}

async function importPartRelationships(
  graph: PartGraphImport,
  sourcePart: string,
  destination: string,
): Promise<void> {
  const relsPath = relationshipPartPath(sourcePart);
  if (!graph.reference.zip.file(relsPath)) return;
  const relsXml = await readXml(graph.reference.zip, relsPath);
  const relationships = parseRelationships(relsXml, relsPath);
  for (const relationship of relationships) {
    if (isExternalHyperlink(relationship, relsPath)) continue;
    assertAllowedInternalType(graph, relationship, relsPath);
    const targetPart = resolvePartTarget(sourcePart, relationship.target);
    await importReferencePartGraph(graph, targetPart);
  }
  graph.outputZip.file(relationshipPartPath(destination), relsXml);
}

/** External hyperlinks are kept as-is; any other external relationship is refused. */
function isExternalHyperlink(
  relationship: Relationship,
  relsPath: string,
): boolean {
  if (relationship.targetMode?.toLowerCase() !== "external") return false;
  if (relationship.type.slice(RELATIONSHIP_NS.length) !== "hyperlink") {
    throw referenceError(
      `Unsupported external reference relationship type: ${relationship.type}`,
      "UNSUPPORTED_RELATIONSHIP",
      { entry: relsPath, relationshipType: relationship.type },
    );
  }
  return true;
}

function assertAllowedInternalType(
  graph: PartGraphImport,
  relationship: Relationship,
  relsPath: string,
): void {
  if (!graph.allowedInternalTypes.has(relationship.type.slice(RELATIONSHIP_NS.length))) {
    throw referenceError(
      `Unsupported reference relationship type: ${relationship.type}`,
      "UNSUPPORTED_RELATIONSHIP",
      { entry: relsPath, relationshipType: relationship.type },
    );
  }
}

/** Section-property children that carry page layout rather than content. */
const SECTION_PRESENTATION_TAGS = [
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

function sectionTagPattern(tag: string, flags?: string): RegExp {
  return new RegExp(
    `<w:${tag}\\b(?:[^>]*\\/>|[^>]*>[\\s\\S]*?<\\/w:${tag}>)`,
    flags,
  );
}

function presentationTags(sectionProperties: string): string {
  return SECTION_PRESENTATION_TAGS.map(
    (name) => sectionProperties.match(sectionTagPattern(name))?.[0] ?? "",
  ).join("");
}

function removePresentationTags(sectionProperties: string): string {
  let rewritten = sectionProperties;
  for (const tag of SECTION_PRESENTATION_TAGS) {
    rewritten = rewritten.replace(sectionTagPattern(tag, "g"), "");
  }
  return rewritten;
}

interface Relationship {
  id: string;
  type: string;
  target: string;
  targetMode?: string | undefined;
  xml: string;
}

interface ContentTypes {
  defaults: Map<string, string>;
  overrides: Map<string, string>;
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
