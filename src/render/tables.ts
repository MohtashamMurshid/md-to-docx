import {
  AlignmentType,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  WidthType,
} from "docx";
import type { ITableCellOptions } from "docx";
import type { DocxBlockNode, DocxTableCell } from "../docxModel.js";
import { MarkdownConversionError } from "../errors.js";
import type { Block, RenderEnv } from "./context.js";
import { textFromInlineNodes, renderInlineNodes } from "./inline.js";
import { prepareInlineImages } from "./inlineImages.js";
import { paragraphFromInlineNodes } from "./paragraphs.js";

type TableNode = Extract<DocxBlockNode, { type: "table" }>;
type CellAlignment = (typeof AlignmentType)[keyof typeof AlignmentType];

/** Markdown column alignments; anything else is left-aligned. */
const CELL_ALIGNMENTS: ReadonlyMap<string | null | undefined, CellAlignment> =
  new Map([
    ["center", AlignmentType.CENTER],
    ["right", AlignmentType.RIGHT],
  ]);

function columnSpan(cell: DocxTableCell): number {
  return Array.isArray(cell) ? 1 : (cell.columnSpan ?? 1);
}

function rowSpan(cell: DocxTableCell): number {
  return Array.isArray(cell) ? 1 : (cell.rowSpan ?? 1);
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Which columns cells from earlier rows still cover, so each row's cells
 * land in the next free column.
 */
class RowSpanTracker {
  private readonly spans = new Map<number, { end: number; span: number }>();

  /** Whether a cell from an earlier row still covers this column in this row. */
  covers(column: number, rowIndex: number): boolean {
    const span = this.spans.get(column);
    return span !== undefined && span.end > rowIndex;
  }

  /** The first column at or after `column` no earlier row covers. */
  nextFreeColumn(column: number, rowIndex: number): number {
    let free = column;
    while (this.covers(free, rowIndex)) free += this.spans.get(free)!.span;
    return free;
  }

  overlaps(cell: PlacedCell): boolean {
    for (let c = cell.column; c < cell.column + cell.colSpan; c++)
      if (this.covers(c, cell.rowIndex)) return true;
    return false;
  }

  reserve(cell: PlacedCell): void {
    if (cell.rowSpan > 1)
      this.spans.set(cell.column, {
        end: cell.rowIndex + cell.rowSpan,
        span: cell.colSpan,
      });
  }
}

/** The table being built, shared by its rows and cells. */
interface TableLayout {
  node: TableNode;
  rows: DocxTableCell[][];
  widths: number[] | undefined;
  columnCount: number;
  spans: RowSpanTracker;
}

/** A cell with its grid position. */
interface PlacedCell {
  cell: DocxTableCell;
  rowIndex: number;
  column: number;
  colSpan: number;
  rowSpan: number;
  header: boolean;
}

function placeCell(layout: TableLayout, placed: PlacedCell): void {
  if (
    placed.column + placed.colSpan > layout.columnCount ||
    placed.rowIndex + placed.rowSpan > layout.rows.length
  )
    throw new MarkdownConversionError("Table cell span exceeds table bounds");
  if (layout.spans.overlaps(placed))
    throw new MarkdownConversionError("Overlapping table cell spans");
}

/** A cell's blocks. Word requires every cell to end in a paragraph. */
async function cellContent(
  env: RenderEnv,
  layout: TableLayout,
  placed: PlacedCell,
): Promise<Block[]> {
  const { cell } = placed;
  const content: Block[] = [];
  if (Array.isArray(cell)) {
    await prepareInlineImages(env, cell);
    const align = layout.node.align?.[placed.column];
    content.push(
      new Paragraph({
        alignment: CELL_ALIGNMENTS.get(align) ?? AlignmentType.LEFT,
        children: renderInlineNodes(env, cell, { forceBold: placed.header }),
        bidirectional: env.style.direction === "RTL",
      }),
    );
  } else {
    for (const child of cell.children)
      content.push(...(await env.blocks.render(env, child)));
  }
  if (!content.length || content[content.length - 1] instanceof Table)
    content.push(new Paragraph({}));
  return content;
}

function cellWidth(
  layout: TableLayout,
  placed: PlacedCell,
): Pick<ITableCellOptions, "width"> {
  if (!layout.widths) return {};
  const covered = layout.widths.slice(
    placed.column,
    placed.column + placed.colSpan,
  );
  return { width: { size: sum(covered), type: WidthType.DXA } };
}

function headerShading(
  env: RenderEnv,
  header: boolean,
): Pick<ITableCellOptions, "shading"> {
  if (!header) return {};
  const fill =
    env.style.tableHeaderBackground ??
    (env.documentType === "report" ? "DDDDDD" : "F2F2F2");
  return { shading: { fill } };
}

async function renderTableCell(
  env: RenderEnv,
  layout: TableLayout,
  placed: PlacedCell,
): Promise<TableCell> {
  return new TableCell({
    children: await cellContent(env, layout, placed),
    columnSpan: placed.colSpan,
    rowSpan: placed.rowSpan,
    ...cellWidth(layout, placed),
    ...headerShading(env, placed.header),
  });
}

async function renderTableRow(
  env: RenderEnv,
  layout: TableLayout,
  rowIndex: number,
): Promise<TableRow> {
  const header = rowIndex === 0 && layout.node.headers.length > 0;
  const cells: TableCell[] = [];
  let column = 0;
  for (const cell of layout.rows[rowIndex]!) {
    column = layout.spans.nextFreeColumn(column, rowIndex);
    const placed: PlacedCell = {
      cell,
      rowIndex,
      column,
      colSpan: columnSpan(cell),
      rowSpan: rowSpan(cell),
      header,
    };
    placeCell(layout, placed);
    cells.push(await renderTableCell(env, layout, placed));
    layout.spans.reserve(placed);
    column += placed.colSpan;
  }
  if (layout.spans.nextFreeColumn(column, rowIndex) !== layout.columnCount)
    throw new MarkdownConversionError(
      "Table rows must cover the same number of columns",
    );
  return new TableRow({
    tableHeader: header,
    cantSplit: env.style.tableAllowRowSplit === false,
    children: cells,
  });
}

export async function tableFromNode(
  env: RenderEnv,
  node: TableNode,
): Promise<Table> {
  const { style } = env;
  const rows = node.headers.length ? [node.headers, ...node.rows] : node.rows;
  const widths = node.columnWidths ?? style.tableColumnWidths;
  const columnCount = sum(rows[0]?.map(columnSpan) ?? []);
  if (widths && widths.length !== columnCount)
    throw new MarkdownConversionError(
      "Table column widths must match the logical column count",
    );

  const layout: TableLayout = {
    node,
    rows,
    widths,
    columnCount,
    spans: new RowSpanTracker(),
  };
  const tableRows: TableRow[] = [];
  for (const rowIndex of rows.keys())
    tableRows.push(await renderTableRow(env, layout, rowIndex));

  return new Table({
    rows: tableRows,
    width: {
      size: widths ? sum(widths) : env.tableWidthTwips,
      type: WidthType.DXA,
    },
    ...(widths !== undefined ? { columnWidths: widths } : {}),
    layout:
      style.tableLayout === "fixed" || widths
        ? TableLayoutType.FIXED
        : TableLayoutType.AUTOFIT,
    margins: {
      top: 100,
      bottom: 100,
      left: 100,
      right: 100,
      ...style.tableCellMargins,
    },
  });
}

/** A table as one text paragraph per row, for footnotes, which cannot hold tables. */
export function tableFootnoteFallbackParagraphs(
  env: RenderEnv,
  node: TableNode,
): Paragraph[] {
  const rows = [node.headers, ...node.rows];
  return rows.map((row) =>
    paragraphFromInlineNodes(env, [
      {
        type: "text",
        value: row
          .map((cell) =>
            Array.isArray(cell)
              ? textFromInlineNodes(env, cell)
              : "[Rich table cell]",
          )
          .join(" | "),
      },
    ]),
  );
}
