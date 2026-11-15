import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type {
  Document as XmlDocument,
  Element as XmlElement,
} from "@xmldom/xmldom";

/** Namespaces and DOM helpers shared by the patch merge stages. */
export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const R =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const REL =
  "http://schemas.openxmlformats.org/package/2006/relationships";
export const CONTENT_TYPES =
  "http://schemas.openxmlformats.org/package/2006/content-types";

/** Field instructions whose bookmark argument follows a renamed bookmark. */
export const BOOKMARK_FIELD = /\b(REF|PAGEREF|NOTEREF)\s+(\S+)/g;

const serializer = new XMLSerializer();

export const xml = (document: XmlDocument | XmlElement): string =>
  serializer.serializeToString(document);

export const parse = (text: string): XmlDocument =>
  new DOMParser({
    onError: (level) => {
      if (level !== "warning") throw new Error("Malformed package XML");
    },
  }).parseFromString(text, "application/xml");

export const elements = (
  root: XmlDocument | XmlElement,
  local: string,
  ns = W,
): XmlElement[] => Array.from(root.getElementsByTagNameNS(ns, local));

export const empty = (root: string, ns = W): XmlDocument =>
  parse(`<w:${root} xmlns:w="${ns}" xmlns:r="${R}"/>`);

export const maxId = (text: string, pattern: RegExp): number => {
  let maximum = 0;
  for (const match of text.matchAll(pattern))
    maximum = Math.max(maximum, Number(match[1]));
  return maximum;
};

/** Concatenated `w:t` text under `root`. */
export const textOf = (root: XmlElement): string =>
  elements(root, "t")
    .map((el) => el.textContent)
    .join("");

/** The element children of `node`, skipping text and comments. */
export const childElements = (node: XmlDocument | XmlElement): XmlElement[] =>
  Array.from(node.childNodes).filter(
    (child) => child.nodeType === 1,
  ) as XmlElement[];

/** Copy every `xmlns:` declaration from `source`'s root onto `target`'s root. */
export function copyNamespaceDeclarations(
  source: XmlDocument,
  target: XmlDocument,
): void {
  const attrs = source.documentElement!.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs.item(i)!;
    if (attr.name.startsWith("xmlns:"))
      target.documentElement!.setAttribute(attr.name, attr.value);
  }
}
