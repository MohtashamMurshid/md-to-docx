import type { Root, Node, Code } from "mdast";
import { parseMarkdownToAst } from "./markdownAst.js";
import { MarkdownConversionError } from "./errors.js";
import { throwIfAborted } from "./processingLimits.js";

export interface RichTableCell {
  markdown: string;
  columnSpan?: number;
  rowSpan?: number;
}
export interface RichTableDefinition {
  headers?: (string | RichTableCell)[];
  rows: (string | RichTableCell)[][];
  columnWidths?: number[];
}
export interface RichTableAstCell {
  type: "richTableCell";
  columnSpan?: number;
  rowSpan?: number;
  children: Node[];
}
export interface RichTableAst extends Node {
  type: "richTable";
  header: boolean;
  columnWidths?: number[];
  children: { type: "richTableRow"; children: RichTableAstCell[] }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isColumnWidthList(value: unknown): value is number[] {
  return (
    isUnknownArray(value) &&
    value.every(
      (v) => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 31680,
    )
  );
}

function readCellSpan(span: unknown): number | undefined {
  if (
    span !== undefined &&
    (typeof span !== "number" ||
      !Number.isInteger(span) ||
      span < 1 ||
      span > 1000)
  )
    throw new MarkdownConversionError("Invalid table cell span");
  return span;
}

/** Recursion state for one `expandRichTables` call. */
interface ExpandContext {
  readonly math: boolean;
  readonly signal: AbortSignal | undefined;
  readonly depth: number;
}

/** A table fence's validated top-level fields. */
interface TableFenceDefinition {
  rows: unknown[];
  headers: unknown[] | undefined;
  columnWidths: number[] | undefined;
}

const MAX_TABLE_NESTING = 8;
const MAX_TABLE_ROWS = 10000;
const MAX_TABLE_ROW_CELLS = 1000;
const ROWS_REQUIRED = "Table fence requires rows and optional headers arrays";

function isTableFence(node: Node): node is Code {
  return (
    node.type === "code" &&
    (node as { lang?: string }).lang?.toLowerCase() === "table"
  );
}

function isRowList(rows: unknown): rows is unknown[] {
  return (
    isUnknownArray(rows) && rows.length > 0 && rows.length <= MAX_TABLE_ROWS
  );
}

/** Fence JSON is untrusted user input: parse as unknown and narrow. */
function parseFenceJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new MarkdownConversionError("Invalid table fence JSON");
  }
}

/** `null` widths are accepted and mean the same as leaving them out. */
function readColumnWidths(columnWidths: unknown): number[] | undefined {
  if (columnWidths === undefined || columnWidths === null) {
    return undefined;
  }
  if (!isColumnWidthList(columnWidths)) {
    throw new MarkdownConversionError("Invalid table column widths");
  }
  return columnWidths;
}

function readTableFence(value: string): TableFenceDefinition {
  const definition = parseFenceJson(value);
  if (!isRecord(definition)) {
    throw new MarkdownConversionError(ROWS_REQUIRED);
  }
  const { rows, headers, columnWidths } = definition;
  if (!isRowList(rows) || (headers !== undefined && !isUnknownArray(headers))) {
    throw new MarkdownConversionError(ROWS_REQUIRED);
  }
  return { rows, headers, columnWidths: readColumnWidths(columnWidths) };
}

async function readCell(
  input: unknown,
  context: ExpandContext,
): Promise<RichTableAstCell> {
  const cell: unknown = typeof input === "string" ? { markdown: input } : input;
  if (!isRecord(cell) || typeof cell.markdown !== "string") {
    throw new MarkdownConversionError("Table cells require markdown text");
  }
  const columnSpan = readCellSpan(cell.columnSpan);
  const rowSpan = readCellSpan(cell.rowSpan);
  const content = await parseMarkdownToAst(cell.markdown, context.math);
  await expandRichTables(
    content,
    context.math,
    context.signal,
    context.depth + 1,
  );
  return {
    type: "richTableCell",
    ...(columnSpan !== undefined ? { columnSpan } : {}),
    ...(rowSpan !== undefined ? { rowSpan } : {}),
    children: content.children,
  };
}

/** Cells are parsed one at a time, so the first invalid cell is the one reported. */
async function readRow(
  row: unknown,
  context: ExpandContext,
): Promise<RichTableAst["children"][number]> {
  if (!isUnknownArray(row) || row.length > MAX_TABLE_ROW_CELLS) {
    throw new MarkdownConversionError("Invalid table row");
  }
  const cells: RichTableAstCell[] = [];
  for (const input of row) {
    cells.push(await readCell(input, context));
  }
  return { type: "richTableRow", children: cells };
}

async function buildRichTable(
  fence: Code,
  context: ExpandContext,
): Promise<RichTableAst> {
  if (context.depth >= MAX_TABLE_NESTING) {
    throw new MarkdownConversionError("Rich table nesting limit exceeded");
  }
  const { rows, headers, columnWidths } = readTableFence(fence.value);
  const table: RichTableAst = {
    type: "richTable",
    header: !!headers?.length,
    ...(columnWidths !== undefined ? { columnWidths } : {}),
    children: [],
  };
  for (const row of [...(headers?.length ? [headers] : []), ...rows]) {
    table.children.push(await readRow(row, context));
  }
  return table;
}

async function visitChildren(
  parent: { children: Node[] },
  context: ExpandContext,
): Promise<void> {
  for (let index = 0; index < parent.children.length; index++) {
    throwIfAborted(context.signal);
    // Bounded by the loop condition.
    const node = parent.children[index]!;
    if (isTableFence(node)) {
      parent.children[index] = await buildRichTable(node, context);
    } else if ("children" in node) {
      await visitChildren(node as { children: Node[] }, context);
    }
  }
}

/** Expand before element counting so fenced cell Markdown participates in budgets. */
export async function expandRichTables(
  root: Root,
  math: boolean,
  signal?: AbortSignal,
  depth = 0,
): Promise<void> {
  await visitChildren(root, { math, signal, depth });
}
