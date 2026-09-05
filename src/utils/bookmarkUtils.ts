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

function stableBookmarkHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(-7);
}

/**
 * Creates a deterministic Word-safe bookmark for a user supplied caption ID.
 * The hash prevents distinct unsafe IDs from collapsing to the same bookmark.
 */
export function crossReferenceBookmarkId(identifier: string): string {
  const safeIdentifier = sanitizeForBookmarkId(identifier).slice(0, 24);
  return `mdxref_${safeIdentifier}_${stableBookmarkHash(identifier)}`.slice(
    0,
    40,
  );
}

/** GitHub-style heading fragments, including Unicode and duplicate suffixes. */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, "")
    .replace(/\s/g, "-");
}

export interface HeadingAnchorRegistry {
  anchors: Map<string, string>;
  counts: Map<string, number>;
}

export function registerHeading(
  registry: HeadingAnchorRegistry,
  text: string,
  bookmark: string,
): void {
  const base = headingSlug(text);
  let count = registry.counts.get(base) ?? 0;
  let slug = count ? `${base}-${count}` : base;
  while (registry.anchors.has(slug)) slug = `${base}-${++count}`;
  registry.counts.set(base, count + 1);
  registry.anchors.set(slug, bookmark);
}
