/**
 * Sanitize text for use as a Word bookmark ID.
 * Bookmarks must start with a letter or underscore, contain only
 * alphanumerics/underscores, and are truncated to keep Word happy.
 */
export function sanitizeForBookmarkId(text: string): string {
  let sanitized = text.replace(/[^a-zA-Z0-9_\s]/g, "").replace(/\s+/g, "_");
  if (!/^[a-zA-Z_]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  return sanitized.substring(0, 40);
}
