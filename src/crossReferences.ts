import type { Paragraph, PhrasingContent, Root, RootContent } from "mdast";
import { MarkdownConversionError } from "./errors.js";
import type { CaptionOptions } from "./types.js";
import { crossReferenceBookmarkId } from "./utils/bookmarkUtils.js";

export type CaptionKind = "figure" | "table";

export interface CrossReferenceDefinition {
  id: string;
  kind: CaptionKind;
  number: number;
  bookmarkId: string;
}

export interface ResolvedCaption extends CrossReferenceDefinition {
  children: PhrasingContent[];
}

export interface CrossReferenceRegistry {
  definitions: Map<string, CrossReferenceDefinition>;
  captionsByRoot: WeakMap<Root, Map<number, ResolvedCaption>>;
  failureMode: NonNullable<CaptionOptions["failureMode"]>;
  boundDefinitionIds: Set<string>;
}

interface CaptionCandidate {
  id?: string;
  children?: PhrasingContent[];
  error?: string;
}

function isStandaloneImage(node: RootContent): boolean {
  return (
    node.type === "paragraph" &&
    node.children.length === 1 &&
    node.children[0]?.type === "image"
  );
}

function captionKindForNode(node: RootContent): CaptionKind | undefined {
  if (isStandaloneImage(node)) {
    return "figure";
  }
  return node.type === "table" || (node as { type: string }).type === "richTable" ? "table" : undefined;
}

function textFromPhrasingContent(node: PhrasingContent): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  if ("children" in node && Array.isArray(node.children)) {
    return node.children
      .map((child) => textFromPhrasingContent(child))
      .join("");
  }
  return "";
}

function parseCaptionParagraph(
  paragraph: Paragraph,
  kind: CaptionKind,
): CaptionCandidate | null {
  const first = paragraph.children[0];
  const last = paragraph.children[paragraph.children.length - 1];
  if (
    !first ||
    !last ||
    first.type !== "text" ||
    last.type !== "text" ||
    !/^:\s+/.test(first.value)
  ) {
    return null;
  }

  const identifierMatch = last.value.match(/\s+\{#([^\s{}]+)\}\s*$/);
  const plainText = paragraph.children.map(textFromPhrasingContent).join("");
  if (!identifierMatch) {
    return /\{#/.test(plainText)
      ? { error: "Malformed caption identifier" }
      : null;
  }

  // Group 1 is mandatory in the pattern, so it is always present on a match.
  const id = identifierMatch[1]!;
  const expectedPrefix = kind === "figure" ? "fig:" : "tbl:";
  if (!id.startsWith(expectedPrefix) || id.length === expectedPrefix.length) {
    return {
      id,
      error: `${kind === "figure" ? "Figure" : "Table"} captions require a ${expectedPrefix} identifier`,
    };
  }
  if (id.length > 128) {
    return { id, error: "Caption identifiers must be at most 128 characters" };
  }

  const children = paragraph.children.map((child) => ({ ...child }));
  const firstText = children[0];
  const lastText = children[children.length - 1];
  if (firstText?.type !== "text" || lastText?.type !== "text") {
    return { id, error: "Malformed caption text" };
  }

  firstText.value = firstText.value.replace(/^:\s+/, "");
  lastText.value = lastText.value.replace(/\s+\{#[^\s{}]+\}\s*$/, "");
  const captionText = children.map(textFromPhrasingContent).join("").trim();
  if (captionText.length === 0) {
    return { id, error: "Captions must contain text" };
  }

  return { id, children };
}

function captionCandidateAt(
  root: Root,
  blockIndex: number,
): { kind: CaptionKind; candidate: CaptionCandidate } | null {
  const block = root.children[blockIndex];
  if (!block) {
    return null;
  }
  const kind = captionKindForNode(block);
  const caption = root.children[blockIndex + 1];
  if (!kind || caption?.type !== "paragraph") {
    return null;
  }

  const candidate = parseCaptionParagraph(caption, kind);
  return candidate ? { kind, candidate } : null;
}

function definitionError(
  registry: CrossReferenceRegistry,
  message: string,
  context: Record<string, unknown>,
): void {
  if (registry.failureMode === "throw") {
    throw new MarkdownConversionError(message, context);
  }
}

/**
 * Registers a fresh caption map for `root` and visits every caption candidate
 * (a block followed by another block) in document order.
 */
function forEachCaptionCandidate(
  registry: CrossReferenceRegistry,
  root: Root,
  visit: (
    index: number,
    parsed: { kind: CaptionKind; candidate: CaptionCandidate },
    captions: Map<number, ResolvedCaption>,
  ) => void,
): void {
  const captions = new Map<number, ResolvedCaption>();
  registry.captionsByRoot.set(root, captions);
  for (let index = 0; index < root.children.length - 1; index++) {
    const parsed = captionCandidateAt(root, index);
    if (parsed) {
      visit(index, parsed, captions);
    }
  }
}

/**
 * Discovers caption definitions in document order so numbering and forward
 * references remain stable across Word sections.
 */
export function buildCrossReferenceRegistry(
  roots: Root[],
  options: CaptionOptions | undefined,
): CrossReferenceRegistry {
  const registry: CrossReferenceRegistry = {
    definitions: new Map(),
    captionsByRoot: new WeakMap(),
    failureMode: options?.failureMode ?? "preserve",
    boundDefinitionIds: new Set(),
  };
  const counters: Record<CaptionKind, number> = { figure: 0, table: 0 };

  for (const root of roots) {
    forEachCaptionCandidate(registry, root, (index, parsed, captions) => {
      const { kind, candidate } = parsed;
      if (candidate.error || !candidate.id || !candidate.children) {
        definitionError(
          registry,
          candidate.error || "Malformed caption",
          { kind, identifier: candidate.id },
        );
        return;
      }

      const existing = registry.definitions.get(candidate.id);
      if (existing) {
        definitionError(registry, `Duplicate caption identifier: ${candidate.id}`, {
          identifier: candidate.id,
          firstKind: existing.kind,
          duplicateKind: kind,
        });
        return;
      }

      counters[kind]++;
      const definition: CrossReferenceDefinition = {
        id: candidate.id,
        kind,
        number: counters[kind],
        bookmarkId: crossReferenceBookmarkId(candidate.id),
      };
      registry.definitions.set(definition.id, definition);
      captions.set(index, { ...definition, children: candidate.children });
    });
  }

  return registry;
}

export function captionAt(
  registry: CrossReferenceRegistry | undefined,
  root: Root,
  blockIndex: number,
): ResolvedCaption | undefined {
  return registry?.captionsByRoot.get(root)?.get(blockIndex);
}

/**
 * Binds the pre-scanned definitions to a freshly parsed AST. The first valid
 * occurrence wins, matching duplicate-ID behavior from the discovery pass.
 */
export function bindCrossReferenceCaptions(
  registry: CrossReferenceRegistry | undefined,
  root: Root,
): void {
  if (!registry) {
    return;
  }

  const existingCaptions = registry.captionsByRoot.get(root);
  if (existingCaptions && existingCaptions.size > 0) {
    for (const caption of existingCaptions.values()) {
      registry.boundDefinitionIds.add(caption.id);
    }
    return;
  }

  forEachCaptionCandidate(registry, root, (index, parsed, captions) => {
    const id = parsed.candidate.id;
    if (
      parsed.candidate.error ||
      !id ||
      !parsed.candidate.children ||
      registry.boundDefinitionIds.has(id)
    ) {
      return;
    }

    const definition = registry.definitions.get(id);
    if (!definition || definition.kind !== parsed.kind) {
      return;
    }
    captions.set(index, {
      ...definition,
      children: parsed.candidate.children,
    });
    registry.boundDefinitionIds.add(id);
  });
}

export function resolveCrossReference(
  registry: CrossReferenceRegistry | undefined,
  id: string,
): CrossReferenceDefinition | undefined {
  return registry?.definitions.get(id);
}

export function throwOnUnresolvedCrossReference(
  registry: CrossReferenceRegistry | undefined,
  id: string,
): void {
  if (registry?.failureMode === "throw") {
    throw new MarkdownConversionError(`Unresolved cross-reference: ${id}`, {
      identifier: id,
    });
  }
}

