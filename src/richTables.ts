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
      let node = parent.children[index];
      if (
        node.type === "code" &&
        (node as { lang?: string }).lang?.toLowerCase() === "table"
      ) {
        if (depth >= 8)
          throw new MarkdownConversionError(
            "Rich table nesting limit exceeded",
          );
        let definition: RichTableDefinition;
        try {
          definition = JSON.parse((node as Code).value);
        } catch {
          throw new MarkdownConversionError("Invalid table fence JSON");
        }
        if (
          !definition ||
          !Array.isArray(definition.rows) ||
          !definition.rows.length ||
          definition.rows.length > 10000 ||
          (definition.headers !== undefined &&
            !Array.isArray(definition.headers))
        )
          throw new MarkdownConversionError(
            "Table fence requires rows and optional headers arrays",
          );
        if (
          definition.columnWidths &&
          (!Array.isArray(definition.columnWidths) ||
            definition.columnWidths.some(
              (v) => !Number.isInteger(v) || v <= 0 || v > 31680,
            ))
        )
          throw new MarkdownConversionError("Invalid table column widths");
        const table: RichTableAst = {
          type: "richTable",
          header: !!definition.headers?.length,
          columnWidths: definition.columnWidths,
          children: [],
        };
        for (const row of [
          ...(definition.headers?.length ? [definition.headers] : []),
          ...definition.rows,
        ]) {
          if (!Array.isArray(row) || row.length > 1000)
            throw new MarkdownConversionError("Invalid table row");
          const cells: RichTableAstCell[] = [];
          for (const input of row) {
            const cell =
              typeof input === "string" ? { markdown: input } : input;
            if (!cell || typeof cell.markdown !== "string")
              throw new MarkdownConversionError(
                "Table cells require markdown text",
              );
            for (const span of [cell.columnSpan, cell.rowSpan])
              if (
                span !== undefined &&
                (!Number.isInteger(span) || span < 1 || span > 1000)
              )
                throw new MarkdownConversionError("Invalid table cell span");
            const content = await parseMarkdownToAst(cell.markdown, math);
            await expandRichTables(content, math, signal, depth + 1);
            cells.push({
              type: "richTableCell",
              columnSpan: cell.columnSpan,
              rowSpan: cell.rowSpan,
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
