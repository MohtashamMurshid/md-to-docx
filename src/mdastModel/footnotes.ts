import type { FootnoteDefinition, FootnoteReference, Root } from "mdast";
import type { DocxInlineNode } from "../docxModel.js";
import { collectFirstNodesByKey } from "../markdownAst.js";

/** Footnote bookkeeping for one document, filled as references are met. */
export interface FootnoteState {
  /** First definition per normalized identifier. */
  readonly definitions: Map<string, FootnoteDefinition>;
  /** Word footnote ID per referenced identifier, in first-reference order. */
  readonly referencedIds: Map<string, number>;
  readonly referenceCounts: Map<string, number>;
}

export function normalizeFootnoteIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export function createFootnoteState(root: Root): FootnoteState {
  return {
    definitions: collectFirstNodesByKey<FootnoteDefinition>(
      root,
      "footnoteDefinition",
      (definition) => normalizeFootnoteIdentifier(definition.identifier),
    ),
    referencedIds: new Map(),
    referenceCounts: new Map(),
  };
}

function footnoteLabel(
  node: Pick<FootnoteReference, "identifier" | "label">,
): string {
  return node.label || node.identifier;
}

function footnoteReferenceId(state: FootnoteState, identifier: string): number {
  const normalizedIdentifier = normalizeFootnoteIdentifier(identifier);
  const existingId = state.referencedIds.get(normalizedIdentifier);
  if (existingId) {
    return existingId;
  }

  const id = state.referencedIds.size + 1;
  state.referencedIds.set(normalizedIdentifier, id);
  return id;
}

/**
 * A reference to a known footnote becomes a footnote reference; anything else
 * (an unknown label, or a reference inside a footnote) stays literal text.
 */
export function footnoteReferenceNode(
  state: FootnoteState,
  reference: FootnoteReference,
  allowFootnoteReferences: boolean,
): DocxInlineNode {
  const normalizedIdentifier = normalizeFootnoteIdentifier(
    reference.identifier,
  );
  if (
    !allowFootnoteReferences ||
    !state.definitions.has(normalizedIdentifier)
  ) {
    return { type: "text", value: `[^${footnoteLabel(reference)}]` };
  }

  const referenceCount =
    (state.referenceCounts.get(normalizedIdentifier) ?? 0) + 1;
  state.referenceCounts.set(normalizedIdentifier, referenceCount);
  return {
    type: "footnoteReference",
    identifier: normalizedIdentifier,
    id: footnoteReferenceId(state, normalizedIdentifier),
    isRepeatedReference: referenceCount > 1,
  };
}
