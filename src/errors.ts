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
  /**
   * Kept as `unknown` for source compatibility with v2 consumers that attach
   * their own primitive, array, or object context values. Core errors use the
   * exported {@link MarkdownConversionErrorContext} shape internally.
   */
  constructor(message: string, public context?: unknown) {
    super(message);
    this.name = "MarkdownConversionError";
  }
}
