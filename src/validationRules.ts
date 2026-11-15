import { MarkdownConversionError } from "./errors.js";

/**
 * One check on one field of an options object. Options come from plain-JS
 * callers and CLI JSON files, so a field's declared type is a claim, not a
 * guarantee: `invalid` receives whatever was passed, apart from `undefined`.
 */
export interface FieldRule<T, K extends keyof T = keyof T> {
  readonly key: K;
  readonly message: string;
  /** True when a value other than `undefined` breaks the rule. */
  invalid(value: Exclude<T[K], undefined>, scope: string): boolean;
  /** Builds the error context; without it the error carries none. */
  context?(value: Exclude<T[K], undefined>, scope: string): unknown;
}

/** A rule for any one field of `T`, typed by that field. */
export type AnyFieldRule<T> = {
  [K in keyof T]-?: FieldRule<T, K>;
}[keyof T];

function checkField<T, K extends keyof T>(
  source: T,
  rule: FieldRule<T, K>,
  scope: string,
): void {
  const value = source[rule.key];
  if (value === undefined) return;
  const present = value as Exclude<T[K], undefined>;
  if (rule.invalid(present, scope)) {
    throw new MarkdownConversionError(
      rule.message,
      rule.context?.(present, scope),
    );
  }
}

/**
 * Throws for the first rule, in table order, that the source breaks. `scope`
 * names the options object in error contexts, such as `options.style`.
 */
export function checkFields<T>(
  source: T,
  rules: readonly AnyFieldRule<T>[],
  scope = "",
): void {
  for (const rule of rules) {
    checkField(source, rule, scope);
  }
}

/** Context `{ <scopeKey>: scope, <name>: value }`, the shape most rules use. */
export function scopedContext(
  name: string,
  scopeKey: "context" | "styleContext" = "context",
): (value: unknown, scope: string) => unknown {
  return (value, scope) => ({ [scopeKey]: scope, [name]: value });
}

/** Context `{ <name>: value }`, without the scope. */
export function valueContext(name: string): (value: unknown) => unknown {
  return (value) => ({ [name]: value });
}

export function isNotBoolean(value: unknown): boolean {
  return typeof value !== "boolean";
}

export function isNotString(value: unknown): boolean {
  return typeof value !== "string";
}

export function isBlankOrNotString(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/** Membership test that accepts any value, for enum fields read from JSON. */
export function isNotOneOf(
  allowed: readonly unknown[],
): (value: unknown) => boolean {
  return (value) => !allowed.includes(value);
}
