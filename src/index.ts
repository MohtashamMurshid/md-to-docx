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
  ReferenceDocxInput,
  SectionConfig,
  Style,
} from "./types.js";
import type { DocxBlockNode, DocxDocumentModel } from "./docxModel.js";
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
import { buildParagraphStyles } from "./documentStyles.js";
import {
  enforceElementLimit,
  enforceInputLength,
  throwIfAborted,
  yieldToAbortSignal,
} from "./processingLimits.js";

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

export {
  CalloutStyle,
  CalloutType,
  CodeHighlightOptions,
  CodeHighlightTheme,
  DataUrlImageHandlingOptions,
  DocumentSection,
  HeaderFooterContent,
  HeaderFooterGroup,
  ImageHandlingOptions,
  MarkdownDocxPatch,
  Options,
  PatchMarkdownOptions,
  ReferenceDocxInput,
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
    const blob = await Packer.toBlob(doc);
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

    const normalizedStyle = normalizeStyleInput(options.style);
    const style: Style = { ...defaultStyle, ...normalizedStyle };

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

    for (const section of resolvedSections) {
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
        paragraphStyles: buildParagraphStyles(style),
      },
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
    let elementCount = 0;

    for (const [placeholder, patch] of Object.entries(patches)) {
      throwIfAborted(options.signal);
      await yieldToAbortSignal(options.signal);

      const normalizedPatch = normalizeMarkdownPatch(patch);
      const normalizedStyle = normalizeStyleInput({
        ...(options.style || {}),
        ...(normalizedPatch.style || {}),
      });
      const style: Style = { ...defaultStyle, ...normalizedStyle };
      const renderOptions: Options = {
        documentType: options.documentType || defaultOptions.documentType,
        style,
        textReplacements: options.textReplacements,
        textReplacementMode: options.textReplacementMode,
        codeHighlighting: options.codeHighlighting,
        imageHandling: options.imageHandling,
        maxInputLength: options.maxInputLength,
        maxElements: options.maxElements,
        signal: options.signal,
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
          validateModel: (model) =>
            assertPatchCompatibleModel(model, placeholder),
        }
      );
      elementCount = rendered.elementCount;

      docxPatches[placeholder] = {
        type: PatchType.DOCUMENT,
        children: rendered.content.children as FileChild[],
      };
    }

    const patched = await patchDocument({
      outputType,
      data: referenceDocx,
      patches: docxPatches,
      keepOriginalStyles: options.keepOriginalStyles ?? true,
      placeholderDelimiters: options.placeholderDelimiters,
      recursive: options.recursive ?? true,
    });

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
    validateModel?: (model: DocxDocumentModel) => void;
  } = {}
): Promise<{ content: RenderedMarkdownContent; elementCount: number }> {
  const ast = await parseMarkdownToAst(markdown);
  await yieldToAbortSignal(options.signal);

  if (options.textReplacements && options.textReplacements.length > 0) {
    applyTextReplacements(
      ast,
      options.textReplacements,
      options.textReplacementMode
    );
  }

  throwIfAborted(options.signal);
  const elementCount = enforceElementLimit(
    ast,
    options.maxElements,
    renderOptions.currentElementCount ?? 0,
    options.signal
  );

  const model = mdastToDocxModel(ast, style, options);
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
  });

  return { content, elementCount };
}

function assertPatchCompatibleModel(
  model: DocxDocumentModel,
  placeholder: string
): void {
  if (model.footnotes && model.footnotes.length > 0) {
    throw new MarkdownConversionError(
      "Patch markdown does not support footnotes yet",
      { placeholder }
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
