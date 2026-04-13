/**
 * Neural Embedder — uses TransformersJS (all-MiniLM-L6-v2) for local embeddings.
 *
 * Produces 384-dimensional vectors that understand semantic meaning:
 *   "authentication" ≈ "login" ≈ "sign in"
 *
 * 100% local, no API keys, runs in Node.js.
 * First call downloads the model (~23MB), subsequent calls use the cache.
 */

let pipeline: any = null;
let extractor: any = null;

/** Initialize the embedding model (lazy, first call downloads) */
async function getExtractor() {
  if (extractor) return extractor;

  // Dynamic import for ESM compatibility
  const { pipeline: createPipeline } = await import("@xenova/transformers");
  extractor = await createPipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    quantized: true, // Use quantized model for speed
  });

  return extractor;
}

/**
 * Generate a 384-dim embedding vector for a text string.
 * Uses all-MiniLM-L6-v2 — same model as Continue.dev.
 */
export async function embed(text: string): Promise<number[]> {
  const ext = await getExtractor();
  const output = await ext(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/**
 * Batch embed multiple texts (more efficient than one-by-one).
 */
export async function embedBatch(texts: string[], batchSize: number = 32): Promise<number[][]> {
  const ext = await getExtractor();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    for (const text of batch) {
      const output = await ext(text, { pooling: "mean", normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
  }

  return results;
}

/** Check if the model is already cached */
export async function isModelCached(): Promise<boolean> {
  try {
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");
    const cacheDir = path.join(os.homedir(), ".cache", "huggingface");
    return fs.existsSync(cacheDir);
  } catch {
    return false;
  }
}
