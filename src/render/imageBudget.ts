import type { RenderEnv } from "./context.js";

/*
 * maxImages caps successful embeds only (so broken images cannot starve valid
 * ones of budget), but failed *remote* attempts still cost up to
 * fetchTimeoutMs each. Failures get their own equal budget so a document full
 * of broken or slow URLs cannot trigger unbounded sequential fetches.
 */

/** Whether the document has embedded as many images as `maxImages` allows. */
export function imageBudgetReached(env: RenderEnv): boolean {
  return env.processedImageCounter.count >= env.imageHandling.maxImages;
}

export function isRemoteImageUrl(url: string): boolean {
  return !/^data:/i.test(url);
}

/** Whether a remote image would exceed the budget for failed remote fetches. */
export function remoteFailureBudgetReached(
  env: RenderEnv,
  remote: boolean,
): boolean {
  return (
    remote && env.failedRemoteImageCounter.count >= env.imageHandling.maxImages
  );
}

/** Charges one image attempt to the budget it used. */
export function countImageAttempt(
  env: RenderEnv,
  embedded: boolean,
  remote: boolean,
): void {
  if (embedded) env.processedImageCounter.count++;
  else if (remote) env.failedRemoteImageCounter.count++;
}
