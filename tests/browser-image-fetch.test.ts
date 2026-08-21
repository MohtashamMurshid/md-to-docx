import { describe, expect, it, jest } from "bun:test";
import {
  fetchRemoteImage,
  resolveImageHandlingOptions,
} from "../dist/utils/secureImageFetch.browser.js";

describe("browser remote image policy", () => {
  it("fails closed without issuing a request even when remote images are enabled", async () => {
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected browser fetch"));
    const options = resolveImageHandlingOptions({
      remote: { enabled: true, allowedHosts: ["images.example.com"] },
    });

    await expect(
      fetchRemoteImage("https://images.example.com/image.png", options)
    ).rejects.toThrow("Remote image fetching is unavailable in browsers");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
