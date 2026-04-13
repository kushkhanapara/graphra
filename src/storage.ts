import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { Chunk, DependencyGraph } from "./types";

/**
 * SQLite-based storage for Graphra.
 * Replaces the bloated chunks.json with a compact, fast database.
 *
 * Tables:
 *   chunks     — id, file, type, name, signature, code, hash, summary
 *   embeddings — chunk_id, vector (binary float32 blob)
 *   graph      — source_file, target_file
 *   meta       — key, value (for vocabulary, version, etc.)
 */

const CACHE_DIR = ".graphra";
const DB_FILE = path.join(CACHE_DIR, "graphra.db");

let _db: Database.Database | null = null;

/** Get or create the database connection */
export function getDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  _db = new Database(DB_FILE);
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");

  // Create tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      file TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      signature TEXT NOT NULL DEFAULT '',
      code TEXT NOT NULL,
      hash TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      chunk_id TEXT PRIMARY KEY,
      vector BLOB,
      FOREIGN KEY (chunk_id) REFERENCES chunks(id)
    );

    CREATE TABLE IF NOT EXISTS graph (
      source_file TEXT NOT NULL,
      target_file TEXT NOT NULL,
      PRIMARY KEY (source_file, target_file)
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      mtime REAL NOT NULL,
      hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file);
    CREATE INDEX IF NOT EXISTS idx_chunks_name ON chunks(name);
    CREATE INDEX IF NOT EXISTS idx_graph_source ON graph(source_file);
    CREATE INDEX IF NOT EXISTS idx_graph_target ON graph(target_file);
  `);

  return _db;
}

/** Close the database */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ============================================
// Chunk Storage
// ============================================

/** Upsert a chunk into the database */
export function upsertChunk(chunk: Chunk & { signature: string }): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO chunks (id, file, type, name, signature, code, hash, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    chunk.id,
    chunk.file,
    chunk.type,
    chunk.name,
    chunk.signature,
    chunk.code,
    chunk.hash ?? "",
    chunk.summary ?? ""
  );
}

/** Batch upsert chunks (much faster) */
export function upsertChunks(chunks: (Chunk & { signature: string })[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO chunks (id, file, type, name, signature, code, hash, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((items: typeof chunks) => {
    for (const c of items) {
      stmt.run(c.id, c.file, c.type, c.name, c.signature, c.code, c.hash ?? "", c.summary ?? "");
    }
  });

  tx(chunks);
}

/** Get a chunk by ID */
export function getChunk(id: string): (Chunk & { signature: string }) | null {
  const db = getDb();
  return db.prepare("SELECT * FROM chunks WHERE id = ?").get(id) as any;
}

/** Get all chunks */
export function getAllChunks(): (Chunk & { signature: string })[] {
  const db = getDb();
  return db.prepare("SELECT * FROM chunks").all() as any[];
}

/** Get chunk hash for cache checking */
export function getChunkHash(id: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT hash FROM chunks WHERE id = ?").get(id) as any;
  return row?.hash ?? null;
}

/** Get chunk count */
export function getChunkCount(): number {
  const db = getDb();
  return (db.prepare("SELECT COUNT(*) as count FROM chunks").get() as any).count;
}

// ============================================
// Embedding Storage (binary float32 blobs)
// ============================================

/** Store an embedding vector as a binary blob */
export function upsertEmbedding(chunkId: string, vector: number[]): void {
  const db = getDb();
  const buf = Buffer.from(new Float32Array(vector).buffer);
  db.prepare("INSERT OR REPLACE INTO embeddings (chunk_id, vector) VALUES (?, ?)").run(chunkId, buf);
}

/** Batch upsert embeddings */
export function upsertEmbeddings(items: { chunkId: string; vector: number[] }[]): void {
  const db = getDb();
  const stmt = db.prepare("INSERT OR REPLACE INTO embeddings (chunk_id, vector) VALUES (?, ?)");

  const tx = db.transaction((entries: typeof items) => {
    for (const { chunkId, vector } of entries) {
      const buf = Buffer.from(new Float32Array(vector).buffer);
      stmt.run(chunkId, buf);
    }
  });

  tx(items);
}

/** Get an embedding vector */
export function getEmbedding(chunkId: string): number[] | null {
  const db = getDb();
  const row = db.prepare("SELECT vector FROM embeddings WHERE chunk_id = ?").get(chunkId) as any;
  if (!row?.vector) return null;
  return Array.from(new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4));
}

/** Get all embeddings as a map */
export function getAllEmbeddings(): Map<string, number[]> {
  const db = getDb();
  const rows = db.prepare("SELECT chunk_id, vector FROM embeddings").all() as any[];
  const map = new Map<string, number[]>();
  for (const row of rows) {
    if (row.vector) {
      map.set(row.chunk_id, Array.from(new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4)));
    }
  }
  return map;
}

// ============================================
// Graph Storage
// ============================================

/** Save the dependency graph */
export function saveGraph(graph: DependencyGraph): void {
  const db = getDb();
  db.prepare("DELETE FROM graph").run();

  const stmt = db.prepare("INSERT INTO graph (source_file, target_file) VALUES (?, ?)");
  const tx = db.transaction((g: DependencyGraph) => {
    for (const [source, targets] of Object.entries(g)) {
      for (const target of targets) {
        stmt.run(source, target);
      }
    }
  });

  tx(graph);
}

/** Load the dependency graph */
export function loadGraph(): DependencyGraph {
  const db = getDb();
  const rows = db.prepare("SELECT source_file, target_file FROM graph").all() as any[];
  const graph: DependencyGraph = {};
  for (const row of rows) {
    if (!graph[row.source_file]) graph[row.source_file] = [];
    graph[row.source_file].push(row.target_file);
  }
  return graph;
}

// ============================================
// Meta Storage
// ============================================

export function setMeta(key: string, value: string): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
}

export function getMeta(key: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as any;
  return row?.value ?? null;
}

// ============================================
// File Tracking (for incremental re-indexing)
// ============================================

/** Get stored mtime for a file */
export function getFileMtime(filePath: string): number | null {
  const db = getDb();
  const row = db.prepare("SELECT mtime FROM files WHERE path = ?").get(filePath) as any;
  return row?.mtime ?? null;
}

/** Upsert file tracking info */
export function upsertFile(filePath: string, mtime: number, hash: string): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO files (path, mtime, hash) VALUES (?, ?, ?)").run(filePath, mtime, hash);
}

/** Get all tracked file paths */
export function getTrackedFiles(): string[] {
  const db = getDb();
  return (db.prepare("SELECT path FROM files").all() as any[]).map((r) => r.path);
}

/** Remove a file and all its chunks/embeddings */
export function removeFile(filePath: string): void {
  const db = getDb();
  // Get chunk IDs for this file
  const chunkIds = (db.prepare("SELECT id FROM chunks WHERE file = ?").all(filePath) as any[]).map((r) => r.id);
  // Delete embeddings for those chunks
  if (chunkIds.length > 0) {
    const placeholders = chunkIds.map(() => "?").join(",");
    db.prepare(`DELETE FROM embeddings WHERE chunk_id IN (${placeholders})`).run(...chunkIds);
  }
  // Delete chunks
  db.prepare("DELETE FROM chunks WHERE file = ?").run(filePath);
  // Delete file record
  db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
}

/** Remove chunks for a file (before re-inserting updated ones).
 *  Uses LIKE matching to handle both relative and absolute paths. */
export function removeChunksForFile(filePath: string): void {
  const db = getDb();
  // Match by exact path OR by path ending (handles relative vs absolute)
  const chunkIds = (db.prepare(
    "SELECT id FROM chunks WHERE file = ? OR file LIKE ?"
  ).all(filePath, `%${filePath.replace(/\\/g, "/")}`) as any[]).map((r) => r.id);
  if (chunkIds.length > 0) {
    const placeholders = chunkIds.map(() => "?").join(",");
    db.prepare(`DELETE FROM embeddings WHERE chunk_id IN (${placeholders})`).run(...chunkIds);
    db.prepare(`DELETE FROM chunks WHERE id IN (${placeholders})`).run(...chunkIds);
  }
}

/** Get chunk IDs that have no embedding yet */
export function getChunksWithoutEmbeddings(): string[] {
  const db = getDb();
  return (db.prepare(
    "SELECT c.id FROM chunks c LEFT JOIN embeddings e ON c.id = e.chunk_id WHERE e.chunk_id IS NULL"
  ).all() as any[]).map((r) => r.id);
}

/** Clear all data (for full regeneration) */
export function clearAll(): void {
  const db = getDb();
  db.exec("DELETE FROM embeddings; DELETE FROM chunks; DELETE FROM graph; DELETE FROM meta; DELETE FROM files;");
}
