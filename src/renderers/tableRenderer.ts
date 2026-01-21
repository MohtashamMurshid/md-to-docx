import { Table, TableRow, TableCell, Paragraph, TextRun, AlignmentType, BorderStyle, TableLayoutType, WidthType } from "docx";
import { TableData, Style } from "../types.js";

/**
 * Collects tables from markdown lines
 * @param lines - The markdown lines
 * @returns An array of table data
 */
export function collectTables(lines: string[]): TableData[] {
  const tables: TableData[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("|")) {
      // Check for separator row with proper regex
      if (
        i + 1 < lines.length &&
        /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[i + 1])
      ) {
        // Preserve empty cells by slicing off leading/trailing pipe and splitting
        const headers = line
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((h) => h.trim());
        const rows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim().startsWith("|")) {
          const row = lines[j]
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((cell) => cell.trim());
          rows.push(row);
          j++;
        }
        tables.push({ headers, rows });
      }
    }
  }

  return tables;
}

/**
 * Processes a table and returns table formatting
 * @param tableData - The table data
 * @param documentType - The document type
 * @param style - The style configuration (optional)
 * @returns The processed table
 */
export function processTable(
  tableData: TableData,
  documentType: "document" | "report",
  style?: Style
): Table {
  // Determine table layout based on style configuration (default: autofit)
  const layout = style?.tableLayout === "fixed"
    ? TableLayoutType.FIXED
    : TableLayoutType.AUTOFIT;

  // Calculate column widths (using DXA units)
  // Default A4 page content width is approximately 9026 DXA (about 15.9cm)
  const pageWidth = 9026;
  // Derive max column count from headers and all rows to handle mismatches
  const maxRowLength = tableData.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const columnCount = Math.max(tableData.headers.length, maxRowLength, 1); // Ensure at least 1 column
  const columnWidth = Math.floor(pageWidth / columnCount);
  const columnWidths = Array(columnCount).fill(columnWidth);

  // Helper function to get alignment for a column index
  const getColumnAlignment = (index: number): typeof AlignmentType[keyof typeof AlignmentType] => {
    const align = tableData.align?.[index];
    if (align === "center") return AlignmentType.CENTER;
    if (align === "right") return AlignmentType.RIGHT;
    return AlignmentType.LEFT;
  };

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: columnWidths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: tableData.headers.map(
          (header, index) =>
            new TableCell({
              width: { size: columnWidths[index], type: WidthType.DXA },
              children: [
                new Paragraph({
                  alignment: getColumnAlignment(index),
                  style: "Strong",
                  children: [
                    new TextRun({
                      text: header,
                      bold: true,
                      color: "000000",
                    }),
                  ],
                }),
              ],
              shading: {
                fill: documentType === "report" ? "DDDDDD" : "F2F2F2",
              },
            })
        ),
      }),
      ...tableData.rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (cell, index) =>
                new TableCell({
                  width: { size: columnWidths[index], type: WidthType.DXA },
                  children: [
                    new Paragraph({
                      alignment: getColumnAlignment(index),
                      children: [
                        new TextRun({
                          text: cell,
                          color: "000000",
                          rightToLeft: false,
                        }),
                      ],
                    }),
                  ],
                })
            ),
          })
      ),
    ],
    layout: layout,
    margins: {
      top: 100,
      bottom: 100,
      left: 100,
      right: 100,
    },
  });
}