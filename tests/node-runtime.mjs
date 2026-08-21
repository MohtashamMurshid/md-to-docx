import assert from "node:assert/strict";
import { File as BufferFile } from "node:buffer";

if (typeof globalThis.File === "undefined" && typeof BufferFile === "function") {
  globalThis.File = BufferFile;
}

const { convertMarkdownToBuffer } = await import("../dist/index.js");

const bytes = await convertMarkdownToBuffer(
  "# Node runtime\n\n- [x] Built package executes",
);

assert.ok(bytes.length > 4, "Node runtime returned an empty document");
assert.equal(
  bytes.subarray(0, 2).toString("ascii"),
  "PK",
  "Node runtime output is not a DOCX ZIP",
);

const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async () => {
  calls += 1;
  return new Response("unexpected", { status: 200 });
};

try {
  const blockedBytes = await convertMarkdownToBuffer(
    "![private](https://127.0.0.1/image.png)",
    { imageHandling: { remote: { enabled: true } } },
  );
  assert.equal(blockedBytes.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(calls, 0, "Node attempted to fetch a blocked private-network image");
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`Node ${process.version} built-package conversion and private-network block passed`);
