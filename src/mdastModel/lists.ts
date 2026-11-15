import type { List, ListItem } from "mdast";
import type { DocxBlockNode, DocxListItemNode } from "../docxModel.js";
import type { ConversionContext, ProcessOptions } from "./context.js";
import { convertBlocks, orEmptyParagraph } from "./context.js";

/**
 * Ordered lists get a sequence ID the first time they are seen, before their
 * items are converted, so nested lists number after their parent.
 */
function assignSequenceId(sequenceIds: Map<List, number>, list: List): void {
  if (list.ordered && !sequenceIds.has(list)) {
    sequenceIds.set(list, sequenceIds.size + 1);
  }
}

function processListItem(
  context: ConversionContext,
  item: ListItem,
  options: ProcessOptions,
): DocxListItemNode {
  // Nested lists and paragraphs go through the same dispatcher as any other
  // block content (headings, code blocks, etc.).
  const children = orEmptyParagraph(
    convertBlocks(context, item.children, options),
  );
  return {
    type: "listItem",
    children,
    ...(typeof item.checked === "boolean" ? { checked: item.checked } : {}),
  };
}

export function processList(
  context: ConversionContext,
  list: List,
  options: ProcessOptions,
): DocxBlockNode {
  assignSequenceId(context.listSequenceIds, list);
  const listItems = list.children.map((item) =>
    processListItem(context, item, options),
  );

  const sequenceId = list.ordered
    ? context.listSequenceIds.get(list)
    : undefined;
  return {
    type: "list",
    ordered: list.ordered || false,
    start: list.start ?? 1,
    children: listItems,
    ...(sequenceId !== undefined ? { sequenceId } : {}),
  };
}
