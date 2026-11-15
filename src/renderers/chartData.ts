import type { ChartDataset } from "../types.js";

export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** A `#RRGGBB` or `RRGGBB` colour as upper-case `RRGGBB`, or `undefined` for anything else. */
export function normalizeColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const match = color.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? match[1]!.toUpperCase() : undefined;
}

/**
 * A pie or doughnut dataset's slices, negative values drawn as empty slices,
 * and their total. Both renderers reject a chart with nothing to draw.
 */
export function pieSliceValues(dataset: ChartDataset): {
  values: number[];
  total: number;
} {
  const values = dataset.data.map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    throw new Error("pie and doughnut charts require a positive total");
  }
  return { values, total };
}
