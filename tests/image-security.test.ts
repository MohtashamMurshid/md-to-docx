import { afterEach, describe, expect, it, vi } from "vitest";
import { convertMarkdownToDocx } from "../src/index.js";
import type { Options } from "../src/types.js";
import { at, getDocumentXml, getZip } from "./helpers.js";
import { isBlockedIpAddress } from "../src/utils/blockedAddresses.js";

// Every lookup is observed, and real unless a test stubs it, so literal
// addresses can be shown to skip DNS.
const dnsLookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns/promises")>();
  dnsLookup.mockImplementation(actual.lookup);
  return { ...actual, lookup: dnsLookup };
});

async function withDnsStubbed(run: () => Promise<void>): Promise<void> {
  const actual = await vi.importActual<typeof import("node:dns/promises")>("node:dns/promises");
  dnsLookup.mockReset().mockRejectedValue(new Error("unexpected DNS lookup"));
  try {
    await run();
  } finally {
    dnsLookup.mockReset().mockImplementation(actual.lookup);
  }
}

const ONE_PX_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/vk9yBgAAAABJRU5ErkJggg==";

/** Matches fallback paragraphs from `processImage` (`displayed`) or `modelToDocx` (`loaded`). */
const IMAGE_FALLBACK = /Image could not be (displayed|loaded)/;
const IMAGE_FALLBACK_GLOBAL = /Image could not be (displayed|loaded)/g;

function expectImageFallback(xml: string): void {
  expect(xml).toMatch(IMAGE_FALLBACK);
}

async function render(markdown: string, options?: Options): Promise<string> {
  const blob = await convertMarkdownToDocx(markdown, options);
  return getDocumentXml(blob);
}

async function mediaCount(markdown: string, options?: Options): Promise<number> {
  const blob = await convertMarkdownToDocx(markdown, options);
  const zip = await getZip(blob);
  return Object.entries(zip.files).filter(
    ([p, file]) =>
      p.startsWith("word/media/") &&
      !file.dir &&
      !p.endsWith("/")
  ).length;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Image security", () => {
  it("rejects remote images by default", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render("![remote](https://example.com/image.png)");

    expect(fetchSpy).not.toHaveBeenCalled();
    expectImageFallback(xml);
    expect(await mediaCount("![remote](https://example.com/image.png)")).toBe(0);
  });

  it("rejects http URLs even when remote image fetching is enabled", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render("![remote](http://93.184.216.34/image.png)", {
      imageHandling: { remote: { enabled: true } },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expectImageFallback(xml);
  });

  it("rejects loopback and private-network addresses before fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render("![remote](https://127.0.0.1/image.png)", {
      imageHandling: { remote: { enabled: true } },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expectImageFallback(xml);
  });

  it("rejects IPv4-mapped IPv6 private addresses before fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render("![remote](https://[::ffff:192.168.1.10]/image.png)", {
      imageHandling: { remote: { enabled: true } },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expectImageFallback(xml);
  });

  it("rejects hex IPv4-mapped IPv6 hostnames before fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render("![remote](https://[::ffff:c0a8:010a]/image.png)", {
      imageHandling: { remote: { enabled: true } },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expectImageFallback(xml);
  });

  it("rejects uncompressed IPv6-mapped private addresses before fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render(
      "![remote](https://[0:0:0:0:0:ffff:c0a8:010a]/image.png)",
      {
        imageHandling: { remote: { enabled: true } },
      }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expectImageFallback(xml);
  });

  it.each([
    { host: "[fe81::1]", fetched: false },
    { host: "[::1]", fetched: false },
    { host: "[::ffff:7f00:1]", fetched: false },
    { host: "[2606:4700:4700::1111]", fetched: true },
  ])("checks the IPv6 literal $host itself, without DNS", async ({ host, fetched }) => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("stubbed fetch"));

    await withDnsStubbed(async () => {
      const xml = await render(`![remote](https://${host}/a.png)`, {
        imageHandling: { remote: { enabled: true } },
      });

      expect(dnsLookup).not.toHaveBeenCalled();
      expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(
        fetched ? [`https://${host}/a.png`] : [],
      );
      expectImageFallback(xml);
    });
  });

  it("rejects oversized data URLs before embedding", async () => {
    const oversizedPayload = "A".repeat(128);
    const xml = await render(
      `![too large](data:image/png;base64,${oversizedPayload})`,
      {
        imageHandling: { maxImageBytes: 16 },
      }
    );

    expectImageFallback(xml);
    expect(
      await mediaCount(`![too large](data:image/png;base64,${oversizedPayload})`, {
        imageHandling: { maxImageBytes: 16 },
      })
    ).toBe(0);
  });

  it("rejects remote images with oversized content-length", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 200,
        headers: {
          "content-length": "128",
          "content-type": "image/png",
        },
      })
    );

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: {
        remote: { enabled: true },
        maxImageBytes: 16,
      },
    });

    expectImageFallback(xml);
  });

  it("rejects remote images that exceed the streamed byte cap", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(12));
        controller.enqueue(new Uint8Array(12));
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      })
    );

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: {
        remote: { enabled: true },
        maxImageBytes: 16,
      },
    });

    expectImageFallback(xml);
  });

  it("re-checks redirected remote image targets", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 302,
        headers: {
          location: "https://127.0.0.1/private.png",
        },
      })
    );

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: {
        remote: { enabled: true },
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expectImageFallback(xml);
  });

  it("stops following redirects after maxRedirects", async () => {
    let fetchCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      fetchCalls += 1;
      expect(init?.redirect).toBe("manual");
      return Promise.resolve(
        new Response("", {
          status: 302,
          headers: {
            location: `https://93.184.216.34/step-${fetchCalls}.png`,
          },
        }) as never
      );
    });

    const xml = await render("![remote](https://93.184.216.34/start.png)", {
      imageHandling: {
        remote: { enabled: true },
        maxRedirects: 3,
      },
    });

    expect(fetchCalls).toBe(4);
    expectImageFallback(xml);
  });

  it("aborts slow remote image fetches", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      });
    });

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: {
        remote: { enabled: true },
        fetchTimeoutMs: 1,
      },
    });

    expectImageFallback(xml);
  });

  it("aborts slow remote image response bodies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start() {
            /* never enqueue — reader.read() blocks until aborted */
          },
        }),
        { status: 200, headers: { "content-type": "image/png" } }
      )
    );

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: {
        remote: { enabled: true },
        fetchTimeoutMs: 80,
      },
    });

    expectImageFallback(xml);
  });

  it("does not count failed images toward maxImages", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));

    const markdown = `![blocked](https://127.0.0.1/a.png)

![blocked](https://127.0.0.1/b.png)

![ok](${ONE_PX_PNG})`;

    const xml = await render(markdown, {
      imageHandling: { remote: { enabled: true }, maxImages: 1 },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xml.match(/<w:drawing>/g)).toHaveLength(1);
    expect(xml.match(IMAGE_FALLBACK_GLOBAL)).toHaveLength(2);
  });

  it("stops attempting remote fetches once the failed-image budget is spent", async () => {
    let fetchCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      fetchCalls += 1;
      return Promise.reject(new Error("connection refused"));
    });

    const markdown = Array.from(
      { length: 6 },
      (_, i) => `![broken](https://93.184.216.34/missing-${i}.png)`
    ).join("\n\n");

    const xml = await render(markdown, {
      imageHandling: { remote: { enabled: true }, maxImages: 2 },
    });

    // Failed remote attempts get an equal budget to maxImages; once spent,
    // remaining images fall back without performing network fetches.
    expect(fetchCalls).toBe(2);
    expect(xml.match(IMAGE_FALLBACK_GLOBAL)).toHaveLength(6);
  });

  it("denies every remote host when an empty allowedHosts list is provided", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: { remote: { enabled: true, allowedHosts: [] } },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expectImageFallback(xml);
  });

  it("still fetches hosts present in the allowedHosts list", async () => {
    const pngBytes = Buffer.from(at(ONE_PX_PNG.split(","), 1), "base64");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(pngBytes), {
        status: 200,
        headers: { "content-type": "image/png" },
      })
    );

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: {
        remote: { enabled: true, allowedHosts: ["93.184.216.34"] },
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(xml).toContain("<w:drawing>");
  });

  it("continues to embed valid data URL images by default", async () => {
    const xml = await render(`![one px](${ONE_PX_PNG})`);

    expect(xml).toContain("<w:drawing>");
    expect(await mediaCount(`![one px](${ONE_PX_PNG})`)).toBeGreaterThan(0);
  });

  it("enforces the maximum image count", async () => {
    const markdown = `![one](${ONE_PX_PNG})

![two](${ONE_PX_PNG})`;

    const xml = await render(markdown, { imageHandling: { maxImages: 1 } });
    expect(xml.match(/<w:drawing>/g)).toHaveLength(1);
    expect(await mediaCount(markdown, { imageHandling: { maxImages: 1 } })).toBe(
      1
    );
    expectImageFallback(xml);
  });

  it("applies maximum image count across document sections", async () => {
    const ONE = `![one](${ONE_PX_PNG})`;
    const TWO = `![two](${ONE_PX_PNG})`;

    const xml = await render("", {
      imageHandling: { maxImages: 1 },
      sections: [{ markdown: ONE }, { markdown: TWO }],
    });

    expect(xml.match(/<w:drawing>/g)).toHaveLength(1);
    expect(
      await mediaCount("", {
        imageHandling: { maxImages: 1 },
        sections: [{ markdown: ONE }, { markdown: TWO }],
      })
    ).toBe(1);
    expectImageFallback(xml);
  });
});

describe("address classification for resolved remote image hosts", () => {
  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::",
    "::127.0.0.1",
    "::ffff:127.0.0.1",
    "0:0:0:0:0:ffff:7f00:1",
    "fe80::1",
    "fe90::1",
    "febf:ffff::1",
    "fe80::1%eth0",
    "fec0::1",
    "fd12:3456::1",
    "ff02::1",
    "00fc::1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1::1",
    "2002:a00:1::1",
    "2001:0:4136:e378::1",
    "2001:db8::1",
    "3fff::1",
    "3fff:fff:ffff::1",
    "2001:2::1",
    "2001:2:0:ffff::1",
    "2001:10::1",
    "2001:1f:ffff::1",
    "2001:20::1",
    "2001:2f:ffff::1",
    "192.0.0.8",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "192.88.99.1",
    "::ffff:192.0.2.1",
    "64:ff9b::c633:6401",
    "2002:cb00:7101::1",
    "::ffff:c058:6301",
  ])("blocks %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "2606:4700:4700::1111",
    "2a00:1450:4001::200e",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "2002:808:808::1",
    "192.0.1.1",
    "192.0.3.1",
    "198.51.101.1",
    "203.0.114.1",
    "192.88.98.1",
    "2001:3::1",
    "2001:4860:4860::8888",
  ])("allows public %s", (address) => {
    expect(isBlockedIpAddress(address)).toBe(false);
  });
});
