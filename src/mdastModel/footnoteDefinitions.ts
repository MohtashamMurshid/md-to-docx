import type { FootnoteDefinition, Node, Paragraph } from "mdast";
import type {
  DocxBlockNode,
  DocxFootnoteDefinitionNode,
} from "../docxModel.js";
import type { BlockResult, ConversionContext } from "./context.js";
import { blockResultToArray, orEmptyParagraph } from "./context.js";
import { normalizeFootnoteIdentifier } from "./footnotes.js";
import { processInlineNodes } from "./inline.js";

/** Footnotes cannot reference other footnotes; such references stay text. */
const IN_FOOTNOTE = { allowFootnoteReferences: false } as const;

/**
 * Footnote paragraphs are always text paragraphs: unlike body paragraphs, a
 * lone image inside one is not promoted to a block image.
 */
function convertFootnoteChild(
  context: ConversionContext,
  node: Node,
): BlockResult {
  if (node.type === "paragraph") {
    return {
      type: "paragraph",
      children: processInlineNodes(
        context,
        (node as Paragraph).children,
        IN_FOOTNOTE,
      ),
    };
  }
  return context.convertBlock(node, IN_FOOTNOTE);
}

function processFootnoteDefinition(
  context: ConversionContext,
  definition: FootnoteDefinition,
  id: number,
): DocxFootnoteDefinitionNode {
  const children: DocxBlockNode[] = orEmptyParagraph(
    definition.children.flatMap((child) =>
      blockResultToArray(convertFootnoteChild(context, child)),
    ),
  );
  return {
    identifier: normalizeFootnoteIdentifier(definition.identifier),
    id,
    children,
  };
}

/** Converts every referenced footnote, in the order it was first referenced. */
export function processReferencedFootnotes(
  context: ConversionContext,
): DocxFootnoteDefinitionNode[] {
  const { definitions, referencedIds } = context.footnotes;
  return Array.from(referencedIds.entries()).map(([identifier, id]) =>
    processFootnoteDefinition(context, definitions.get(identifier)!, id),
  );
}
