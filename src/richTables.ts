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

/** Expand before element counting so fenced cell Markdown participates in budgets. */
export async function expandRichTables(
  root: Root,
  math: boolean,
  signal?: AbortSignal,
  depth = 0,
): Promise<void> {
  const visit = async (parent: { children: Node[] }): Promise<void> => {
    for (let index = 0; index < parent.children.length; index++) {
      throwIfAborted(signal);
      // Bounded by the loop condition.
      let node = parent.children[index]!;
      if (
        node.type === "code" &&
        (node as { lang?: string }).lang?.toLowerCase() === "table"
      ) {
        if (depth >= 8)
          throw new MarkdownConversionError(
            "Rich table nesting limit exceeded",
          );
        // Fence JSON is untrusted user input: parse as unknown and narrow.
        let definition: unknown;
        try {
          definition = JSON.parse((node as Code).value);
        } catch {
          throw new MarkdownConversionError("Invalid table fence JSON");
        }
        if (!isRecord(definition))
          throw new MarkdownConversionError(
            "Table fence requires rows and optional headers arrays",
          );
        const { rows, headers, columnWidths } = definition;
        if (
          !isUnknownArray(rows) ||
          !rows.length ||
          rows.length > 10000 ||
          (headers !== undefined && !isUnknownArray(headers))
        )
          throw new MarkdownConversionError(
            "Table fence requires rows and optional headers arrays",
          );
        if (
          columnWidths !== undefined &&
          columnWidths !== null &&
          !isColumnWidthList(columnWidths)
        )
          throw new MarkdownConversionError("Invalid table column widths");
        const table: RichTableAst = {
          type: "richTable",
          header: !!headers?.length,
          ...(columnWidths !== undefined && columnWidths !== null
            ? { columnWidths }
            : {}),
          children: [],
        };
        for (const row of [...(headers?.length ? [headers] : []), ...rows]) {
          if (!isUnknownArray(row) || row.length > 1000)
            throw new MarkdownConversionError("Invalid table row");
          const cells: RichTableAstCell[] = [];
          for (const input of row) {
            const cell: unknown =
              typeof input === "string" ? { markdown: input } : input;
            if (!isRecord(cell) || typeof cell.markdown !== "string")
              throw new MarkdownConversionError(
                "Table cells require markdown text",
              );
            const columnSpan = readCellSpan(cell.columnSpan);
            const rowSpan = readCellSpan(cell.rowSpan);
            const content = await parseMarkdownToAst(cell.markdown, math);
            await expandRichTables(content, math, signal, depth + 1);
            cells.push({
              type: "richTableCell",
              ...(columnSpan !== undefined ? { columnSpan } : {}),
              ...(rowSpan !== undefined ? { rowSpan } : {}),
              children: content.children,
            });
          }
          table.children.push({ type: "richTableRow", children: cells });
        }
        parent.children[index] = node = table;
      } else if ("children" in node) await visit(node as { children: Node[] });
    }
  };
  await visit(root);
}
