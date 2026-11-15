import type JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { MarkdownConversionError } from "../errors.js";
import type {
  ReferenceDocxErrorCode,
  ReferenceDocxErrorContext,
  SectionPageConfig,
} from "../types.js";

/** Errors, abort checks and safe XML access shared by the reference DOCX modules. */

export const RELATIONSHIP_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

export interface LoadedReferenceDocx {
  zip: JSZip;
  contentTypesXml: string;
  documentXml: string;
  documentRelationshipsXml: string;
  stylesXml: string;
  numberingXml?: string | undefined;
  finalSectionProperties?: string | undefined;
  page?: SectionPageConfig | undefined;
}

/**
 * Error details as callers pass them: optional fields may be present with an
 * `undefined` value (e.g. a missing selector), and that shape is preserved.
 */
type ReferenceErrorContext = {
  [K in keyof ReferenceDocxErrorContext]: undefined extends ReferenceDocxErrorContext[K]
    ? ReferenceDocxErrorContext[K] | undefined
    : ReferenceDocxErrorContext[K];
};

export function referenceError(
  message: string,
  code: ReferenceDocxErrorCode,
  details: Omit<ReferenceErrorContext, "phase" | "code"> = {},
): MarkdownConversionError {
  return new MarkdownConversionError(message, {
    phase: "reference-docx",
    code,
    ...details,
  } satisfies ReferenceErrorContext);
}

export function throwIfReferenceAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw referenceError("Reference DOCX generation was aborted", "ABORTED", {
      originalError: signal.reason,
    });
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function encodeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function getAttribute(xml: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`(?:\\s|<)${escapedName}\\s*=\\s*(["'])(.*?)\\1`),
  );
  return match ? decodeXml(match[2]!) : undefined;
}

export function replaceAttribute(
  xml: string,
  name: string,
  value: string,
): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(${escapedName}\\s*=\\s*)(["'])(.*?)\\2`);
  if (pattern.test(xml)) {
    return xml.replace(pattern, `$1"${encodeXml(value)}"`);
  }
  return xml.replace(/\s*\/>$/, ` ${name}="${encodeXml(value)}"/>`);
}

export function assertSafeXml(xml: string, entry: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw referenceError(
      `Reference DOCX XML part ${entry} contains a prohibited DTD or entity declaration`,
      "MALFORMED_XML",
      { entry },
    );
  }
  try {
    const document = new DOMParser({
      onError(level, message) {
        if (level !== "warning") throw new Error(message);
      },
    }).parseFromString(xml, "application/xml");
    if (
      !document.documentElement ||
      document.getElementsByTagName("parsererror").length > 0
    ) {
      throw new Error("XML parser did not produce a well-formed document");
    }
  } catch (error) {
    throw referenceError(
      `Reference DOCX XML part ${entry} is malformed`,
      "MALFORMED_XML",
      { entry, originalError: error },
    );
  }
}

export async function readXml(zip: JSZip, entry: string): Promise<string> {
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

export function unsafeEntryReason(name: string): boolean {
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
