import type { Node, Paragraph, Table, TableCell } from "mdast";
import type { DocxBlockNode, DocxInlineNode } from "../docxModel.js";
import type { RichTableAst, RichTableAstCell } from "../richTables.js";
import type { ConversionContext, ProcessOptions } from "./context.js";
import { convertBlocks } from "./context.js";
import { processInlineNodes } from "./inline.js";

function isParagraphNode(node: Node): node is Paragraph {
  return node.type === "paragraph";
}

function tableCellInlines(
  context: ConversionContext,
  cell: TableCell,
  options: ProcessOptions,
): DocxInlineNode[] {
  return cell.children.flatMap((child) => {
    // mdast types cells as phrasing-only, but plugin AST transforms may
    // still place paragraphs inside them.
    const cellChild: Node = child;
    return isParagraphNode(cellChild)
      ? processInlineNodes(context, cellChild.children, options)
      : processInlineNodes(context, [child], options);
  });
}

/** Pads short rows with empty cells and drops cells beyond the header width. */
function fitRowToWidth(
  row: DocxInlineNode[][],
  width: number,
): DocxInlineNode[][] {
  while (row.length < width) row.push([]);
  return row.slice(0, width);
}

/** A GFM table: the first row is the header and fixes the column count. */
export function processTable(
  context: ConversionContext,
  table: Table,
  options: ProcessOptions,
): DocxBlockNode {
  const [headerRow, ...bodyRows] = table.children;
  const headers = (headerRow?.children ?? []).map((cell) =>
    tableCellInlines(context, cell, options),
  );
  const rows = bodyRows.map((row) =>
    fitRowToWidth(
      row.children.map((cell) => tableCellInlines(context, cell, options)),
      headers.length,
    ),
  );

  return {
    type: "table",
    headers,
    rows,
    ...(table.align ? { align: table.align } : {}),
  };
}

function richTableCell(
  context: ConversionContext,
  cell: RichTableAstCell,
  options: ProcessOptions,
) {
  return {
    type: "tableCell" as const,
    ...(cell.columnSpan !== undefined ? { columnSpan: cell.columnSpan } : {}),
    ...(cell.rowSpan !== undefined ? { rowSpan: cell.rowSpan } : {}),
    children: convertBlocks(context, cell.children, options),
  };
}

/** A `table` fence expanded by `expandRichTables`; cells hold block content. */
export function processRichTable(
  context: ConversionContext,
  table: RichTableAst,
  options: ProcessOptions,
): DocxBlockNode {
  const rows = table.children.map((row) =>
    row.children.map((cell) => richTableCell(context, cell, options)),
  );
  return {
    type: "table",
    headers: table.header ? rows.shift()! : [],
    rows,
    ...(table.columnWidths !== undefined
      ? { columnWidths: table.columnWidths }
      : {}),
  };
}
