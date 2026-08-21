import {
  Document,
  FileChild,
  Paragraph,
  Packer,
  PatchType,
  Table,
  AlignmentType,
  LevelFormat,
  IPropertiesOptions,
  ISectionOptions,
  patchDocument,
} from "docx";
import {
  MarkdownDocxPatch,
  Options,
  PatchMarkdownOptions,
  ReferenceDocxBytes,
  ReferenceDocxInput,
  ReferenceDocxGenerationOptions,
  SectionConfig,
  Style,
} from "./types.js";
import type { DocxBlockNode, DocxDocumentModel } from "./docxModel.js";
import type { Root } from "mdast";
import { parseMarkdownToAst, applyTextReplacements } from "./markdownAst.js";
import { mdastToDocxModel } from "./mdastToDocxModel.js";
import { modelToDocx } from "./modelToDocx.js";
import { MarkdownConversionError } from "./errors.js";
import { validateInput } from "./validation.js";
import {
  buildFooters,
  buildHeaders,
  buildSectionProperties,
  getSectionContentWidthTwips,
  normalizeStyleInput,
  resolveSections,
} from "./sectionBuilder.js";
import {
  buildTocContent,
  replaceTocPlaceholders,
  TocHeadingEntry,
} from "./tocBuilder.js";
import { buildDefaultStyles } from "./documentStyles.js";
import {
  enforceElementLimit,
  enforceInputLength,
  throwIfAborted,
  yieldToAbortSignal,
} from "./processingLimits.js";
import {
  buildCrossReferenceRegistry,
  containsCaptionOrCrossReferenceSyntax,
} from "./crossReferences.js";
import type { CrossReferenceRegistry } from "./crossReferences.js";
import {
  applyReferenceDocxPresentation,
  buildReferenceConversionOptions,
  loadReferenceDocx,
} from "./referenceDocx.js";
import { PluginRuntime } from "./pluginRuntime.js";
import type { PluginSectionContext } from "./pluginTypes.js";
import {
  applyDocumentMetadata,
  normalizeDocumentMetadata,
  validateDocumentMetadata,
} from "./metadata.js";
import { validateAccessibilityOptions } from "./accessibility.js";

const defaultStyle: Style = {
  titleSize: 32,
  headingSpacing: 240,
  paragraphSpacing: 240,
  lineSpacing: 1.15,
  paragraphAlignment: "LEFT",
  direction: "LTR",
};

const defaultOptions: Options = {
  documentType: "document",
  style: defaultStyle,
};

type RenderedMarkdownContent = {
  children: (Paragraph | Table)[];
  headings: TocHeadingEntry[];
  maxSequenceId: number;
  footnotes: Record<string, { children: Paragraph[] }>;
};

export { MarkdownConversionError };
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
  SectionTemplate,
  Style,
  TableData,
  TextReplacement,
  TextReplacementFunction,
  TextReplacementFunctionResult,
  TextReplacementMode,
  TocOptions,
} from "./types.js";

export {
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
  options: Options = defaultOptions
): Promise<Blob> {
  try {
    const docxOptions = await parseToDocxOptions(markdown, options);
    await yieldToAbortSignal(options.signal);
    const doc = new Document(docxOptions);
    let blob = await Packer.toBlob(doc);
    if (options.metadata) {
      blob = (await applyDocumentMetadata(
        blob,
        options.metadata,
        "new",
        "blob",
        options.signal,
      )) as Blob;
    }
    await yieldToAbortSignal(options.signal);
    return blob;
  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }
    throw new MarkdownConversionError(
      `Failed to convert markdown to docx: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { originalError: error }
    );
  }
}

export async function convertMarkdownToArrayBuffer(
  markdown: string,
  options: Options = defaultOptions
): Promise<ArrayBuffer> {
  const blob = await convertMarkdownToDocx(markdown, options);
  return blob.arrayBuffer();
}

export async function convertMarkdownToBuffer(
  markdown: string,
  options: Options = defaultOptions
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
  const bytes = await convertMarkdownWithReferenceDocxBytes(
    markdown,
    referenceDocx,
    options,
  );
  // Copy into a concrete ArrayBuffer so this remains a valid BlobPart even when
  // upstream bytes are typed as Uint8Array<ArrayBufferLike>.
  const blobBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(blobBuffer).set(bytes);
  return new Blob([blobBuffer], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
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
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
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
  try {
    const reference = await loadReferenceDocx(
      referenceDocx,
      options.reference,
      options.signal,
    );
    const conversionOptions = buildReferenceConversionOptions(options, reference);
    const generated = await convertMarkdownToArrayBuffer(
      markdown,
      conversionOptions,
    );
    return applyReferenceDocxPresentation(
      generated,
      reference,
      options.reference,
      options.signal,
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
  options: PatchMarkdownOptions = {}
): Promise<Blob> {
  return patchMarkdownInDocxWithOutput(
    referenceDocx,
    patches,
    "blob",
    options
  );
}

export async function patchMarkdownInDocxToArrayBuffer(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  options: PatchMarkdownOptions = {}
): Promise<ArrayBuffer> {
  return patchMarkdownInDocxWithOutput(
    referenceDocx,
    patches,
    "arraybuffer",
    options
  );
}

export async function patchMarkdownInDocxToBuffer(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  options: PatchMarkdownOptions = {}
): Promise<Buffer> {
  return patchMarkdownInDocxWithOutput(
    referenceDocx,
    patches,
    "nodebuffer",
    options
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
  options: Options = defaultOptions
): Promise<IPropertiesOptions> {
  try {
    validateInput(markdown, options);
    throwIfAborted(options.signal);
    enforceInputLength(markdown, options);

    const normalizedMetadata = options.metadata
      ? normalizeDocumentMetadata(options.metadata)
      : undefined;
    const normalizedStyle = normalizeStyleInput(options.style);
    const style: Style = {
      ...defaultStyle,
      ...(normalizedMetadata?.language
        ? { language: normalizedMetadata.language }
        : {}),
      ...normalizedStyle,
    };

    const resolvedSections = resolveSections(markdown, options, style);
    const renderedSections: {
      children: (Paragraph | Table)[];
      style: Style;
      config: SectionConfig;
    }[] = [];
    const footnotes: Record<string, { children: Paragraph[] }> = {};
    const headings: TocHeadingEntry[] = [];
    let maxSequenceId = 0;
    let maxFootnoteId = 0;
    const processedImageCounter = { count: 0 };
    const failedRemoteImageCounter = { count: 0 };
    const headingBookmarkCounter = { count: 0 };
    const tocPlaceholders = new WeakSet<object>();
    let elementCount = 0;
    const pluginRuntime = await PluginRuntime.create({
      options,
      sectionCount: resolvedSections.length,
    });
    const preparedAsts: Root[] = [];
    for (const [sectionIndex, section] of resolvedSections.entries()) {
      preparedAsts.push(
        await prepareMarkdownAst(section.markdown, section.style, options, {
          pluginRuntime,
          pluginSection: {
            index: sectionIndex,
            count: resolvedSections.length,
            kind: "section",
            contentWidthTwips: getSectionContentWidthTwips(section.config),
          },
        }),
      );
    }
    const crossReferences = buildCrossReferenceRegistry(
      preparedAsts,
      options.captions,
    );

    for (const [sectionIndex, section] of resolvedSections.entries()) {
      throwIfAborted(options.signal);
      await yieldToAbortSignal(options.signal);
      const rendered = await renderMarkdownContent(
        section.markdown,
        section.style,
        options,
        {
          currentElementCount: elementCount,
          sequenceIdOffset: maxSequenceId,
          processedImageCounter,
          failedRemoteImageCounter,
          headingBookmarkCounter,
          tocPlaceholders,
          tableWidthTwips: getSectionContentWidthTwips(section.config),
          footnoteIdOffset: maxFootnoteId,
          preparedAst: preparedAsts[sectionIndex],
          crossReferences,
          pluginRuntime,
          pluginSection: {
            index: sectionIndex,
            count: resolvedSections.length,
            kind: "section",
            contentWidthTwips: getSectionContentWidthTwips(section.config),
          },
        }
      );
      elementCount = rendered.elementCount;

      maxSequenceId = Math.max(maxSequenceId, rendered.content.maxSequenceId);
      for (const [id, footnote] of Object.entries(rendered.content.footnotes)) {
        footnotes[id] = footnote;
        maxFootnoteId = Math.max(maxFootnoteId, Number(id));
      }
      headings.push(...rendered.content.headings);

      renderedSections.push({
        children:
          rendered.content.children.length > 0
            ? rendered.content.children
            : [new Paragraph({})],
        style: section.style,
        config: section.config,
      });
    }

    throwIfAborted(options.signal);
    const tocContent = buildTocContent(headings, style, options.toc);
    let tocInserted = false;
    const docSections: ISectionOptions[] = renderedSections.map((section) => {
      throwIfAborted(options.signal);
      const replacedTocChildren = replaceTocPlaceholders(
        section.children,
        tocContent,
        tocInserted,
        tocPlaceholders
      );
      tocInserted = replacedTocChildren.tocInserted;

      const headers = buildHeaders(section.config.headers, section.style);
      const footers = buildFooters(section.config, section.style);

      return {
        properties: buildSectionProperties(section.config),
        ...(headers ? { headers } : {}),
        ...(footers ? { footers } : {}),
        children: replacedTocChildren.children,
      };
    });

    throwIfAborted(options.signal);
    const numberingConfigs = [];
    for (let i = 1; i <= maxSequenceId; i++) {
      throwIfAborted(options.signal);
      numberingConfigs.push({
        reference: `numbered-list-${i}`,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720, hanging: 260 },
              },
            },
          },
        ],
      });
    }

    throwIfAborted(options.signal);
    return {
      numbering: {
        config: numberingConfigs,
      },
      sections: docSections,
      ...(Object.keys(footnotes).length > 0 ? { footnotes } : {}),
      styles: {
        default: buildDefaultStyles(style),
      },
      ...(crossReferences &&
      crossReferences.definitions.size > 0 &&
      options.captions?.updateFieldsOnOpen !== false
        ? { features: { updateFields: true } }
        : {}),
      ...(normalizedMetadata
        ? {
            title: normalizedMetadata.title,
            subject: normalizedMetadata.subject,
            description: normalizedMetadata.description,
            creator: normalizedMetadata.creator,
            keywords: normalizedMetadata.keywords,
            customProperties: Object.entries(normalizedMetadata.custom ?? {}).map(
              ([name, value]) => ({ name, value }),
            ),
          }
        : {}),
    };
  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }
    throw new MarkdownConversionError(
      `Failed to convert markdown to docx: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { originalError: error }
    );
  }
}

async function patchMarkdownInDocxWithOutput(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  outputType: "blob",
  options?: PatchMarkdownOptions
): Promise<Blob>;
async function patchMarkdownInDocxWithOutput(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  outputType: "arraybuffer",
  options?: PatchMarkdownOptions
): Promise<ArrayBuffer>;
async function patchMarkdownInDocxWithOutput(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  outputType: "nodebuffer",
  options?: PatchMarkdownOptions
): Promise<Buffer>;
async function patchMarkdownInDocxWithOutput(
  referenceDocx: ReferenceDocxInput,
  patches: Record<string, MarkdownDocxPatch>,
  outputType: "blob" | "arraybuffer" | "nodebuffer",
  options: PatchMarkdownOptions = {}
): Promise<Blob | ArrayBuffer | Buffer> {
  try {
    validatePatchInputs(patches, options);
    throwIfAborted(options.signal);

    const docxPatches: Record<
      string,
      { type: typeof PatchType.DOCUMENT; children: readonly FileChild[] }
    > = {};
    const processedImageCounter = { count: 0 };
    const failedRemoteImageCounter = { count: 0 };
    const headingBookmarkCounter = { count: 0 };
    const metadata = options.metadata
      ? normalizeDocumentMetadata(options.metadata)
      : undefined;
    let elementCount = 0;
    const patchEntries = Object.entries(patches);
    const pluginRuntime = await PluginRuntime.create({
      options: {
        ...options,
        style: normalizeStyleInput(options.style),
      },
      sectionCount: patchEntries.length,
    });

    for (const [patchIndex, [placeholder, patch]] of patchEntries.entries()) {
      throwIfAborted(options.signal);
      await yieldToAbortSignal(options.signal);

      const normalizedPatch = normalizeMarkdownPatch(patch);
      const normalizedStyle = normalizeStyleInput({
        ...(options.style || {}),
        ...(normalizedPatch.style || {}),
      });
      const style: Style = {
        ...defaultStyle,
        ...(metadata?.language ? { language: metadata.language } : {}),
        ...normalizedStyle,
      };
      const renderOptions: Options = {
        documentType: options.documentType || defaultOptions.documentType,
        style,
        textReplacements: options.textReplacements,
        textReplacementMode: options.textReplacementMode,
        mathRendering: options.mathRendering,
        mermaidRendering: options.mermaidRendering,
        chartRendering: options.chartRendering,
        codeHighlighting: options.codeHighlighting,
        imageHandling: options.imageHandling,
        metadata: options.metadata,
        accessibility: options.accessibility,
        maxInputLength: options.maxInputLength,
        maxElements: options.maxElements,
        signal: options.signal,
        plugins: options.plugins,
        pluginOptions: options.pluginOptions,
      };

      validateInput(normalizedPatch.markdown, renderOptions);
      enforceInputLength(normalizedPatch.markdown, renderOptions);

      const rendered = await renderMarkdownContent(
        normalizedPatch.markdown,
        style,
        renderOptions,
        {
          currentElementCount: elementCount,
          processedImageCounter,
          failedRemoteImageCounter,
          headingBookmarkCounter,
          tableWidthTwips: options.tableWidthTwips,
          pluginRuntime,
          pluginSection: {
            index: patchIndex,
            count: patchEntries.length,
            kind: "patch",
            placeholder,
            contentWidthTwips: options.tableWidthTwips ?? 9746,
          },
          validateModel: (model) =>
            assertPatchCompatibleModel(model, placeholder),
          validateAst: (ast) => assertPatchCompatibleAst(ast, placeholder),
        }
      );
      elementCount = rendered.elementCount;

      docxPatches[placeholder] = {
        type: PatchType.DOCUMENT,
        children: rendered.content.children as FileChild[],
      };
    }

    let patched = await patchDocument({
      outputType,
      data: referenceDocx,
      patches: docxPatches,
      keepOriginalStyles: options.keepOriginalStyles ?? true,
      placeholderDelimiters: options.placeholderDelimiters,
      recursive: options.recursive ?? true,
    });

    if (options.metadata) {
      patched = await applyDocumentMetadata(
        patched,
        options.metadata,
        "patch",
        outputType,
        options.signal,
      ) as typeof patched;
    }

    await yieldToAbortSignal(options.signal);
    return patched;
  } catch (error) {
    if (error instanceof MarkdownConversionError) {
      throw error;
    }
    throw new MarkdownConversionError(
      `Failed to patch docx with markdown: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      { originalError: error }
    );
  }
}

function validatePatchInputs(
  patches: Record<string, MarkdownDocxPatch>,
  options: PatchMarkdownOptions
): void {
  validateDocumentMetadata(options.metadata);
  validateAccessibilityOptions(options.accessibility);
  if (!patches || typeof patches !== "object" || Array.isArray(patches)) {
    throw new MarkdownConversionError(
      "Invalid patches: Must be an object keyed by placeholder name"
    );
  }

  const entries = Object.entries(patches);
  if (entries.length === 0) {
    throw new MarkdownConversionError(
      "Invalid patches: At least one placeholder patch is required"
    );
  }

  for (const [placeholder, patch] of entries) {
    if (placeholder.trim().length === 0) {
      throw new MarkdownConversionError(
        "Invalid patch placeholder: Must be a non-empty string",
        { placeholder }
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
      "Invalid placeholderDelimiters: start and end must be non-empty strings"
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
      { tableWidthTwips: options.tableWidthTwips }
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

  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new MarkdownConversionError(
      "Invalid patch: Must be a markdown string or patch object"
    );
  }

  if (typeof patch.markdown !== "string") {
    throw new MarkdownConversionError(
      "Invalid patch markdown: Must be a string"
    );
  }

  return patch;
}

async function renderMarkdownContent(
  markdown: string,
  style: Style,
  options: Options,
  renderOptions: {
    currentElementCount?: number;
    sequenceIdOffset?: number;
    processedImageCounter?: { count: number };
    failedRemoteImageCounter?: { count: number };
    headingBookmarkCounter?: { count: number };
    tocPlaceholders?: WeakSet<object>;
    tableWidthTwips?: number;
    footnoteIdOffset?: number;
    pluginRuntime?: PluginRuntime;
    pluginSection?: PluginSectionContext;
    validateModel?: (model: DocxDocumentModel) => void;
    validateAst?: (ast: Root) => void;
    crossReferences?: CrossReferenceRegistry;
    preparedAst?: Root;
  } = {}
): Promise<{ content: RenderedMarkdownContent; elementCount: number }> {
  const ast =
    renderOptions.preparedAst ??
    (await prepareMarkdownAst(markdown, style, options, renderOptions));

  renderOptions.validateAst?.(ast);

  throwIfAborted(options.signal);
  const elementCount = enforceElementLimit(
    ast,
    options.maxElements,
    renderOptions.currentElementCount ?? 0,
    options.signal
  );
  const pluginElementCounter = { count: elementCount };

  const model = mdastToDocxModel(
    ast,
    style,
    options,
    renderOptions.crossReferences,
    renderOptions.pluginRuntime,
  );
  renderOptions.validateModel?.(model);
  throwIfAborted(options.signal);

  const content = await modelToDocx(model, style, options, {
    sequenceIdOffset: renderOptions.sequenceIdOffset,
    processedImageCounter: renderOptions.processedImageCounter,
    failedRemoteImageCounter: renderOptions.failedRemoteImageCounter,
    headingBookmarkCounter: renderOptions.headingBookmarkCounter,
    tocPlaceholders: renderOptions.tocPlaceholders,
    tableWidthTwips: renderOptions.tableWidthTwips,
    footnoteIdOffset: renderOptions.footnoteIdOffset,
    pluginRuntime: renderOptions.pluginRuntime,
    pluginSection: renderOptions.pluginSection,
    pluginElementCounter,
    maxElements: options.maxElements,
  });

  return { content, elementCount: pluginElementCounter.count };
}

async function prepareMarkdownAst(
  markdown: string,
  style: Style,
  options: Options,
  renderOptions: {
    pluginRuntime?: PluginRuntime;
    pluginSection?: PluginSectionContext;
  } = {},
): Promise<Root> {
  throwIfAborted(options.signal);
  let ast = await parseMarkdownToAst(
    markdown,
    options.mathRendering?.enabled !== false,
  );
  await yieldToAbortSignal(options.signal);
  if (options.textReplacements && options.textReplacements.length > 0) {
    applyTextReplacements(
      ast,
      options.textReplacements,
      options.textReplacementMode,
    );
  }
  if (renderOptions.pluginRuntime && renderOptions.pluginSection) {
    ast = await renderOptions.pluginRuntime.transformAst(
      ast,
      style,
      renderOptions.pluginSection,
      options.signal,
    );
  }
  return ast;
}

function assertPatchCompatibleAst(ast: Root, placeholder: string): void {
  if (containsCaptionOrCrossReferenceSyntax(ast)) {
    throw new MarkdownConversionError(
      "Patch markdown does not support captions or cross-references yet",
      { placeholder },
    );
  }
}

function assertPatchCompatibleModel(
  model: DocxDocumentModel,
  placeholder: string
): void {
  if (model.footnotes && model.footnotes.length > 0) {
    throw new MarkdownConversionError(
      "Patch markdown does not support footnotes yet",
      { placeholder },
    );
  }

  const stack: DocxBlockNode[] = [...model.children];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }

    if (node.type === "list" && node.ordered) {
      throw new MarkdownConversionError(
        "Patch markdown does not support ordered lists yet",
        { placeholder }
      );
    }

    if (node.type === "tocPlaceholder") {
      throw new MarkdownConversionError(
        "Patch markdown does not support generated tables of contents yet",
        { placeholder }
      );
    }

    if (node.type === "comment") {
      throw new MarkdownConversionError(
        "Patch markdown does not support Word comments yet",
        { placeholder }
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
  filename: string = "document.docx"
): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("This function can only be used in browser environments");
  }
  if (!(blob instanceof Blob)) {
    throw new Error("Invalid blob provided");
  }
  if (!filename || typeof filename !== "string") {
    throw new Error("Invalid filename provided");
  }

  try {
    const { default: saveAs } = await import("file-saver");
    saveAs(blob, filename);
  } catch (error) {
    throw new Error(
      `Failed to save file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
