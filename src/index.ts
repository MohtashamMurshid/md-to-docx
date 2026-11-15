import { packDocumentWithRepairs } from "./packageRepairs.js";
import { loadPatchPackage, mergePatchPackage } from "./patchPackage.js";
import { Paragraph, Table, IPropertiesOptions, ISectionOptions } from "docx";
import {
  MarkdownDocxPatch,
  Options,
  PatchMarkdownOptions,
  ReferenceDocxBytes,
  ReferenceDocxInput,
  ReferenceDocxGenerationOptions,
  SectionConfig,
  HeaderFooterContent,
  HeaderFooterSlot,
  Style,
} from "./types.js";
import type { DocxBlockNode, DocxDocumentModel } from "./docxModel.js";
import type { Root } from "mdast";
import { MarkdownConversionError } from "./errors.js";
import { validateInput } from "./validation.js";
import {
  buildFooters,
  buildHeaders,
  buildSectionProperties,
  getSectionContentWidthTwips,
  normalizeStyleInput,
  resolveSections,
  ResolvedSectionInput,
} from "./sectionBuilder.js";
import {
  buildTocContent,
  loadTocPageNumberEstimator,
  prefillPackagePageNumbers,
  prefillsTocPageNumbers,
  replaceTocPlaceholders,
  tocUpdatesFieldsOnOpen,
} from "./tocBuilder.js";
import { buildDefaultStyles } from "./documentStyles.js";
import {
  enforceInputLength,
  throwIfAborted,
  yieldToAbortSignal,
} from "./processingLimits.js";
import { buildCrossReferenceRegistry } from "./crossReferences.js";
import type { CrossReferenceRegistry } from "./crossReferences.js";
import {
  applyReferenceDocxPresentation,
  buildReferenceConversionOptions,
  loadReferenceDocx,
} from "./referenceDocx.js";
import { PluginRuntime } from "./pluginRuntime.js";
import type { PluginSectionContext } from "./pluginTypes.js";
import {
  applyDocumentMetadataWithOptions,
  normalizeDocumentMetadata,
  validateDocumentMetadata,
} from "./metadata.js";
import { validateAccessibilityOptions } from "./accessibility.js";
import {
  RenderSession,
  createRenderSession,
  mergeRenderedContent,
  numberedListConfig,
  prepareMarkdownAst,
  renderMarkdownContent,
  sessionRenderOptions,
} from "./renderSession.js";

const defaultStyle: Style = {
  titleSize: 32,
  headingSpacing: 240,
  paragraphSpacing: 240,
  lineSpacing: 1.15,
  paragraphAlignment: "LEFT",
  direction: "LTR",
};

const defaultOptions = {
  documentType: "document",
  style: defaultStyle,
} satisfies Options;

/** Content width used for patch entries when the caller gives none. */
const DEFAULT_PATCH_WIDTH_TWIPS = 9746;

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Passes conversion errors through and wraps anything else, so callers see
 * one error type with the original kept as `originalError`.
 */
function conversionFailure(
  error: unknown,
  prefix: string,
): MarkdownConversionError {
  if (error instanceof MarkdownConversionError) {
    return error;
  }
  return new MarkdownConversionError(
    `${prefix}: ${error instanceof Error ? error.message : "Unknown error"}`,
    { originalError: error },
  );
}

function definedCoreProperties(
  metadata: ReturnType<typeof normalizeDocumentMetadata>,
): Pick<
  IPropertiesOptions,
  "title" | "subject" | "description" | "creator" | "keywords"
> {
  const { title, subject, description, creator, keywords } = metadata;
  return {
    ...(title !== undefined ? { title } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(creator !== undefined ? { creator } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
  };
}

/** Core and custom document properties; docx skips falsy core properties. */
function metadataProperties(
  metadata: ReturnType<typeof normalizeDocumentMetadata> | undefined,
): Partial<IPropertiesOptions> {
  if (!metadata) {
    return {};
  }
  return {
    ...definedCoreProperties(metadata),
    customProperties: Object.entries(metadata.custom ?? {}).map(
      ([name, value]) => ({ name, value }),
    ),
  };
}

/** Defaults, then the metadata language, then the caller's style. */
function documentStyle(
  styleInput: Partial<Style> | undefined,
  metadataLanguage: string | undefined,
): Style {
  return {
    ...defaultStyle,
    ...(metadataLanguage ? { language: metadataLanguage } : {}),
    ...normalizeStyleInput(styleInput),
  };
}

/** Header/footer slots keyed by channel, iterable with Object.values. */
type HeaderFooterSlotRecord = Partial<
  Record<"default" | "first" | "even", HeaderFooterSlot>
>;

/** A header/footer slot that carries Markdown to render. */
type MarkdownSlot = HeaderFooterContent & { markdown: string };

function isMarkdownSlot(slot: HeaderFooterSlot | undefined): slot is MarkdownSlot {
  return Boolean(slot?.markdown);
}

/** Header slots, then footer slots, that carry Markdown, in channel order. */
function markdownSlots(config: SectionConfig): MarkdownSlot[] {
  return [config.headers, config.footers]
    .flatMap((group) => {
      const slots: HeaderFooterSlotRecord = group ?? {};
      return Object.values(slots);
    })
    .filter(isMarkdownSlot);
}

interface RenderedSection {
  children: (Paragraph | Table)[];
  style: Style;
  config: SectionConfig;
  rich?: Map<HeaderFooterSlot, (Paragraph | Table)[]>;
}

/** What every chunk of one conversion renders against. */
interface ConversionPipeline {
  options: Options;
  session: RenderSession;
  pluginRuntime: PluginRuntime | undefined;
  crossReferences: CrossReferenceRegistry;
}

function sectionPluginContext(
  index: number,
  count: number,
  config: SectionConfig,
): PluginSectionContext {
  return {
    index,
    count,
    kind: "section",
    contentWidthTwips: getSectionContentWidthTwips(config),
  };
}

function patchPluginContext(
  index: number,
  count: number,
  placeholder: string,
  options: PatchMarkdownOptions,
): PluginSectionContext {
  return {
    index,
    count,
    kind: "patch",
    placeholder,
    contentWidthTwips: options.tableWidthTwips ?? DEFAULT_PATCH_WIDTH_TWIPS,
  };
}

export { MarkdownConversionError };
export type { RichTableCell, RichTableDefinition } from "./richTables.js";
export type { ConversionWarning, ImageAsset } from "./types.js";
export type { MarkdownConversionErrorContext } from "./errors.js";

export {
  CalloutStyle,
  CalloutType,
  CaptionFailureMode,
  CaptionOptions,
  CaptionPlacement,
  ChartBlockDefinition,
  ChartBlockType,
  ChartDataset,
  ChartRenderer,
  ChartRendererInput,
  ChartRenderingOptions,
  AccessibilityOptions,
  CodeHighlightOptions,
  CodeHighlightTheme,
  DataUrlImageHandlingOptions,
  DocumentSection,
  DocumentMetadata,
  HeaderFooterContent,
  HeaderFooterGroup,
  ImageHandlingOptions,
  MissingImageAltTextBehavior,
  MarkdownDocxPatch,
  MathRenderingOptions,
  MermaidRenderInput,
  MermaidRenderResult,
  MermaidRenderingOptions,
  Options,
  PatchMarkdownOptions,
  ReferenceDocxErrorCode,
  ReferenceDocxErrorContext,
  ReferenceDocxBytes,
  ReferenceDocxGenerationOptions,
  ReferenceDocxInput,
  ReferenceDocxModeOptions,
  ReferenceDocxPackageLimits,
  ReferenceDocxStyleMap,
  ReferenceDocxStyleRole,
  ReferenceDocxStyleSelector,
  RemoteImageHandlingOptions,
  SectionConfig,
  HeaderFooterSlot,
  SectionTemplate,
  Style,
  TableData,
  TextReplacement,
  TextReplacementFunction,
  TextReplacementFunctionResult,
  TextReplacementMode,
  TocOptions,
  TocTabLeader,
} from "./types.js";

export {
  AnyMarkdownDocxPlugin,
  MarkdownDocxPlugin,
  MarkdownDocxPluginApiVersion,
  PluginAstTransformContext,
  PluginBlockNodeHandler,
  PluginBlockNodeInput,
  PluginBlockResult,
  PluginChildrenResult,
  PluginCodeBlockResult,
  PluginConflictPolicy,
  PluginFailureMode,
  PluginFenceHandler,
  PluginFenceInput,
  PluginHeadingResult,
  PluginImageResult,
  PluginInlineContent,
  PluginInlineText,
  PluginOptions,
  PluginParagraphResult,
  PluginRenderContext,
  PluginRenderResult,
  PluginResolvedImageOptions,
  PluginResolvedOptions,
  PluginResourceContext,
  PluginSectionContext,
  PluginSetupContext,
  PluginSkipResult,
  PluginTableResult,
} from "./pluginTypes.js";

/**
 * Convert Markdown to Docx file
 * @param markdown - The Markdown string to convert
 * @param options - The options for the conversion
 * @returns A Promise that resolves to a Blob containing the Docx file
 * @throws {MarkdownConversionError} If conversion fails
 */
export async function convertMarkdownToDocx(
  markdown: string,
  options: Options = defaultOptions,
): Promise<Blob> {
  try {
    const docxOptions = await parseToDocxOptions(markdown, options);
    await yieldToAbortSignal(options.signal);
    let blob = await packDocumentWithRepairs(docxOptions);
    if (options.metadata) {
      blob = (await applyDocumentMetadataWithOptions(blob, options.metadata, {
        mode: "new",
        outputType: "blob",
        signal: options.signal,
      })) as Blob;
    }
    await yieldToAbortSignal(options.signal);
    return blob;
  } catch (error) {
    throw conversionFailure(error, "Failed to convert markdown to docx");
  }
}

export async function convertMarkdownToArrayBuffer(
  markdown: string,
  options: Options = defaultOptions,
): Promise<ArrayBuffer> {
  const blob = await convertMarkdownToDocx(markdown, options);
  return blob.arrayBuffer();
}

export async function convertMarkdownToBuffer(
  markdown: string,
  options: Options = defaultOptions,
): Promise<Buffer> {
  return Buffer.from(await convertMarkdownToArrayBuffer(markdown, options));
}

/**
 * Generate a brand-new DOCX from Markdown while adopting presentation from a
 * reference DOCX. Unlike patchMarkdownInDocx, reference body content and
 * placeholders are never copied.
 */
export async function convertMarkdownWithReferenceDocx(
  markdown: string,
  referenceDocx: ReferenceDocxBytes,
  options: ReferenceDocxGenerationOptions = {},
): Promise<Blob> {
  const bytes = await convertMarkdownWithReferenceDocxToArrayBuffer(
    markdown,
    referenceDocx,
    options,
  );
  return new Blob([bytes], { type: DOCX_MIME_TYPE });
}

export async function convertMarkdownWithReferenceDocxToArrayBuffer(
  markdown: string,
  referenceDocx: ReferenceDocxBytes,
  options: ReferenceDocxGenerationOptions = {},
): Promise<ArrayBuffer> {
  const bytes = await convertMarkdownWithReferenceDocxBytes(
    markdown,
    referenceDocx,
    options,
  );
  // A copy of exactly this view, typed as a plain ArrayBuffer.
  return new Uint8Array(bytes).buffer;
}

export async function convertMarkdownWithReferenceDocxToBuffer(
  markdown: string,
  referenceDocx: ReferenceDocxBytes,
  options: ReferenceDocxGenerationOptions = {},
): Promise<Buffer> {
  return Buffer.from(
    await convertMarkdownWithReferenceDocxToArrayBuffer(
      markdown,
      referenceDocx,
      options,
    ),
  );
}

async function convertMarkdownWithReferenceDocxBytes(
  markdown: string,
  referenceDocx: ReferenceDocxBytes,
  options: ReferenceDocxGenerationOptions,
): Promise<Uint8Array> {
  let reference: Awaited<ReturnType<typeof loadReferenceDocx>>;
  let generated: ArrayBuffer;
  try {
    reference = await loadReferenceDocx(
      referenceDocx,
      options.reference,
      options.signal,
    );
    const conversionOptions = buildReferenceConversionOptions(
      options,
      reference,
    );
    generated = await convertMarkdownToArrayBuffer(
      markdown,
      conversionOptions,
    );
  } catch (error) {
    if (error instanceof MarkdownConversionError) throw error;
    throw new MarkdownConversionError(
      `Failed to generate DOCX from reference: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      {
        phase: "reference-docx",
        code: "INVALID_PACKAGE",
        originalError: error,
      },
    );
  }
  // Outside the try on purpose: presentation errors propagate unwrapped.
  return applyReferenceDocxPresentation(
    generated,
    reference,
    options.reference,
    options.signal,
  );
}

/**
 * Insert generated Markdown content into an existing DOCX at named placeholders.
 *
 * Placeholders use docx patch syntax by default, e.g. `{{body}}` in the
 * reference document is replaced by the `body` patch entry.
 */
export async function patchMarkdownInDocx(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  options: PatchMarkdownOptions = {},
): Promise<Blob> {
  return patchMarkdownInDocxWithOutput(referenceDocx, patches, "blob", options);
}

export async function patchMarkdownInDocxToArrayBuffer(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  options: PatchMarkdownOptions = {},
): Promise<ArrayBuffer> {
  return patchMarkdownInDocxWithOutput(
    referenceDocx,
    patches,
    "arraybuffer",
    options,
  );
}

export async function patchMarkdownInDocxToBuffer(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  options: PatchMarkdownOptions = {},
): Promise<Buffer> {
  return patchMarkdownInDocxWithOutput(
    referenceDocx,
    patches,
    "nodebuffer",
    options,
  );
}

/**
 * Convert Markdown to Docx options
 * @param markdown - The Markdown string to convert
 * @param options - The options for the conversion
 * @returns A Promise that resolves to Docx options
 * @throws {MarkdownConversionError} If conversion fails
 */
export async function parseToDocxOptions(
  markdown: string,
  options: Options = defaultOptions,
): Promise<IPropertiesOptions> {
  try {
    return await buildDocxOptions(markdown, options);
  } catch (error) {
    throw conversionFailure(error, "Failed to convert markdown to docx");
  }
}

async function buildDocxOptions(
  markdown: string,
  options: Options,
): Promise<IPropertiesOptions> {
  validateInput(markdown, options);
  throwIfAborted(options.signal);
  enforceInputLength(markdown, options);

  const normalizedMetadata = options.metadata
    ? normalizeDocumentMetadata(options.metadata)
    : undefined;
  const style = documentStyle(options.style, normalizedMetadata?.language);
  const resolvedSections = resolveSections(markdown, options, style);
  const session = createRenderSession();
  const pluginRuntime = await PluginRuntime.create({
    options,
    sectionCount: resolvedSections.length,
  });
  const preparedAsts = await prepareSectionAsts(
    resolvedSections,
    options,
    pluginRuntime,
  );
  const crossReferences = buildCrossReferenceRegistry(
    preparedAsts,
    options.captions,
  );
  const pipeline = { options, session, pluginRuntime, crossReferences };

  const renderedSections = await renderSectionBodies(
    resolvedSections,
    preparedAsts,
    pipeline,
  );
  await renderHeaderFooterSlots(renderedSections, resolvedSections, pipeline);

  throwIfAborted(options.signal);
  const { sections, tocInserted } = buildDocSections(renderedSections, pipeline);

  throwIfAborted(options.signal);
  const numberingConfigs = [];
  for (let i = 1; i <= session.totals.maxSequenceId; i++) {
    throwIfAborted(options.signal);
    numberingConfigs.push(
      numberedListConfig(i, session.numberingStarts.get(i) ?? 1),
    );
  }

  throwIfAborted(options.signal);
  const { footnotes } = session.totals;
  return {
    numbering: {
      config: numberingConfigs,
    },
    sections,
    ...(Object.keys(footnotes).length > 0 ? { footnotes } : {}),
    styles: {
      default: buildDefaultStyles(style),
    },
    ...(shouldUpdateFieldsOnOpen(crossReferences, tocInserted, options)
      ? { features: { updateFields: true } }
      : {}),
    ...(await tocPageNumberOptions(tocInserted, options)),
    ...metadataProperties(normalizedMetadata),
  };
}

/** docx's layout pass writes a native TOC's page numbers when asked to. */
async function tocPageNumberOptions(
  tocInserted: boolean,
  options: Options,
): Promise<Pick<IPropertiesOptions, "pageNumbers">> {
  return tocInserted && prefillsTocPageNumbers(options.toc)
    ? { pageNumbers: await loadTocPageNumberEstimator() }
    : {};
}

/** Caption references and a native TOC need Word to refresh fields on open. */
function shouldUpdateFieldsOnOpen(
  crossReferences: CrossReferenceRegistry,
  tocInserted: boolean,
  options: Options,
): boolean {
  const captionFields =
    crossReferences.definitions.size > 0 &&
    options.captions?.updateFieldsOnOpen !== false;
  return captionFields || (tocInserted && tocUpdatesFieldsOnOpen(options.toc));
}

async function prepareSectionAsts(
  resolvedSections: ResolvedSectionInput[],
  options: Options,
  pluginRuntime: PluginRuntime | undefined,
): Promise<Root[]> {
  const preparedAsts: Root[] = [];
  for (const [sectionIndex, section] of resolvedSections.entries()) {
    preparedAsts.push(
      await prepareMarkdownAst(section.markdown, section.style, options, {
        pluginRuntime,
        pluginSection: sectionPluginContext(
          sectionIndex,
          resolvedSections.length,
          section.config,
        ),
      }),
    );
  }
  return preparedAsts;
}

async function renderSectionBodies(
  resolvedSections: ResolvedSectionInput[],
  preparedAsts: Root[],
  { options, session, pluginRuntime, crossReferences }: ConversionPipeline,
): Promise<RenderedSection[]> {
  const renderedSections: RenderedSection[] = [];
  for (const [sectionIndex, section] of resolvedSections.entries()) {
    throwIfAborted(options.signal);
    await yieldToAbortSignal(options.signal);
    const rendered = await renderMarkdownContent(
      section.markdown,
      section.style,
      options,
      {
        ...sessionRenderOptions(session),
        tocPlaceholders: session.tocPlaceholders,
        tableWidthTwips: getSectionContentWidthTwips(section.config),
        footnoteIdOffset: session.totals.maxFootnoteId,
        preparedAst: preparedAsts[sectionIndex]!,
        crossReferences,
        pluginRuntime,
        pluginSection: sectionPluginContext(
          sectionIndex,
          resolvedSections.length,
          section.config,
        ),
      },
    );
    session.elementCount = rendered.elementCount;

    mergeRenderedContent(session.totals, rendered.content);

    renderedSections.push({
      children:
        rendered.content.children.length > 0
          ? rendered.content.children
          : [new Paragraph({})],
      style: section.style,
      config: section.config,
    });
  }
  return renderedSections;
}

/**
 * Renders rich header/footer slots through the same pipeline and resource
 * counters as body content. Slot Markdown counts toward maxInputLength.
 */
async function renderHeaderFooterSlots(
  renderedSections: RenderedSection[],
  resolvedSections: ResolvedSectionInput[],
  pipeline: ConversionPipeline,
): Promise<void> {
  const inputLength = {
    total: resolvedSections.reduce(
      (n, section) => n + section.markdown.length,
      0,
    ),
  };
  for (const [index, section] of renderedSections.entries()) {
    const rich = new Map<HeaderFooterSlot, (Paragraph | Table)[]>();
    section.rich = rich;
    for (const slot of markdownSlots(section.config)) {
      inputLength.total += slot.markdown.length;
      const { maxInputLength } = pipeline.options;
      if (maxInputLength && inputLength.total > maxInputLength)
        throw new MarkdownConversionError(
          "Markdown input exceeds maxInputLength",
        );
      const sectionContext = sectionPluginContext(
        index,
        renderedSections.length,
        section.config,
      );
      rich.set(slot, await renderSlot(slot, section, sectionContext, pipeline));
    }
  }
}

async function renderSlot(
  slot: MarkdownSlot,
  section: RenderedSection,
  pluginSection: PluginSectionContext,
  { options, session, pluginRuntime }: ConversionPipeline,
): Promise<(Paragraph | Table)[]> {
  const rendered = await renderMarkdownContent(
    slot.markdown,
    {
      ...section.style,
      ...(slot.alignment ? { paragraphAlignment: slot.alignment } : {}),
    },
    options,
    {
      ...sessionRenderOptions(session),
      tableWidthTwips: getSectionContentWidthTwips(section.config),
      pluginRuntime,
      pluginSection,
      validateModel: (model) => {
        if (model.footnotes?.length)
          throw new MarkdownConversionError(
            "Word headers and footers cannot contain footnotes",
          );
      },
    },
  );
  session.elementCount = rendered.elementCount;
  session.totals.maxSequenceId = Math.max(
    session.totals.maxSequenceId,
    rendered.content.maxSequenceId,
  );
  return rendered.content.children;
}

/** docx sections with the TOC placed at the first placeholder only. */
function buildDocSections(
  renderedSections: RenderedSection[],
  { options, session }: ConversionPipeline,
): { sections: ISectionOptions[]; tocInserted: boolean } {
  let tocInserted = false;
  const sections = renderedSections.map((section): ISectionOptions => {
    throwIfAborted(options.signal);
    const tocContent = buildTocContent(
      session.totals.headings,
      section.style,
      options.toc,
      getSectionContentWidthTwips(section.config),
    );
    const replacedTocChildren = replaceTocPlaceholders(
      section.children,
      tocContent,
      tocInserted,
      session.tocPlaceholders,
    );
    tocInserted = replacedTocChildren.tocInserted;

    const headers = buildHeaders(
      section.config.headers,
      section.style,
      section.rich,
    );
    const footers = buildFooters(section.config, section.style, section.rich);

    return {
      properties: buildSectionProperties(section.config),
      ...(headers ? { headers } : {}),
      ...(footers ? { footers } : {}),
      children: replacedTocChildren.children,
    };
  });
  return { sections, tocInserted };
}

async function patchMarkdownInDocxWithOutput(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  outputType: "blob",
  options?: PatchMarkdownOptions,
): Promise<Blob>;
async function patchMarkdownInDocxWithOutput(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  outputType: "arraybuffer",
  options?: PatchMarkdownOptions,
): Promise<ArrayBuffer>;
async function patchMarkdownInDocxWithOutput(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  outputType: "nodebuffer",
  options?: PatchMarkdownOptions,
): Promise<Buffer>;
async function patchMarkdownInDocxWithOutput(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  outputType: PatchOutputType,
  options: PatchMarkdownOptions = {},
): Promise<Blob | ArrayBuffer | Buffer> {
  try {
    return await patchDocx(referenceDocx, patches, outputType, options);
  } catch (error) {
    throw conversionFailure(error, "Failed to patch docx with markdown");
  }
}

type PatchOutputType = "blob" | "arraybuffer" | "nodebuffer";
type PatchEntry = [placeholder: string, patch: MarkdownDocxPatch];

async function patchDocx(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  outputType: PatchOutputType,
  options: PatchMarkdownOptions,
): Promise<Blob | ArrayBuffer | Buffer> {
  validatePatchInputs(patches, options);
  throwIfAborted(options.signal);

  const basePackage = await loadPatchPackage(referenceDocx, options.signal);
  const session = createRenderSession();
  const metadata = options.metadata
    ? normalizeDocumentMetadata(options.metadata)
    : undefined;
  const patchEntries: PatchEntry[] = Object.entries(patches);
  const pluginStyle = normalizeStyleInput(options.style);
  const pluginRuntime = await PluginRuntime.create({
    // A missing style stays as `options` has it.
    options: { ...options, ...(pluginStyle ? { style: pluginStyle } : {}) },
    sectionCount: patchEntries.length,
  });

  const preparedAsts = await preparePatchAsts(
    patchEntries,
    options,
    pluginRuntime,
  );
  const crossReferences = buildCrossReferenceRegistry(
    preparedAsts,
    options.captions,
  );
  const patchContents = await renderPatchBodies(
    patchEntries,
    preparedAsts,
    { options, session, pluginRuntime, crossReferences },
    metadata?.language,
  );

  const { donorBytes, markers } = await buildPatchDonor(
    patchContents,
    session,
    options,
  );
  const merged = await mergePatchPackage(
    basePackage,
    donorBytes,
    { markers, names: patchEntries.map(([name]) => name) },
    options,
  );
  let patched = patchOutput(
    await withPrefilledPageNumbers(merged, options),
    outputType,
  );

  if (options.metadata) {
    patched = await applyDocumentMetadataWithOptions(
      patched,
      options.metadata,
      { mode: "patch", outputType, signal: options.signal },
    );
  }

  await yieldToAbortSignal(options.signal);
  return patched;
}

/** Pre-filled TOC page numbers need a layout pass over the merged package. */
async function withPrefilledPageNumbers(
  merged: Uint8Array,
  options: PatchMarkdownOptions,
): Promise<Uint8Array> {
  if (!prefillsTocPageNumbers(options.toc)) return merged;
  throwIfAborted(options.signal);
  return prefillPackagePageNumbers(merged);
}

function patchOutput(
  merged: Uint8Array,
  outputType: PatchOutputType,
): Blob | ArrayBuffer | Buffer {
  if (outputType === "blob") {
    return new Blob([new Uint8Array(merged)], { type: DOCX_MIME_TYPE });
  }
  return outputType === "nodebuffer"
    ? Buffer.from(merged)
    : new Uint8Array(merged).buffer;
}

async function preparePatchAsts(
  patchEntries: PatchEntry[],
  options: PatchMarkdownOptions,
  pluginRuntime: PluginRuntime | undefined,
): Promise<Root[]> {
  const preparedAsts: Root[] = [];
  for (const [index, [placeholder, patch]] of patchEntries.entries()) {
    const normalized = normalizeMarkdownPatch(patch);
    validateInput(normalized.markdown, {
      ...options,
      style: { ...options.style, ...normalized.style },
    });
    enforceInputLength(normalized.markdown, options);
    preparedAsts.push(
      await prepareMarkdownAst(
        normalized.markdown,
        {
          ...defaultStyle,
          ...normalizeStyleInput(options.style),
          ...normalizeStyleInput(normalized.style),
        },
        options,
        {
          pluginRuntime,
          pluginSection: patchPluginContext(
            index,
            patchEntries.length,
            placeholder,
            options,
          ),
        },
      ),
    );
  }
  return preparedAsts;
}

async function renderPatchBodies(
  patchEntries: PatchEntry[],
  preparedAsts: Root[],
  pipeline: ConversionPipeline & { options: PatchMarkdownOptions },
  metadataLanguage: string | undefined,
): Promise<(Paragraph | Table)[][]> {
  const { options, session, pluginRuntime, crossReferences } = pipeline;
  const patchContents: (Paragraph | Table)[][] = [];
  for (const [patchIndex, [placeholder, patch]] of patchEntries.entries()) {
    throwIfAborted(options.signal);
    await yieldToAbortSignal(options.signal);

    const normalizedPatch = normalizeMarkdownPatch(patch);
    const style = documentStyle(
      { ...(options.style || {}), ...(normalizedPatch.style || {}) },
      metadataLanguage,
    );
    // Other fields come from `...options` unchanged.
    const renderOptions: Options = {
      ...options,
      documentType: options.documentType || defaultOptions.documentType,
      style,
    };

    validateInput(normalizedPatch.markdown, renderOptions);
    enforceInputLength(normalizedPatch.markdown, renderOptions);

    const rendered = await renderMarkdownContent(
      normalizedPatch.markdown,
      style,
      renderOptions,
      {
        ...sessionRenderOptions(session),
        preparedAst: preparedAsts[patchIndex]!,
        crossReferences,
        tocPlaceholders: session.tocPlaceholders,
        footnoteIdOffset: session.totals.maxFootnoteId,
        tableWidthTwips: options.tableWidthTwips,
        pluginRuntime,
        pluginSection: patchPluginContext(
          patchIndex,
          patchEntries.length,
          placeholder,
          options,
        ),
        validateModel: (model) => {
          assertPatchCompatibleModel(model, placeholder);
        },
      },
    );
    session.elementCount = rendered.elementCount;

    patchContents.push(rendered.content.children);
    mergeRenderedContent(session.totals, rendered.content);
  }
  return patchContents;
}

/**
 * Packs the rendered patches into one donor DOCX, each entry preceded by a
 * unique marker paragraph that mergePatchPackage splits on.
 */
async function buildPatchDonor(
  patchContents: (Paragraph | Table)[][],
  session: RenderSession,
  options: PatchMarkdownOptions,
): Promise<{ donorBytes: Uint8Array; markers: string[] }> {
  const toc = buildTocContent(
    session.totals.headings,
    { ...defaultStyle, ...options.style },
    options.toc,
    options.tableWidthTwips,
  );
  let tocInserted = false;
  const markers = patchContents.map(
    (_, index) =>
      `MDPATCH_BOUNDARY_${index}_${Math.random().toString(36).slice(2)}`,
  );
  const body = patchContents.flatMap((children, index) => {
    const replaced = replaceTocPlaceholders(
      children,
      toc,
      tocInserted,
      session.tocPlaceholders,
    );
    tocInserted = replaced.tocInserted;
    // One marker per patch entry, and one content block per patch entry.
    return [new Paragraph({ text: markers[index]! }), ...replaced.children];
  });
  const donor: IPropertiesOptions = {
    sections: [{ children: body.length ? body : [new Paragraph({})] }],
    footnotes: session.totals.footnotes,
    styles: {
      default: buildDefaultStyles({ ...defaultStyle, ...options.style }),
    },
    numbering: {
      config: Array.from(session.numberingStarts, ([id, start]) =>
        numberedListConfig(id, start),
      ),
    },
  };
  const donorBytes = new Uint8Array(
    await (await packDocumentWithRepairs(donor)).arrayBuffer(),
  );
  return { donorBytes, markers };
}

function validatePatchInputs(
  patches: Record<string, MarkdownDocxPatch>,
  options: PatchMarkdownOptions,
): void {
  validateDocumentMetadata(options.metadata);
  validateAccessibilityOptions(options.accessibility);
  // Read as unknown: patches may come from untyped JS or CLI JSON.
  const patchesInput: unknown = patches;
  if (
    !patchesInput ||
    typeof patchesInput !== "object" ||
    Array.isArray(patchesInput)
  ) {
    throw new MarkdownConversionError(
      "Invalid patches: Must be an object keyed by placeholder name",
    );
  }

  const entries = Object.entries(patches);
  if (entries.length === 0) {
    throw new MarkdownConversionError(
      "Invalid patches: At least one placeholder patch is required",
    );
  }

  for (const [placeholder, patch] of entries) {
    if (placeholder.trim().length === 0) {
      throw new MarkdownConversionError(
        "Invalid patch placeholder: Must be a non-empty string",
        { placeholder },
      );
    }

    normalizeMarkdownPatch(patch);
  }

  const delimiters = options.placeholderDelimiters;
  if (
    delimiters &&
    (typeof delimiters.start !== "string" ||
      delimiters.start.trim().length === 0 ||
      typeof delimiters.end !== "string" ||
      delimiters.end.trim().length === 0)
  ) {
    throw new MarkdownConversionError(
      "Invalid placeholderDelimiters: start and end must be non-empty strings",
    );
  }

  if (
    options.tableWidthTwips !== undefined &&
    (!Number.isInteger(options.tableWidthTwips) ||
      !Number.isFinite(options.tableWidthTwips) ||
      options.tableWidthTwips <= 0)
  ) {
    throw new MarkdownConversionError(
      "Invalid tableWidthTwips: Must be a positive integer",
      { tableWidthTwips: options.tableWidthTwips },
    );
  }
}

function normalizeMarkdownPatch(patch: MarkdownDocxPatch): {
  markdown: string;
  style?: Partial<Style>;
} {
  if (typeof patch === "string") {
    return { markdown: patch };
  }

  const patchInput: unknown = patch;
  if (!patchInput || typeof patchInput !== "object" || Array.isArray(patchInput)) {
    throw new MarkdownConversionError(
      "Invalid patch: Must be a markdown string or patch object",
    );
  }

  if (typeof patch.markdown !== "string") {
    throw new MarkdownConversionError(
      "Invalid patch markdown: Must be a string",
    );
  }

  return patch;
}

function assertPatchCompatibleModel(
  model: DocxDocumentModel,
  placeholder: string,
): void {
  const stack: DocxBlockNode[] = [...model.children];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }

    if (node.type === "comment") {
      throw new MarkdownConversionError(
        "Patch markdown does not support Word comments yet",
        { placeholder },
      );
    }

    if (node.type === "list") {
      for (const item of node.children) {
        stack.push(...item.children);
      }
      continue;
    }

    if (node.type === "blockquote") {
      stack.push(...node.children);
    }

    if (node.type === "pluginBlock") {
      stack.push(...node.children);
    }
  }
}

function assertCanDownload(blob: Blob, filename: string): void {
  if (!(blob instanceof Blob)) {
    throw new Error("Invalid blob provided");
  }
  if (!filename || typeof filename !== "string") {
    throw new Error("Invalid filename provided");
  }
}

async function saveWithFileSaver(blob: Blob, filename: string): Promise<void> {
  try {
    const { default: saveAs } = await import("file-saver");
    saveAs(blob, filename);
  } catch (error) {
    throw new Error(
      `Failed to save file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
}

/**
 * Downloads a DOCX file in the browser environment
 * @param blob - The Blob containing the DOCX file data
 * @param filename - The name to save the file as (defaults to "document.docx")
 * @throws {Error} If the function is called outside browser environment
 * @throws {Error} If invalid blob or filename is provided
 * @throws {Error} If file save fails
 */
export async function downloadDocx(
  blob: Blob,
  filename: string = "document.docx",
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("This function can only be used in browser environments");
  }
  assertCanDownload(blob, filename);
  await saveWithFileSaver(blob, filename);
}
