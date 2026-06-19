import {
  Document,
  Paragraph,
  Packer,
  Table,
  AlignmentType,
  LevelFormat,
  IPropertiesOptions,
  ISectionOptions,
} from "docx";
import { Options, SectionConfig, Style } from "./types.js";
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

export { MarkdownConversionError };

export {
  ChartBlockDefinition,
  ChartBlockType,
  ChartDataset,
  ChartRenderer,
  ChartRendererInput,
  ChartRenderingOptions,
  CodeHighlightOptions,
  CodeHighlightTheme,
  DataUrlImageHandlingOptions,
  DocumentSection,
  HeaderFooterContent,
  HeaderFooterGroup,
  ImageHandlingOptions,
  Options,
  RemoteImageHandlingOptions,
  SectionConfig,
  SectionTemplate,
  Style,
  TableData,
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
    const headings: TocHeadingEntry[] = [];
    let maxSequenceId = 0;
    const processedImageCounter = { count: 0 };
    const failedRemoteImageCounter = { count: 0 };
    const headingBookmarkCounter = { count: 0 };
    const tocPlaceholders = new WeakSet<object>();
    let elementCount = 0;

    for (const section of resolvedSections) {
      throwIfAborted(options.signal);
      await yieldToAbortSignal(options.signal);
      const ast = await parseMarkdownToAst(section.markdown);
      await yieldToAbortSignal(options.signal);

      if (options.textReplacements && options.textReplacements.length > 0) {
        applyTextReplacements(ast, options.textReplacements);
      }
      throwIfAborted(options.signal);
      elementCount = enforceElementLimit(
        ast,
        options.maxElements,
        elementCount,
        options.signal
      );

      const model = mdastToDocxModel(ast, section.style, options);
      throwIfAborted(options.signal);
      const renderedModel = await modelToDocx(model, section.style, options, {
        sequenceIdOffset: maxSequenceId,
        processedImageCounter,
        failedRemoteImageCounter,
        headingBookmarkCounter,
        tocPlaceholders,
        tableWidthTwips: getSectionContentWidthTwips(section.config),
      });

      maxSequenceId = Math.max(maxSequenceId, renderedModel.maxSequenceId);
      headings.push(...renderedModel.headings);

      renderedSections.push({
        children:
          renderedModel.children.length > 0
            ? renderedModel.children
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
