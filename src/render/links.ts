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

/**
 * Hyperlink targets are restricted to a scheme allowlist so a malicious
 * document cannot embed e.g. file:// UNC links (NTLM credential leak when
 * clicked in Word on Windows) or other unexpected protocol handlers.
 * Relative/fragment targets resolve against the dummy base and inherit its
 * safe scheme; targets the URL parser rejects outright fail closed because
 * Word may still treat the raw string as an active hyperlink.
 */
function isSafeLinkUrl(url: string): boolean {
  let protocol: string;
  try {
    protocol = new URL(url, "https://relative-link.invalid/").protocol;
  } catch {
    return false;
  }
  return SAFE_LINK_PROTOCOLS.has(protocol.toLowerCase());
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    // Keep literal malformed escapes.
    return fragment;
  }
}

/** A link to a heading. Its anchor is filled in by {@link finalizeLinks}. */
function internalLink(
  env: RenderEnv,
  node: DocxTextNode,
  source: string,
  overrides: InlineOverrides,
): InternalHyperlink {
  const fragment = decodeFragment(source.slice(1));
  const link = new InternalHyperlink({
    anchor: fragment,
    children: [textRunFromNode(env, node, overrides)],
  });
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
  if (node.link.startsWith("#")) {
    return internalLink(env, node, node.link, overrides);
  }
  if (!isSafeLinkUrl(node.link)) {
    const { link: _unsafeLink, ...plainNode } = node;
    return textRunFromNode(env, plainNode, overrides);
  }
  return externalLink(env, node, node.link, overrides);
}

/**
 * Links may point forward or into a later section. Resolve when docx packs,
 * after every heading has been rendered, using its public XML hook.
 */
export function finalizeLinks(env: RenderEnv): void {
  for (const { link, fragment, source } of env.pendingLinks) {
    const original = link.prepForXml.bind(link);
    link.prepForXml = (context) => {
      const anchor = env.headingAnchors.anchors.get(fragment);
      if (!anchor)
        env.options.onWarning?.({
          code: "UNRESOLVED_LINK",
          message: `No heading matches ${source}`,
          source,
        });
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
