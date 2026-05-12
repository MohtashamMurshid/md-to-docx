/**
 * Undici's main export pulls in Fetch/WebIDL helpers that reference global `File`.
 * Node 18 (CI matrix) often lacks `globalThis.File`, which breaks static imports of `undici`
 * during test collection. Prefer `buffer.File` when present (matches Node's Fetch stack).
 */
import { File as BufferFile } from "node:buffer";

if (typeof globalThis.File === "undefined" && typeof BufferFile === "function") {
  globalThis.File = BufferFile;
}
