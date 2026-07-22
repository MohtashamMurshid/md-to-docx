export interface MarkdownConversionErrorContext {
  /** Optional subsystem identifier used by structured conversion errors. */
  phase?: string;
  /** Optional machine-readable error code used by structured conversion errors. */
  code?: string;
  plugin?: string;
  hook?: string;
  language?: string;
  nodeType?: string;
  section?: unknown;
  originalError?: unknown;
  [key: string]: unknown;
}

/**
 * Custom error class for markdown conversion errors
 * @extends Error
 * @param message - The error message
 * @param context - The context of the error
 */
export class MarkdownConversionError extends Error {
  constructor(message: string, public context?: MarkdownConversionErrorContext) {
    super(message);
    this.name = "MarkdownConversionError";
  }
}
