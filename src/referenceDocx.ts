import JSZip from "jszip";
import { MarkdownConversionError } from "./errors.js";
import { yieldToAbortSignal } from "./processingLimits.js";
import type {
  Options,
  ReferenceDocxGenerationOptions,
  ReferenceDocxBytes,
  ReferenceDocxModeOptions,
  ReferenceDocxPackageLimits,
  SectionPageConfig,
} from "./types.js";
import {
  getAttribute,
  readXml,
  referenceError,
  throwIfReferenceAborted,
  unsafeEntryReason,
  type LoadedReferenceDocx,
} from "./reference/packageXml.js";
import { applyReferenceStyles } from "./reference/styles.js";
import {
  adoptSectionPresentation,
  ensureNumberingRelationship,
  importSingletonPresentationParts,
  readGeneratedParts,
  writePresentationParts,
} from "./reference/presentation.js";

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


/**
 * Restyle a generated DOCX with a loaded reference's presentation. Each stage
 * reads and updates one `ReferencePresentationState`, in this order.
 */
export async function applyReferenceDocxPresentation(
  generatedDocx: ArrayBuffer,
  reference: LoadedReferenceDocx,
  mode: ReferenceDocxModeOptions = {},
  signal?: AbortSignal,
): Promise<Uint8Array> {
  try {
    throwIfReferenceAborted(signal);
    const outputZip = await JSZip.loadAsync(generatedDocx);
    const state = await readGeneratedParts({
      outputZip,
      reference,
      mode,
      signal,
    });
    await yieldToAbortSignal(signal);

    applyReferenceStyles(state);
    ensureNumberingRelationship(state);
    await adoptSectionPresentation(state);
    await importSingletonPresentationParts(state);
    await writePresentationParts(state);

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
