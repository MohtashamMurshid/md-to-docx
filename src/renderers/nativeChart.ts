import type { DocPropertiesOptions } from "docx";
import { ChartRun } from "docx/charts";
import type { ChartRunOptions, ChartSeries, PieChartSeries } from "docx/charts";
import type { ChartBlockDefinition, ChartDataset } from "../types.js";
import { isValidOoxmlText } from "../accessibility.js";
import { isUnknownArray, normalizeColor, pieSliceValues } from "./chartData.js";

export interface NativeChartInput {
  definition: ChartBlockDefinition;
  /** Size in pixels, resolved and bounded as for the PNG. */
  width: number;
  height: number;
  altText: DocPropertiesOptions;
}

/**
 * An editable Word chart for a validated chart definition. Its data goes in
 * an embedded workbook, which Word's "Edit Data" opens in Excel. Colours the
 * definition leaves out come from the document theme's accent colours.
 *
 * @throws When labels hold characters OOXML cannot carry, a pie or doughnut
 * has no positive total, or docx rejects the chart.
 */
export function createNativeChartRun(input: NativeChartInput): ChartRun {
  return new ChartRun(nativeChartOptions(input));
}

function nativeChartOptions({
  definition,
  width,
  height,
  altText,
}: NativeChartInput): ChartRunOptions {
  const base = {
    transformation: { width, height },
    altText,
    ...visibleTitle(definition),
  };
  const datasets = definition.data.datasets;
  const type = definition.type;
  if (type === "pie" || type === "doughnut") {
    // Like the PNG, a pie or doughnut draws the first dataset.
    const dataset = datasets[0]!;
    const categories = chartCategories(definition, dataset.data.length);
    return { ...base, type, categories, series: [pieSeries(dataset, 0)] };
  }
  const categories = chartCategories(
    definition,
    Math.max(...datasets.map((dataset) => dataset.data.length)),
  );
  return type === "bar"
    ? { ...base, type: "column", categories, series: datasets.map(barSeries) }
    : { ...base, type: "line", categories, series: datasets.map(lineSeries) };
}

/** Chart.js draws a title only when `display` is true; Word does the same. */
function visibleTitle(definition: ChartBlockDefinition): { title?: string } {
  const title = definition.options?.plugins?.title;
  return title?.display === true && title.text ? { title: title.text } : {};
}

/**
 * The definition's labels, numbered on past the last one so every value has a
 * category: docx rejects a series with more values than categories.
 */
function chartCategories(
  definition: ChartBlockDefinition,
  valueCount: number,
): string[] {
  const labels = definition.data.labels ?? [];
  const categories = Array.from(
    { length: Math.max(labels.length, valueCount) },
    (_, index) => labels[index] ?? String(index + 1),
  );
  for (const category of categories) assertOoxmlText(category, "labels");
  return categories;
}

/** A dataset's `label`, or Excel's default series name. */
function seriesName(dataset: ChartDataset, index: number): string {
  // Chart JSON is not typed at runtime, so the label may be any value.
  const label: unknown = dataset.label;
  if (typeof label !== "string" || label.length === 0) {
    return `Series ${index + 1}`;
  }
  assertOoxmlText(label, `data.datasets[${index}].label`);
  return label;
}

function assertOoxmlText(value: string, field: string): void {
  if (!isValidOoxmlText(value)) {
    throw new Error(`chart ${field} must not contain characters that are not valid in OOXML`);
  }
}

/** A colour from chart JSON, which may hold any value. */
function colorOf(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeColor(value) : undefined;
}

/** One colour per value from an array, or `undefined` when none is usable. */
function colorList(value: unknown): (string | undefined)[] | undefined {
  if (!isUnknownArray(value)) return undefined;
  const colors = value.map(colorOf);
  return colors.some((color) => color !== undefined) ? colors : undefined;
}

function barSeries(dataset: ChartDataset, index: number): ChartSeries {
  const colors = colorList(dataset.backgroundColor);
  const color = colorOf(dataset.backgroundColor);
  return {
    name: seriesName(dataset, index),
    values: dataset.data,
    ...(colors ? { colors } : {}),
    ...(color ? { color } : {}),
  };
}

function lineSeries(dataset: ChartDataset, index: number): ChartSeries {
  const borderColor: unknown = dataset.borderColor;
  const color = colorOf(
    isUnknownArray(borderColor) ? borderColor[0] : borderColor,
  );
  return {
    name: seriesName(dataset, index),
    values: dataset.data,
    ...(color ? { color } : {}),
  };
}

function pieSeries(dataset: ChartDataset, index: number): PieChartSeries {
  const { values } = pieSliceValues(dataset);
  const single = colorOf(dataset.backgroundColor);
  const colors = single
    ? values.map(() => single)
    : colorList(dataset.backgroundColor);
  return {
    name: seriesName(dataset, index),
    values,
    ...(colors ? { colors } : {}),
  };
}
