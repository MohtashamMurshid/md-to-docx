import { AlignmentType, Paragraph, TextRun } from "docx";
import type { IParagraphOptions } from "docx";
import {
  ChartBlockDefinition,
  ChartBlockType,
  ChartRenderingOptions,
  ImageHandlingOptions,
  Style,
} from "../types.js";
import { MarkdownConversionError } from "../errors.js";
import { throwIfAborted } from "../processingLimits.js";
import { resolveFontFamily } from "../utils/styleUtils.js";
import { processImage } from "./imageRenderer.js";
import type { ProcessImageResult } from "./imageRenderer.js";

const DEFAULT_CHART_WIDTH = 640;
const DEFAULT_CHART_HEIGHT = 360;
const DEFAULT_MAX_CHART_WIDTH = 2000;
const DEFAULT_MAX_CHART_HEIGHT = 2000;
const CHART_LANGUAGES = new Set(["chart", "chartjs"]);
const SUPPORTED_TYPES: ChartBlockType[] = ["bar", "line", "pie", "doughnut"];
const DEFAULT_COLORS = [
  "4E79A7",
  "F28E2B",
  "E15759",
  "76B7B2",
  "59A14F",
  "EDC948",
  "B07AA1",
  "FF9DA7",
  "9C755F",
  "BAB0AC",
];

interface ResolvedChartRenderingOptions {
  enabled: boolean;
  width: number;
  height: number;
  maxWidth: number;
  maxHeight: number;
  invalidDefinitionBehavior: "placeholder" | "throw";
  renderer?: ChartRenderingOptions["renderer"];
}

interface ChartRenderData {
  definition: ChartBlockDefinition;
  width: number;
  height: number;
  dataUrl: string;
}

class Raster {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height * 4);
  }

  clear(color: string): void {
    const [r, g, b] = parseColor(color);
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i] = r;
      this.pixels[i + 1] = g;
      this.pixels[i + 2] = b;
      this.pixels[i + 3] = 255;
    }
  }

  setPixel(x: number, y: number, color: string): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    const [r, g, b] = parseColor(color);
    const index = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    this.pixels[index] = r;
    this.pixels[index + 1] = g;
    this.pixels[index + 2] = b;
    this.pixels[index + 3] = 255;
  }

  fillRect(x: number, y: number, width: number, height: number, color: string) {
    const x0 = clamp(Math.floor(x), 0, this.width);
    const y0 = clamp(Math.floor(y), 0, this.height);
    const x1 = clamp(Math.ceil(x + width), 0, this.width);
    const y1 = clamp(Math.ceil(y + height), 0, this.height);
    const [r, g, b] = parseColor(color);

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const index = (py * this.width + px) * 4;
        this.pixels[index] = r;
        this.pixels[index + 1] = g;
        this.pixels[index + 2] = b;
        this.pixels[index + 3] = 255;
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, color: string): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const endX = Math.round(x1);
    const endY = Math.round(y1);
    const dx = Math.abs(endX - x);
    const sx = x < endX ? 1 : -1;
    const dy = -Math.abs(endY - y);
    const sy = y < endY ? 1 : -1;
    let error = dx + dy;

    while (true) {
      this.setPixel(x, y, color);
      this.setPixel(x + 1, y, color);
      this.setPixel(x, y + 1, color);
      if (x === endX && y === endY) break;
      const e2 = 2 * error;
      if (e2 >= dy) {
        error += dy;
        x += sx;
      }
      if (e2 <= dx) {
        error += dx;
        y += sy;
      }
    }
  }
}

export function isChartFenceLanguage(language: string | undefined): boolean {
  return CHART_LANGUAGES.has((language || "").toLowerCase());
}

export function resolveChartRenderingOptions(
  options?: ChartRenderingOptions,
): ResolvedChartRenderingOptions {
  return {
    enabled: options?.enabled === true,
    width: options?.width ?? DEFAULT_CHART_WIDTH,
    height: options?.height ?? DEFAULT_CHART_HEIGHT,
    maxWidth: options?.maxWidth ?? DEFAULT_MAX_CHART_WIDTH,
    maxHeight: options?.maxHeight ?? DEFAULT_MAX_CHART_HEIGHT,
    invalidDefinitionBehavior:
      options?.invalidDefinitionBehavior ?? "placeholder",
    renderer: options?.renderer,
  };
}

export async function processChartBlock(
  value: string,
  style: Style,
  chartRendering: ChartRenderingOptions | undefined,
  imageHandling: ImageHandlingOptions | undefined,
  paragraphOptions: Partial<IParagraphOptions> = {},
  signal?: AbortSignal,
): Promise<ProcessImageResult> {
  const resolved = resolveChartRenderingOptions(chartRendering);

  try {
    throwIfAborted(signal);
    const chart = await renderChart(value, resolved, signal);
    const sizedDataUrl = `${chart.dataUrl}#${chart.width}x${chart.height}`;
    const alt = chart.definition.alt || chart.definition.type;
    const result = await processImage(
      alt,
      sizedDataUrl,
      style,
      {
        ...imageHandling,
        dataUrls: { ...imageHandling?.dataUrls, enabled: true },
      },
      paragraphOptions,
      signal,
    );
    return result;
  } catch (error) {
    if (
      resolved.invalidDefinitionBehavior === "throw" ||
      error instanceof MarkdownConversionError
    ) {
      throw new MarkdownConversionError(
        `Invalid chart block: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { originalError: error },
      );
    }

    return {
      embedded: false,
      paragraphs: [
        new Paragraph({
          ...paragraphOptions,
          children: [
            new TextRun({
              text: `[Chart could not be rendered: ${
                error instanceof Error ? error.message : String(error)
              }]`,
              italics: true,
              color: "FF0000",
              font: resolveFontFamily(style),
            }),
          ],
          alignment: AlignmentType.CENTER,
          bidirectional: style.direction === "RTL",
        }),
      ],
    };
  }
}

async function renderChart(
  value: string,
  options: ResolvedChartRenderingOptions,
  signal?: AbortSignal,
): Promise<ChartRenderData> {
  throwIfAborted(signal);
  const definition = parseChartDefinition(value);
  const width = resolveDimension(
    definition.width,
    options.width,
    options.maxWidth,
    "width",
  );
  const height = resolveDimension(
    definition.height,
    options.height,
    options.maxHeight,
    "height",
  );

  const rendered = options.renderer
    ? await options.renderer({ definition, width, height, signal })
    : renderBuiltInChart(definition, width, height);
  throwIfAborted(signal);

  const dataUrl =
    typeof rendered === "string" ? rendered : pngBytesToDataUrl(rendered);
  if (!/^data:image\/png;base64,/i.test(dataUrl)) {
    throw new Error("chart renderer must return a PNG data URL or PNG bytes");
  }

  return { definition, width, height, dataUrl };
}

function parseChartDefinition(value: string): ChartBlockDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `expected chart JSON (${error instanceof Error ? error.message : error})`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("chart definition must be a JSON object");
  }

  const candidate = parsed as ChartBlockDefinition;
  if (!SUPPORTED_TYPES.includes(candidate.type)) {
    throw new Error(
      `chart type must be one of ${SUPPORTED_TYPES.join(", ")}`,
    );
  }

  if (
    !candidate.data ||
    typeof candidate.data !== "object" ||
    !Array.isArray(candidate.data.datasets) ||
    candidate.data.datasets.length === 0
  ) {
    throw new Error("chart data.datasets must contain at least one dataset");
  }

  candidate.data.datasets.forEach((dataset, index) => {
    if (!dataset || typeof dataset !== "object" || !Array.isArray(dataset.data)) {
      throw new Error(`chart data.datasets[${index}].data must be an array`);
    }
    if (
      dataset.data.length === 0 ||
      dataset.data.some(
        (value) => typeof value !== "number" || !Number.isFinite(value),
      )
    ) {
      throw new Error(
        `chart data.datasets[${index}].data must contain finite numbers`,
      );
    }
  });

  if (
    candidate.data.labels !== undefined &&
    (!Array.isArray(candidate.data.labels) ||
      candidate.data.labels.some((label) => typeof label !== "string"))
  ) {
    throw new Error("chart data.labels must be an array of strings");
  }

  return candidate;
}

function resolveDimension(
  blockValue: number | undefined,
  defaultValue: number,
  maxValue: number,
  name: string,
): number {
  const value = blockValue ?? defaultValue;
  if (!Number.isInteger(value) || !Number.isFinite(value) || value <= 0) {
    throw new Error(`chart ${name} must be a positive integer`);
  }
  if (value > maxValue) {
    throw new Error(`chart ${name} exceeds maximum ${maxValue}`);
  }
  return value;
}

function renderBuiltInChart(
  definition: ChartBlockDefinition,
  width: number,
  height: number,
): string {
  const raster = new Raster(width, height);
  raster.clear("FFFFFF");

  if (definition.type === "pie" || definition.type === "doughnut") {
    renderPieChart(raster, definition);
  } else if (definition.type === "bar") {
    renderBarChart(raster, definition);
  } else {
    renderLineChart(raster, definition);
  }

  return pngBytesToDataUrl(encodePng(raster.width, raster.height, raster.pixels));
}

function renderBarChart(raster: Raster, definition: ChartBlockDefinition): void {
  const plot = getPlotArea(raster);
  const datasets = definition.data.datasets;
  const seriesLength = Math.max(...datasets.map((dataset) => dataset.data.length));
  const values = datasets.flatMap((dataset) => dataset.data);
  const { min, max } = valueRange(values);

  drawAxes(raster, plot);
  const groupWidth = plot.width / Math.max(seriesLength, 1);
  const barWidth = Math.max(2, (groupWidth * 0.72) / datasets.length);

  datasets.forEach((dataset, datasetIndex) => {
    dataset.data.forEach((value, valueIndex) => {
      const zeroY = scaleY(0, min, max, plot);
      const valueY = scaleY(value, min, max, plot);
      const x =
        plot.left +
        valueIndex * groupWidth +
        groupWidth * 0.14 +
        datasetIndex * barWidth;
      const y = Math.min(zeroY, valueY);
      const height = Math.max(1, Math.abs(zeroY - valueY));
      raster.fillRect(
        x,
        y,
        Math.max(1, barWidth - 2),
        height,
        colorForDataset(dataset.backgroundColor, datasetIndex, valueIndex),
      );
    });
  });
}

function renderLineChart(raster: Raster, definition: ChartBlockDefinition): void {
  const plot = getPlotArea(raster);
  const datasets = definition.data.datasets;
  const seriesLength = Math.max(...datasets.map((dataset) => dataset.data.length));
  const values = datasets.flatMap((dataset) => dataset.data);
  const { min, max } = valueRange(values);

  drawAxes(raster, plot);
  datasets.forEach((dataset, datasetIndex) => {
    const color = colorForDataset(dataset.borderColor, datasetIndex, 0);
    dataset.data.forEach((value, valueIndex) => {
      if (valueIndex === 0) return;
      const previous = dataset.data[valueIndex - 1];
      raster.line(
        scaleX(valueIndex - 1, seriesLength, plot),
        scaleY(previous, min, max, plot),
        scaleX(valueIndex, seriesLength, plot),
        scaleY(value, min, max, plot),
        color,
      );
    });
  });
}

function renderPieChart(raster: Raster, definition: ChartBlockDefinition): void {
  const dataset = definition.data.datasets[0];
  const values = dataset.data.map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    throw new Error("pie and doughnut charts require a positive total");
  }

  const centerX = raster.width / 2;
  const centerY = raster.height / 2;
  const radius = Math.max(1, Math.min(raster.width, raster.height) * 0.38);
  const innerRadius = definition.type === "doughnut" ? radius * 0.52 : 0;
  let start = -Math.PI / 2;

  values.forEach((value, valueIndex) => {
    const angle = (value / total) * Math.PI * 2;
    const color = colorForDataset(
      dataset.backgroundColor,
      valueIndex,
      valueIndex,
    );
    if (angle >= Math.PI * 2 - Number.EPSILON) {
      fillAnnulus(raster, centerX, centerY, radius, innerRadius, color);
    } else {
      fillArc(
        raster,
        centerX,
        centerY,
        radius,
        innerRadius,
        start,
        start + angle,
        color,
      );
    }
    start += angle;
  });
}

function drawAxes(
  raster: Raster,
  plot: { left: number; top: number; width: number; height: number },
): void {
  const bottom = plot.top + plot.height;
  raster.line(plot.left, plot.top, plot.left, bottom, "4B5563");
  raster.line(plot.left, bottom, plot.left + plot.width, bottom, "4B5563");
  for (let i = 1; i <= 4; i++) {
    const y = plot.top + (plot.height / 5) * i;
    raster.line(plot.left, y, plot.left + plot.width, y, "E5E7EB");
  }
}

function getPlotArea(raster: Raster): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const left = Math.max(36, Math.round(raster.width * 0.08));
  const right = Math.max(18, Math.round(raster.width * 0.04));
  const top = Math.max(18, Math.round(raster.height * 0.06));
  const bottom = Math.max(28, Math.round(raster.height * 0.1));
  return {
    left,
    top,
    width: Math.max(1, raster.width - left - right),
    height: Math.max(1, raster.height - top - bottom),
  };
}

function valueRange(values: number[]): { min: number; max: number } {
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return { min, max };
}

function scaleX(
  index: number,
  count: number,
  plot: { left: number; width: number },
): number {
  if (count <= 1) return plot.left + plot.width / 2;
  return plot.left + (index / (count - 1)) * plot.width;
}

function scaleY(
  value: number,
  min: number,
  max: number,
  plot: { top: number; height: number },
): number {
  return plot.top + plot.height - ((value - min) / (max - min)) * plot.height;
}

function fillArc(
  raster: Raster,
  centerX: number,
  centerY: number,
  radius: number,
  innerRadius: number,
  start: number,
  end: number,
  color: string,
): void {
  const minX = Math.floor(centerX - radius);
  const maxX = Math.ceil(centerX + radius);
  const minY = Math.floor(centerY - radius);
  const maxY = Math.ceil(centerY + radius);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius || distance < innerRadius) continue;
      const angle = normalizeAngle(Math.atan2(dy, dx));
      if (angleInRange(angle, normalizeAngle(start), normalizeAngle(end))) {
        raster.setPixel(x, y, color);
      }
    }
  }
}

function fillAnnulus(
  raster: Raster,
  centerX: number,
  centerY: number,
  radius: number,
  innerRadius: number,
  color: string,
): void {
  const minX = Math.floor(centerX - radius);
  const maxX = Math.ceil(centerX + radius);
  const minY = Math.floor(centerY - radius);
  const maxY = Math.ceil(centerY + radius);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius && distance >= innerRadius) {
        raster.setPixel(x, y, color);
      }
    }
  }
}

function angleInRange(angle: number, start: number, end: number): boolean {
  if (end < start) {
    return angle >= start || angle <= end;
  }
  return angle >= start && angle <= end;
}

function normalizeAngle(angle: number): number {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

function colorForDataset(
  color: string | string[] | undefined,
  datasetIndex: number,
  valueIndex: number,
): string {
  if (Array.isArray(color)) {
    return (
      normalizeColor(color[valueIndex]) ||
      DEFAULT_COLORS[valueIndex % DEFAULT_COLORS.length]
    );
  }
  return (
    normalizeColor(color) ||
    DEFAULT_COLORS[datasetIndex % DEFAULT_COLORS.length]
  );
}

function normalizeColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const match = color.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? match[1].toUpperCase() : undefined;
}

function parseColor(color: string): [number, number, number] {
  const normalized = normalizeColor(color) || "000000";
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function pngBytesToDataUrl(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  }

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  let rawIndex = 0;
  let rgbaIndex = 0;
  for (let y = 0; y < height; y++) {
    raw[rawIndex++] = 0;
    raw.set(rgba.subarray(rgbaIndex, rgbaIndex + width * 4), rawIndex);
    rawIndex += width * 4;
    rgbaIndex += width * 4;
  }

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concatBytes([
    signature,
    pngChunk("IHDR", ihdrData(width, height)),
    pngChunk("IDAT", zlibStore(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function ihdrData(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  writeUint32(data, 0, width);
  writeUint32(data, 4, height);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function zlibStore(data: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
  let offset = 0;
  while (offset < data.length) {
    const length = Math.min(65535, data.length - offset);
    const isFinal = offset + length >= data.length;
    const block = new Uint8Array(5 + length);
    block[0] = isFinal ? 1 : 0;
    block[1] = length & 0xff;
    block[2] = (length >> 8) & 0xff;
    const nlen = length ^ 0xffff;
    block[3] = nlen & 0xff;
    block[4] = (nlen >> 8) & 0xff;
    block.set(data.subarray(offset, offset + length), 5);
    chunks.push(block);
    offset += length;
  }
  const checksum = new Uint8Array(4);
  writeUint32(checksum, 0, adler32(data));
  chunks.push(checksum);
  return concatBytes(chunks);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(concatBytes([typeBytes, data])));
  return chunk;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
