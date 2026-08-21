import assert from "node:assert/strict";
import {
  convertMarkdownToBuffer,
  MarkdownConversionError,
} from "../dist/index.js";
import JSZip from "jszip";

const ONE_PX_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/vk9yBgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function assertDocx(bytes, label) {
  assert.ok(bytes.length > 4, `${label} returned an empty document`);
  assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK", `${label} is not a DOCX ZIP`);
}

async function assertBasicConversion() {
  const bytes = await convertMarkdownToBuffer("# Bun runtime\n\n- [x] Works");
  assertDocx(bytes, "basic Bun conversion");
}

async function assertNodeSecureImageAdapter() {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let sawPinnedDispatcher = false;

  globalThis.fetch = async (_input, init) => {
    calls += 1;
    sawPinnedDispatcher = Boolean(init?.dispatcher);
    return new Response(ONE_PX_PNG, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(ONE_PX_PNG.byteLength),
      },
    });
  };

  try {
    const bytes = await convertMarkdownToBuffer(
      "![Bun image](https://93.184.216.34/image.png)",
      { imageHandling: { remote: { enabled: true } } },
    );
    assertDocx(bytes, "Bun remote-image conversion");
    assert.equal(calls, 1, "Bun did not execute the Node secure image adapter");
    assert.equal(sawPinnedDispatcher, true, "Bun secure fetch did not pass the pinned Undici dispatcher");

    const zip = await JSZip.loadAsync(bytes);
    const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/"));
    assert.ok(media.length >= 1, "Bun did not embed the fetched image");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function assertAbortPropagation() {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();

  globalThis.fetch = (_input, init) => {
    setTimeout(() => controller.abort(new Error("Bun caller cancelled")), 0);
    return new Promise((_resolve, reject) => {
      const rejectAbort = () => reject(new DOMException("The operation was aborted", "AbortError"));
      if (init?.signal?.aborted) rejectAbort();
      else init?.signal?.addEventListener("abort", rejectAbort, { once: true });
    });
  };

  try {
    await assert.rejects(
      convertMarkdownToBuffer(
        "![Bun abort](https://93.184.216.34/image.png)",
        {
          imageHandling: { remote: { enabled: true } },
          signal: controller.signal,
        },
      ),
      (error) =>
        error instanceof MarkdownConversionError &&
        error.message === "Markdown conversion was aborted",
      "Bun did not propagate caller cancellation",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

await assertBasicConversion();
await assertNodeSecureImageAdapter();
await assertAbortPropagation();
console.log("Bun 1.4 runtime conversion, secure image adapter, and abort propagation passed");
