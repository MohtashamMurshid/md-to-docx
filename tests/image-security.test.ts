import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { convertMarkdownToDocx } from "../src/index";
import type { Options } from "../src/types";
import { getDocumentXml, getZip } from "./helpers";

const ONE_PX_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAGgwJ/vk9yBgAAAABJRU5ErkJggg==";

async function render(markdown: string, options?: Options): Promise<string> {
  const blob = await convertMarkdownToDocx(markdown, options);
  return getDocumentXml(blob);
}

async function mediaCount(markdown: string, options?: Options): Promise<number> {
  const blob = await convertMarkdownToDocx(markdown, options);
  const zip = await getZip(blob);
  return Object.keys(zip.files).filter(
    (p) =>
      p.startsWith("word/media/") &&
      !zip.files[p].dir &&
      !p.endsWith("/")
  ).length;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Image security", () => {
  it("rejects remote images by default", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render("![remote](https://example.com/image.png)");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xml).toContain("Image could not be displayed");
    expect(await mediaCount("![remote](https://example.com/image.png)")).toBe(0);
  });

  it("rejects http URLs even when remote image fetching is enabled", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render("![remote](http://93.184.216.34/image.png)", {
      imageHandling: { remote: { enabled: true } },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xml).toContain("Image could not be displayed");
  });

  it("rejects loopback and private-network addresses before fetch", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render("![remote](https://127.0.0.1/image.png)", {
      imageHandling: { remote: { enabled: true } },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xml).toContain("Image could not be displayed");
  });

  it("rejects IPv4-mapped IPv6 private addresses before fetch", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render("![remote](https://[::ffff:192.168.1.10]/image.png)", {
      imageHandling: { remote: { enabled: true } },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xml).toContain("Image could not be displayed");
  });

  it("rejects hex IPv4-mapped IPv6 hostnames before fetch", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render("![remote](https://[::ffff:c0a8:010a]/image.png)", {
      imageHandling: { remote: { enabled: true } },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xml).toContain("Image could not be displayed");
  });

  it("rejects uncompressed IPv6-mapped private addresses before fetch", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected fetch"));
    const xml = await render(
      "![remote](https://[0:0:0:0:0:ffff:c0a8:010a]/image.png)",
      {
        imageHandling: { remote: { enabled: true } },
      }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xml).toContain("Image could not be displayed");
  });

  it("rejects oversized data URLs before embedding", async () => {
    const oversizedPayload = "A".repeat(128);
    const xml = await render(
      `![too large](data:image/png;base64,${oversizedPayload})`,
      {
        imageHandling: { maxImageBytes: 16 },
      }
    );

    expect(xml).toContain("Image could not be displayed");
    expect(
      await mediaCount(`![too large](data:image/png;base64,${oversizedPayload})`, {
        imageHandling: { maxImageBytes: 16 },
      })
    ).toBe(0);
  });

  it("rejects remote images with oversized content-length", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 200,
        headers: {
          "content-length": "128",
          "content-type": "image/png",
        },
      }) as never
    );

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: {
        remote: { enabled: true },
        maxImageBytes: 16,
      },
    });

    expect(xml).toContain("Image could not be displayed");
  });

  it("rejects remote images that exceed the streamed byte cap", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(12));
        controller.enqueue(new Uint8Array(12));
        controller.close();
      },
    });
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: {
          "content-type": "image/png",
        },
      }) as never
    );

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: {
        remote: { enabled: true },
        maxImageBytes: 16,
      },
    });

    expect(xml).toContain("Image could not be displayed");
  });

  it("re-checks redirected remote image targets", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 302,
        headers: {
          location: "https://127.0.0.1/private.png",
        },
      }) as never
    );

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: {
        remote: { enabled: true },
      },
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(xml).toContain("Image could not be displayed");
  });

  it("aborts slow remote image fetches", async () => {
    jest.spyOn(globalThis, "fetch").mockImplementation((_, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        });
      }) as never;
    });

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: {
        remote: { enabled: true },
        fetchTimeoutMs: 1,
      },
    });

    expect(xml).toContain("Image could not be displayed");
  });

  it("aborts slow remote image response bodies", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start() {
            /* never enqueue — reader.read() blocks until aborted */
          },
        }),
        { status: 200, headers: { "content-type": "image/png" } }
      ) as never
    );

    const xml = await render("![remote](https://93.184.216.34/image.png)", {
      imageHandling: {
        remote: { enabled: true },
        fetchTimeoutMs: 80,
      },
    });

    expect(xml).toContain("Image could not be displayed");
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
    expect(xml).toContain("Image could not be loaded");
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
    expect(xml).toContain("Image could not be loaded");
  });
});
