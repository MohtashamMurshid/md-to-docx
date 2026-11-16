import { ExternalHyperlink, InternalHyperlink, TextRun } from "docx";
import type { ParagraphChild } from "docx";
import type { DocxTextNode } from "../docxModel.js";
import type { InlineOverrides, RenderEnv } from "./context.js";
import {
  emphasisOptions,
  fontOption,
  languageOption,
  runSize,
  textRunFromNode,
} from "./runs.js";

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/** The first character a URL parser keeps: it drops leading C0 controls and spaces. */
function urlStart(url: string): number {
  let start = 0;
  while (start < url.length && url.charCodeAt(start) <= 0x20) start++;
  return start;
}

/**
 * UNC paths (`\\host\share`) and protocol-relative targets (`//host/share`)
 * name a host without a scheme. The URL parser resolves them against the
 * base's https scheme, but Word opens the raw target, which on Windows can
 * be an SMB share that receives the user's NTLM credentials. Any backslash
 * is refused, as the parser reads it as a slash in an http(s) URL.
 */
function namesHostWithoutScheme(url: string): boolean {
  // The URL parser also drops tabs and new lines anywhere in the target.
  const target = url.replace(/[\t\n\r]/g, "");
  return target.includes("\\") || target.startsWith("//", urlStart(target));
}

/**
 * Hyperlink targets are restricted to a scheme allowlist so a malicious
 * document cannot embed e.g. file:// UNC links (NTLM credential leak when
 * clicked in Word on Windows) or other unexpected protocol handlers.
 * Relative/fragment targets resolve against the dummy base and inherit its
 * safe scheme; targets the URL parser rejects outright fail closed because
 * Word may still treat the raw string as an active hyperlink. Links in raw
 * HTML pass the same check.
 */
export function isSafeLinkUrl(url: string): boolean {
  if (namesHostWithoutScheme(url)) {
    return false;
  }
  let protocol: string;
  try {
    protocol = new URL(url, "https://relative-link.invalid/").protocol;
  } catch {
    return false;
  }
  return SAFE_LINK_PROTOCOLS.has(protocol.toLowerCase());
}

export function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    // Keep literal malformed escapes.
    return fragment;
  }
}

/** How a link renders: to a heading, to a URL, or, when its scheme is refused, not at all. */
export type LinkKind = "internal" | "external" | "unsafe";

export function linkKind(url: string): LinkKind {
  if (url.startsWith("#")) {
    return "internal";
  }
  return isSafeLinkUrl(url) ? "external" : "unsafe";
}

/** A link to a heading. Its anchor is filled in by {@link finalizeLinks}. */
function internalHyperlink(
  env: RenderEnv,
  source: string,
  children: readonly ParagraphChild[],
): InternalHyperlink {
  const fragment = decodeFragment(source.slice(1));
  const link = new InternalHyperlink({ anchor: fragment, children });
  env.pendingLinks.push({ link, fragment, source });
  return link;
}

function externalLink(
  env: RenderEnv,
  node: DocxTextNode,
  link: string,
  overrides: InlineOverrides,
): ExternalHyperlink {
  const { style } = env;
  return new ExternalHyperlink({
    children: [
      new TextRun({
        text: node.value,
        color: "0000FF",
        underline: { type: "single" },
        ...emphasisOptions(node, overrides),
        size: runSize(style, overrides),
        ...fontOption(style),
        rightToLeft: style.direction === "RTL",
        ...languageOption(style),
      }),
    ],
    link,
  });
}

/** A text node: plain, a heading link, or an external link if its scheme is safe. */
export function renderTextNode(
  env: RenderEnv,
  node: DocxTextNode,
  overrides: InlineOverrides,
): ParagraphChild {
  if (!node.link) {
    return textRunFromNode(env, node, overrides);
  }
  switch (linkKind(node.link)) {
    case "internal":
      return internalHyperlink(env, node.link, [
        textRunFromNode(env, node, overrides),
      ]);
    case "unsafe": {
      const { link: _unsafeLink, ...plainNode } = node;
      return textRunFromNode(env, plainNode, overrides);
    }
    case "external":
      return externalLink(env, node, node.link, overrides);
  }
}

function isHyperlink(
  child: ParagraphChild,
): child is ExternalHyperlink | InternalHyperlink {
  return child instanceof ExternalHyperlink || child instanceof InternalHyperlink;
}

/**
 * Runs in a hyperlink to `url`, as a text node with that link renders: a
 * heading link, an external link, or no link when the scheme is refused.
 * Hyperlinks among the runs keep their own targets, as Word cannot nest them.
 */
export function linkRuns(
  env: RenderEnv,
  url: string,
  runs: readonly ParagraphChild[],
): ParagraphChild[] {
  const kind = linkKind(url);
  if (kind === "unsafe") {
    return [...runs];
  }
  const linked: ParagraphChild[] = [];
  let group: ParagraphChild[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    linked.push(
      kind === "internal"
        ? internalHyperlink(env, url, group)
        : new ExternalHyperlink({ children: group, link: url }),
    );
    group = [];
  };
  for (const run of runs) {
    if (isHyperlink(run)) {
      flush();
      linked.push(run);
    } else {
      group.push(run);
    }
  }
  flush();
  return linked;
}

/** The bookmark of the heading a fragment names, with a warning when there is none. */
function headingAnchor(
  env: RenderEnv,
  fragment: string,
  source: string,
): string | undefined {
  const anchor = env.headingAnchors.anchors.get(fragment);
  if (!anchor)
    env.options.onWarning?.({
      code: "UNRESOLVED_LINK",
      message: `No heading matches ${source}`,
      source,
    });
  return anchor;
}

/**
 * Links may point forward or into a later section. Resolve when docx packs,
 * after every heading has been rendered, using its public XML hook.
 */
export function finalizeLinks(env: RenderEnv): void {
  for (const { link, fragment, source } of env.pendingLinks) {
    const original = link.prepForXml.bind(link);
    link.prepForXml = (context) => {
      const anchor = headingAnchor(env, fragment, source);
      const xml = original(context);
      if (xml && anchor) {
        setHyperlinkAnchor(xml, anchor);
      }
      return xml;
    };
  }
}

function setHyperlinkAnchor(
  xml: NonNullable<ReturnType<InternalHyperlink["prepForXml"]>>,
  anchor: string,
): void {
  const children = xml["w:hyperlink"] as {
    _attr?: Record<string, unknown>;
  }[];
  for (const child of children) if (child._attr) child._attr["w:anchor"] = anchor;
}

/** Replaces each `w:anchor` attribute `retarget` gives a new value for, anywhere in docx's XML. */
function retargetAnchors(
  xml: unknown,
  retarget: (anchor: string) => string | undefined,
): void {
  const stack: unknown[] = [xml];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value !== "object" || value === null) continue;
    const attributes = "_attr" in value ? value._attr : undefined;
    if (
      typeof attributes === "object" &&
      attributes !== null &&
      "w:anchor" in attributes &&
      typeof attributes["w:anchor"] === "string"
    ) {
      attributes["w:anchor"] = retarget(attributes["w:anchor"]) ?? attributes["w:anchor"];
    }
    for (const child of Object.values(value)) stack.push(child);
  }
}

/** Anything docx writes as XML, such as a run, a hyperlink, a paragraph or a table. */
type XmlPart = Pick<InternalHyperlink, "prepForXml">;

/**
 * Points the links docx/html wrote to `fragments`' placeholder anchors at
 * the bookmark of the heading each fragment names, when docx packs, as
 * {@link finalizeLinks} does for Markdown links. A fragment no heading has
 * stays as the anchor, with a warning, as a Markdown link's does.
 */
export function linkHtmlFragments(
  env: RenderEnv,
  parts: readonly XmlPart[],
  fragments: ReadonlyMap<string, string>,
): void {
  if (fragments.size === 0) return;
  const retarget = (anchor: string): string | undefined => {
    const fragment = fragments.get(anchor);
    return fragment === undefined
      ? undefined
      : (headingAnchor(env, fragment, `#${fragment}`) ?? fragment);
  };
  for (const part of parts) {
    const original = part.prepForXml.bind(part);
    part.prepForXml = (context) => {
      const xml = original(context);
      retargetAnchors(xml, retarget);
      return xml;
    };
  }
}
