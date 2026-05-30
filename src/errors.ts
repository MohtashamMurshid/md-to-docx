/**
 * Custom error class for markdown conversion errors
 * @extends Error
 * @param message - The error message
 * @param context - The context of the error
 */
export class MarkdownConversionError extends Error {
  constructor(message: string, public context?: unknown) {
    super(message);
    this.name = "MarkdownConversionError";
  }
}
