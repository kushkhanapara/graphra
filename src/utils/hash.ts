import * as crypto from "crypto";

/**
 * Generate an MD5 hash of the given content.
 * Used for cache invalidation of chunk summaries.
 */
export function md5(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}
