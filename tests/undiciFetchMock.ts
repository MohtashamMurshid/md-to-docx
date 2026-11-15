import { vi } from "vitest";
import type * as Undici from "undici";

/**
 * Stands in for undici's `fetch`, which the Node image fetcher calls. It
 * rejects by default so no test reaches the network by accident. Install it
 * in a test file with:
 *
 *   vi.mock("undici", async () => (await import("./undiciFetchMock.js")).mockUndiciFetch());
 *
 * and call `remoteFetch.mockReset()` after each test.
 */
export const remoteFetch = vi.fn<typeof Undici.fetch>(() =>
  Promise.reject(new Error("unexpected network fetch"))
);

export async function mockUndiciFetch(): Promise<typeof Undici> {
  const actual = await vi.importActual<typeof Undici>("undici");
  return { ...actual, fetch: remoteFetch };
}

/** Lets one test reach undici's real `fetch`, and with it the real connector. */
export async function useRealUndiciFetch(): Promise<void> {
  const actual = await vi.importActual<typeof Undici>("undici");
  remoteFetch.mockImplementation(actual.fetch);
}
