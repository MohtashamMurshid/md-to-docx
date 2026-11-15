import JSZip from "jszip";
import type {
  PatchMarkdownOptions,
  ReferenceDocxBytes,
  ReferenceDocxInput,
} from "./types.js";
import { loadReferenceDocx } from "./referenceDocx.js";
import { throwIfAborted } from "./processingLimits.js";
import { createPatchMergeState, type PatchMergeInput } from "./patch/state.js";
import {
  importDonorRelationships,
  mergeDonorDefinitionParts,
  remapDonorIds,
} from "./patch/donor.js";
import {
  replacePlaceholders,
  splitDonorFragments,
} from "./patch/placeholders.js";
import {
  enableUpdateFieldsWhenNeeded,
  fillCachedFieldValues,
  mergeContentTypes,
  renumberBookmarksAndDrawings,
  serializePatchedPackage,
} from "./patch/finalize.js";

/** Load the template through the reference DOCX validator, whatever form its bytes take. */
export async function loadPatchPackage(
  input: ReferenceDocxInput,
  signal?: AbortSignal,
): Promise<JSZip> {
  const bytes = await patchReferenceBytes(input);
  return (await loadReferenceDocx(bytes, {}, signal)).zip;
}

async function patchReferenceBytes(
  input: ReferenceDocxInput,
): Promise<ReferenceDocxBytes> {
  if (isReferenceDocxBytes(input)) return input;
  if (typeof input === "string")
    return Uint8Array.from(input, (char) => char.charCodeAt(0));
  if (Array.isArray(input)) return Uint8Array.from(input);
  if (input instanceof JSZip)
    return input.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  throw new Error("Patch reference must contain in-memory DOCX bytes");
}

function isReferenceDocxBytes(
  input: ReferenceDocxInput,
): input is ReferenceDocxBytes {
  return (
    input instanceof Uint8Array ||
    input instanceof ArrayBuffer ||
    input instanceof Blob
  );
}

/**
 * Merge generated package dependencies before inserting already-rendered XML.
 * Each stage reads and updates one `PatchMergeState`, in this order.
 */
export async function mergePatchPackage(
  base: JSZip,
  donorBytes: Uint8Array,
  { markers, names }: Pick<PatchMergeInput, "markers" | "names">,
  options: PatchMarkdownOptions,
): Promise<Uint8Array> {
  throwIfAborted(options.signal);
  const donor = await JSZip.loadAsync(donorBytes);
  const state = await createPatchMergeState({
    base,
    donor,
    markers,
    names,
    options,
  });
  remapDonorIds(state);
  await importDonorRelationships(state);
  mergeDonorDefinitionParts(state);
  splitDonorFragments(state);
  replacePlaceholders(state);
  fillCachedFieldValues(state);
  renumberBookmarksAndDrawings(state);
  mergeContentTypes(state);
  enableUpdateFieldsWhenNeeded(state);
  return serializePatchedPackage(state);
}
