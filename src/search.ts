/**
 * Hybrid Search Engine — combines:
 *   1. Neural embeddings (TransformersJS all-MiniLM-L6-v2) for semantic search
 *   2. BM25 full-text search for exact keyword matching
 *   3. PageRank importance scores from the dependency graph
 *
 * All 100% local, zero API keys.
 */

import { Chunk, DependencyGraph, SearchResult } from "./types";
import { getAllChunks, getAllEmbeddings, getDb } from "./storage";

// ============================================
// BM25 Full-Text Search
// ============================================

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "between", "out", "off", "over", "under",
  "again", "then", "once", "here", "there", "when", "where", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other", "some",
  "no", "nor", "not", "only", "so", "than", "too", "very", "just",
  "because", "but", "and", "or", "if", "while", "that", "this", "it",
  "its", "which", "what", "who", "whom", "these", "those",
]);

/** Tokenize text for BM25 — split camelCase, lowercase, remove stopwords */
function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** BM25 scoring parameters */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

interface BM25Doc {
  id: string;
  tokens: string[];
  length: number;
}

/** Compute BM25 scores for a query against a set of documents */
function bm25Search(
  queryTokens: string[],
  docs: BM25Doc[],
  topK: number
): Map<string, number> {
  const N = docs.length;
  const avgDl = docs.reduce((sum, d) => sum + d.length, 0) / (N || 1);

  // Document frequency for each term
  const df = new Map<string, number>();
  for (const doc of docs) {
    const uniqueTerms = new Set(doc.tokens);
    for (const term of uniqueTerms) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  // Score each document
  const scores = new Map<string, number>();
  for (const doc of docs) {
    let score = 0;
    const termFreq = new Map<string, number>();
    for (const t of doc.tokens) {
      termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    }

    for (const qt of queryTokens) {
      const tf = termFreq.get(qt) ?? 0;
      if (tf === 0) continue;

      const docFreq = df.get(qt) ?? 0;
      const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
      const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / avgDl)));

      score += idf * tfNorm;
    }

    if (score > 0) {
      scores.set(doc.id, score);
    }
  }

  return scores;
}

// ============================================
// PageRank Importance
// ============================================

/**
 * Compute PageRank scores for files in the dependency graph.
 * Files that are imported by many other files get higher scores.
 */
export function computePageRank(
  graph: DependencyGraph,
  damping: number = 0.85,
  iterations: number = 20
): Map<string, number> {
  const files = new Set<string>();
  for (const [src, targets] of Object.entries(graph)) {
    files.add(src);
    for (const t of targets) files.add(t);
  }

  const N = files.size;
  if (N === 0) return new Map();

  // Initialize scores
  const scores = new Map<string, number>();
  for (const f of files) scores.set(f, 1 / N);

  // Build reverse graph (who imports this file?)
  const reverseGraph = new Map<string, string[]>();
  for (const f of files) reverseGraph.set(f, []);
  for (const [src, targets] of Object.entries(graph)) {
    for (const t of targets) {
      reverseGraph.get(t)?.push(src);
    }
  }

  // Outgoing link count
  const outCount = new Map<string, number>();
  for (const [src, targets] of Object.entries(graph)) {
    outCount.set(src, targets.length);
  }

  // Iterate
  for (let i = 0; i < iterations; i++) {
    const newScores = new Map<string, number>();
    for (const f of files) {
      let sum = 0;
      for (const src of reverseGraph.get(f) ?? []) {
        sum += (scores.get(src) ?? 0) / (outCount.get(src) ?? 1);
      }
      newScores.set(f, (1 - damping) / N + damping * sum);
    }
    for (const [f, s] of newScores) scores.set(f, s);
  }

  return scores;
}

// ============================================
// Cosine Similarity
// ============================================

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ============================================
// Hybrid Search
// ============================================

export interface HybridSearchOptions {
  topK?: number;
  bm25Weight?: number;
  embeddingWeight?: number;
  pageRankWeight?: number;
  nameBoost?: number;
  gitRecencyWeight?: number;
}

// ============================================
// Git Recency Scoring
// ============================================

/**
 * Get git recency scores for files — recently modified files rank higher.
 * Uses `git log` to get last commit timestamp per file.
 */
export function getGitRecencyScores(files: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  try {
    const { execSync } = require("child_process");
    // Get last commit time for each tracked file
    const output = execSync(
      'git log --format="%at %H" --name-only --diff-filter=ACMR -n 200',
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
    );

    const now = Date.now() / 1000;
    const lines = output.split("\n");
    let currentTimestamp = 0;

    for (const line of lines) {
      const tsMatch = line.match(/^(\d+)\s+[a-f0-9]+$/);
      if (tsMatch) {
        currentTimestamp = parseInt(tsMatch[1]);
        continue;
      }
      const filePath = line.trim();
      if (filePath && currentTimestamp && !scores.has(filePath)) {
        // Decay: files modified recently get higher scores
        // Score = 1.0 for today, ~0.5 for 7 days ago, ~0.1 for 30 days ago
        const ageInDays = (now - currentTimestamp) / 86400;
        const recency = Math.exp(-ageInDays / 10); // exponential decay, half-life ~7 days
        scores.set(filePath, recency);
      }
    }
  } catch {
    // Git not available or not a git repo — skip recency
  }
  return scores;
}

/**
 * Hybrid search combining BM25 + neural embeddings + PageRank.
 *
 * @param query - The search query
 * @param queryEmbedding - Pre-computed embedding for the query (or null to skip)
 * @param graph - Dependency graph for PageRank
 * @param options - Tuning parameters
 */
export function hybridSearch(
  query: string,
  queryEmbedding: number[] | null,
  graph: DependencyGraph,
  options: HybridSearchOptions = {}
): SearchResult[] {
  const {
    topK = 10,
    bm25Weight = 0.30,
    embeddingWeight = 0.40,
    pageRankWeight = 0.10,
    nameBoost = 0.10,
    gitRecencyWeight = 0.10,
  } = options;

  const chunks = getAllChunks();
  if (chunks.length === 0) return [];

  const embeddings = getAllEmbeddings();
  const pageRankScores = computePageRank(graph);
  const gitScores = getGitRecencyScores(chunks.map((c) => c.file));

  // --- BM25 ---
  const queryTokens = tokenize(query);
  const bm25Docs: BM25Doc[] = chunks.map((c) => {
    const text = `${c.name} ${c.signature} ${c.summary}`;
    const tokens = tokenize(text);
    return { id: c.id, tokens, length: tokens.length };
  });
  const bm25Scores = bm25Search(queryTokens, bm25Docs, topK * 3);

  // Normalize BM25 scores to 0-1
  const maxBm25 = Math.max(...Array.from(bm25Scores.values()), 0.001);

  // --- Combine scores ---
  const finalScores: { chunk: Chunk; score: number }[] = [];

  for (const chunk of chunks) {
    let score = 0;

    // BM25 component
    const bm25 = (bm25Scores.get(chunk.id) ?? 0) / maxBm25;
    score += bm25 * bm25Weight;

    // Embedding component
    if (queryEmbedding && embeddings.has(chunk.id)) {
      const chunkEmb = embeddings.get(chunk.id)!;
      const sim = cosineSimilarity(queryEmbedding, chunkEmb);
      score += sim * embeddingWeight;
    }

    // PageRank component (file-level importance)
    const fileRank = pageRankScores.get(chunk.file) ?? 0;
    const maxRank = Math.max(...Array.from(pageRankScores.values()), 0.001);
    score += (fileRank / maxRank) * pageRankWeight;

    // Git recency component
    // Try matching by relative path fragments
    const fileShort = chunk.file.replace(/\\/g, "/");
    let gitRecency = 0;
    for (const [gitFile, recency] of gitScores) {
      if (fileShort.endsWith(gitFile) || gitFile.endsWith(fileShort.split("/").slice(-2).join("/"))) {
        gitRecency = recency;
        break;
      }
    }
    score += gitRecency * gitRecencyWeight;

    // Name match boost
    const nameParts = chunk.name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\./g, " ")
      .toLowerCase()
      .split(/\s+/);
    for (const qt of queryTokens) {
      if (nameParts.some((np) => np === qt || np.includes(qt))) {
        score += nameBoost;
      }
    }

    if (score > 0) {
      finalScores.push({ chunk: chunk as Chunk, score });
    }
  }

  finalScores.sort((a, b) => b.score - a.score);
  return finalScores.slice(0, topK);
}
