import { Paragraph } from "docx";
import type { IParagraphOptions, ISpacingProperties, ParagraphChild } from "docx";
import type {
  DocxBlockNode,
  DocxInlineNode,
  DocxListItemNode,
  DocxListNode,
  DocxTextNode,
} from "../docxModel.js";
import { throwIfAborted } from "../processingLimits.js";
import type {
  ListMarkerContext,
  Placement,
  RenderContext,
  RenderEnv,
} from "./context.js";
import { prepareInlineImages } from "./inlineImages.js";
import { renderInlineNodes } from "./inline.js";
import { quoteParagraphOptions, quoteStyleFor } from "./paragraphs.js";

const TASK_MARKERS = {
  unchecked: "☐ ",
  checked: "☒ ",
} as const;

function taskMarkerText(checked: boolean): DocxTextNode {
  return {
    type: "text",
    value: checked ? TASK_MARKERS.checked : TASK_MARKERS.unchecked,
  };
}

function listItemSize(env: RenderEnv): number {
  return env.style.listItemSize || 24;
}

function listSpacing(env: RenderEnv): ISpacingProperties {
  return {
    before: env.style.paragraphSpacing / 2,
    after: env.style.paragraphSpacing / 2,
  };
}

/** The numbering or bullet options that draw a list marker. */
export function markerNumbering(
  marker: ListMarkerContext,
): Pick<IParagraphOptions, "numbering" | "bullet"> {
  return marker.isOrdered
    ? {
        numbering: {
          reference: `numbered-list-${marker.sequenceId || 1}`,
          level: marker.level,
        },
      }
    : { bullet: { level: marker.level } };
}

/** A paragraph carrying the item's bullet or number, and its task box when the marker has one. */
export function listParagraph(
  env: RenderEnv,
  nodes: DocxInlineNode[],
  marker: ListMarkerContext,
  context: RenderContext = {},
): Paragraph {
  const children = renderInlineNodes(
    env,
    marker.taskChecked === undefined
      ? nodes
      : [taskMarkerText(marker.taskChecked), ...nodes],
    { size: listItemSize(env) },
  );
  const base = {
    children,
    spacing: listSpacing(env),
    bidirectional: env.style.direction === "RTL",
    ...quoteParagraphOptions(quoteStyleFor(env.style, context)),
  };
  return new Paragraph({ ...base, ...markerNumbering(marker) });
}

/** A later paragraph of a list item, indented under the item's text. */
function listContinuationParagraph(
  env: RenderEnv,
  nodes: DocxInlineNode[],
  level: number,
  context: RenderContext = {},
): Paragraph {
  const children = renderInlineNodes(env, nodes, { size: listItemSize(env) });
  // Inside a blockquote, the quote's indent replaces the list indent.
  return new Paragraph({
    children,
    spacing: listSpacing(env),
    indent: {
      left: 720 * (level + 1),
    },
    bidirectional: env.style.direction === "RTL",
    ...quoteParagraphOptions(quoteStyleFor(env.style, context)),
  });
}

/** The item's first paragraph carries its marker; later ones are continuations. */
export function listItemParagraph(
  env: RenderEnv,
  nodes: DocxInlineNode[],
  at: Placement,
): Paragraph {
  return at.marker
    ? listParagraph(env, nodes, at.marker, at.context)
    : listContinuationParagraph(env, nodes, at.listLevel, at.context);
}

/** The same placement, with the list marker's task box dropped. */
export function withoutTaskBox(at: Placement): Placement {
  return at.marker
    ? { ...at, marker: { ...at.marker, taskChecked: undefined } }
    : at;
}

/** The task box runs that precede an image or chart standing first in a task item. */
export function taskMarkerChildren(
  env: RenderEnv,
  marker?: ListMarkerContext,
): ParagraphChild[] {
  if (marker?.taskChecked === undefined) return [];
  return renderInlineNodes(env, [taskMarkerText(marker.taskChecked)], {
    size: listItemSize(env),
  });
}

async function renderListItemChild(
  env: RenderEnv,
  child: DocxBlockNode,
  at: Placement,
): Promise<Paragraph[]> {
  if (child.type === "list") {
    return renderList(env, child, at.listLevel + 1, at.context);
  }
  if (child.type === "paragraph") {
    await prepareInlineImages(env, child.children);
    return [listItemParagraph(env, child.children, at)];
  }
  // Other blocks render as part of the item; list items hold only paragraphs.
  const rendered = await env.blocks.renderWithMarker(env, child, at);
  return rendered.filter((block) => block instanceof Paragraph);
}

async function renderListItem(
  env: RenderEnv,
  item: DocxListItemNode,
  marker: ListMarkerContext,
  context: RenderContext,
): Promise<Paragraph[]> {
  throwIfAborted(env.options.signal);

  const paragraphs: Paragraph[] = [];
  const listContext: RenderContext = { ...context, inList: true };
  for (const child of item.children) {
    throwIfAborted(env.options.signal);
    const at: Placement = {
      listLevel: marker.level,
      context: listContext,
      marker: paragraphs.length === 0 ? marker : undefined,
    };
    paragraphs.push(...(await renderListItemChild(env, child, at)));
  }

  // An item with no content still shows its marker.
  if (paragraphs.length === 0) {
    paragraphs.push(listParagraph(env, [], marker, context));
  }
  return paragraphs;
}

export async function renderList(
  env: RenderEnv,
  list: DocxListNode,
  level: number,
  context: RenderContext = {},
): Promise<Paragraph[]> {
  throwIfAborted(env.options.signal);

  const sequenceId = list.sequenceId
    ? list.sequenceId + env.sequenceIdOffset
    : undefined;
  if (sequenceId) {
    env.renderOptions.numberingStarts?.set(sequenceId, list.start ?? 1);
    env.maxSequenceId = Math.max(env.maxSequenceId, sequenceId);
  }

  const paragraphs: Paragraph[] = [];
  for (const item of list.children) {
    throwIfAborted(env.options.signal);
    const marker: ListMarkerContext = {
      isOrdered: list.ordered,
      level,
      sequenceId,
      taskChecked: item.checked,
    };
    paragraphs.push(...(await renderListItem(env, item, marker, context)));
  }
  return paragraphs;
}
