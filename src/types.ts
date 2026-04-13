// ============================================
// Graphra — Core Type Definitions (v2)
// ============================================

/** Configuration for file scanning */
export interface ScanConfig {
  include: string[];
  ignore: string[];
}

/** A code chunk extracted from AST parsing */
export interface Chunk {
  /** Unique identifier: file#name */
  id: string;
  /** Source file path */
  file: string;
  /** Type of code element */
  type: "function" | "class" | "method" | "arrow-function" | "export" | "interface" | "type-alias" | "constant";
  /** Name of the code element */
  name: string;
  /** Raw source code */
  code: string;
  /** Actual code signature (declaration line) — Aider-style */
  signature?: string;
  /** MD5 hash of the code (for cache invalidation) */
  hash?: string;
  /** Text summary (local or AI-generated) */
  summary?: string;
  /** Embedding vector */
  embedding?: number[];
}

/** Cached chunk data stored in .graphra/ (legacy, kept for migration) */
export interface ChunkCache {
  [chunkId: string]: {
    hash: string;
    summary: string;
    embedding: number[];
  };
}

/** Dependency graph: file → list of imported files */
export interface DependencyGraph {
  [file: string]: string[];
}

/** Context output assembled for prompt building */
export interface ContextResult {
  /** Actual code signatures (Aider-style) — the primary context */
  entries: {
    chunkId: string;
    file: string;
    name: string;
    signature: string;
    summary: string;
    importance: number;
  }[];
}

/** Final prompt structure */
export interface PromptData {
  arch: string;
  context: string;
  task: string;
}

/** Search result from hybrid search */
export interface SearchResult {
  chunk: Chunk;
  score: number;
}
