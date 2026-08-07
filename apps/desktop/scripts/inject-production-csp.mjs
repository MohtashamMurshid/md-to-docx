import fs from "node:fs/promises";

const indexPath = new URL("../dist/index.html", import.meta.url);
const csp = [
  "default-src 'self' file:",
  "script-src 'self' file:",
  "style-src 'self' file:",
  "img-src 'self' file: data: blob:",
  "font-src 'self' file:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

const html = await fs.readFile(indexPath, "utf8");
if (!html.includes("<head>")) throw new Error("Built index.html has no <head> element");
if (html.includes("Content-Security-Policy")) throw new Error("Built index.html already contains a CSP");
const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
await fs.writeFile(indexPath, html.replace("<head>", `<head>\n    ${meta}`));
