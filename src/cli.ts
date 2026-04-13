#!/usr/bin/env node

import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { scanFiles } from "./scanner";
import { chunkFile } from "./chunker";
import { extractSignature, buildSearchableText } from "./signatureExtractor";
import { embed } from "./neuralEmbedder";
import { buildGraph } from "./graph";
import { hybridSearch, computePageRank } from "./search";
import {
  getDb, closeDb, upsertChunks, upsertEmbeddings,
  saveGraph, loadGraph, getAllChunks, getChunkHash,
  getChunkCount, getFileMtime, upsertFile, getTrackedFiles,
  removeFile, removeChunksForFile, getChunksWithoutEmbeddings,
  clearAll, getChunk,
} from "./storage";
import { Chunk } from "./types";

const program = new Command();

program
  .name("graphra")
  .description("Graphra — the universal code context engine for AI tools")
  .version("2.0.0");

// ============================================
// Init — auto-detect and configure
// ============================================
program
  .command("init")
  .description("Auto-detect project language, framework, and structure")
  .action(() => {
    const { initProject } = require("./init");
    const config = initProject(".");

    console.log("\n🔧 Graphra initialized!\n");
    console.log(`   Language:    ${config.language.join(", ") || "unknown"}`);
    console.log(`   Framework:   ${config.framework.join(", ") || "none detected"}`);
    console.log(`   Structure:   ${config.structure}`);
    console.log(`   Include:     ${config.include.join(", ")}`);
    console.log(`   Entry points: ${config.entryPoints.join(", ") || "none"}`);
    console.log(`\n   Config saved to .graphra/config.json`);
    console.log(`   Run \`Graphra generate\` to index your codebase.\n`);
  });

// ============================================
// Generate
// ============================================
program
  .command("generate")
  .description("Scan, chunk, extract signatures, embed (neural), and build graph")
  .option("-i, --include <patterns...>", "Glob patterns to include")
  .option("-x, --ignore <patterns...>", "Glob patterns to ignore")
  .option("--force", "Full rebuild (ignore cache)")
  .action(async (opts) => {
    try {
      const startTime = Date.now();
      const db = getDb();

      // Force mode: wipe everything
      if (opts.force) {
        console.log("🗑️  Force mode: clearing all data...");
        clearAll();
      }

      console.log("🔍 Scanning files...");
      const files = await scanFiles({
        include: opts.include,
        ignore: opts.ignore,
      });
      console.log(`   Found ${files.length} files`);

      // --- Incremental: detect changed/new/deleted files ---
      const currentFileSet = new Set(files.map((f) => path.resolve(f)));
      const trackedFiles = new Set(getTrackedFiles());

      // Files that were deleted since last run
      const deletedFiles: string[] = [];
      for (const tracked of trackedFiles) {
        if (!currentFileSet.has(tracked)) {
          deletedFiles.push(tracked);
        }
      }

      // Files that are new or changed (mtime differs)
      const changedFiles: string[] = [];
      const unchangedFiles: string[] = [];
      for (const file of files) {
        const resolved = path.resolve(file);
        const currentMtime = fs.statSync(file).mtimeMs;
        const storedMtime = getFileMtime(resolved);

        if (storedMtime === null || currentMtime !== storedMtime) {
          changedFiles.push(file);
        } else {
          unchangedFiles.push(file);
        }
      }

      // Remove deleted files
      if (deletedFiles.length > 0) {
        console.log(`🗑️  Removing ${deletedFiles.length} deleted files...`);
        for (const f of deletedFiles) removeFile(f);
      }

      if (changedFiles.length === 0) {
        console.log("✅ No changes detected — everything is up to date!");
        // Still rebuild graph in case file relationships changed
        console.log("🔗 Rebuilding dependency graph...");
        const graph = buildGraph(files);
        saveGraph(graph);
        closeDb();
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ Done in ${elapsed}s`);
        return;
      }

      console.log(`   📊 ${changedFiles.length} changed, ${unchangedFiles.length} cached, ${deletedFiles.length} deleted`);

      // --- Chunk only changed files ---
      console.log(`🧩 Chunking ${changedFiles.length} changed files...`);
      const newChunks: (Chunk & { signature: string })[] = [];
      for (const file of changedFiles) {
        const resolved = path.resolve(file);
        try {
          // Remove old chunks for this file
          removeChunksForFile(resolved);

          const chunks = chunkFile(file);
          for (const chunk of chunks) {
            const signature = extractSignature(chunk);
            const searchText = buildSearchableText(chunk, signature);
            newChunks.push({
              ...chunk,
              signature,
              summary: searchText,
            });
          }

          // Update file tracking
          const mtime = fs.statSync(file).mtimeMs;
          upsertFile(resolved, mtime, "");
        } catch (err) {
          console.warn(`   ⚠ Skipping ${path.basename(file)}: ${err}`);
        }
      }

      if (newChunks.length > 0) {
        upsertChunks(newChunks);
      }

      const totalChunks = getChunkCount();
      console.log(`   ${newChunks.length} new/updated chunks (${totalChunks} total)`);

      // --- Embed only chunks that need it ---
      const chunksNeedingEmbedding = getChunksWithoutEmbeddings();
      if (chunksNeedingEmbedding.length > 0) {
        console.log(`🧠 Embedding ${chunksNeedingEmbedding.length} new chunks...`);

        const embItems: { chunkId: string; vector: number[] }[] = [];
        for (let i = 0; i < chunksNeedingEmbedding.length; i++) {
          const chunkId = chunksNeedingEmbedding[i];
          const chunk = getChunk(chunkId);
          if (!chunk) continue;

          const text = chunk.summary || chunk.signature || chunk.name;
          try {
            const vector = await embed(text);
            embItems.push({ chunkId, vector });
          } catch {
            // Skip failed
          }

          if ((i + 1) % 50 === 0 || i === chunksNeedingEmbedding.length - 1) {
            process.stdout.write(`\r   Embedded ${i + 1}/${chunksNeedingEmbedding.length}`);
          }
        }
        console.log("");
        upsertEmbeddings(embItems);
        console.log(`   ${embItems.length} embeddings stored`);
      } else {
        console.log("🧠 All embeddings up to date");
      }

      // --- Dependency graph (always rebuild — it's fast) ---
      console.log("🔗 Building dependency graph + PageRank...");
      const graph = buildGraph(files);
      saveGraph(graph);

      const pageRank = computePageRank(graph);
      const topFiles = Array.from(pageRank.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      if (topFiles.length > 0) {
        console.log("   Top files by importance:");
        for (const [file, rank] of topFiles) {
          const short = file.split(/[/\\]/).slice(-2).join("/");
          console.log(`     ${short} (${rank.toFixed(4)})`);
        }
      }

      // DB size
      const dbPath = path.join(".graphra", "graphra.db");
      if (fs.existsSync(dbPath)) {
        const size = fs.statSync(dbPath).size;
        console.log(`\n💾 DB size: ${(size / 1024 / 1024).toFixed(1)}MB`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Done in ${elapsed}s`);
      closeDb();
    } catch (err) {
      console.error("❌ Generate failed:", err);
      closeDb();
      process.exit(1);
    }
  });

// ============================================
// Search
// ============================================
program
  .command("search <query>")
  .description("Hybrid search: BM25 + neural embeddings + PageRank")
  .option("-k, --top <number>", "Number of results", "10")
  .action(async (queryText, opts) => {
    try {
      if (getChunkCount() === 0) {
        console.log("No data. Run `Graphra generate` first.");
        closeDb();
        return;
      }

      const graph = loadGraph();
      const queryEmbedding = await embed(queryText);

      const results = hybridSearch(queryText, queryEmbedding, graph, {
        topK: parseInt(opts.top),
      });

      if (results.length === 0) {
        console.log("No results found.");
        closeDb();
        return;
      }

      console.log(`\n🔎 Top ${results.length} results:\n`);
      for (const r of results) {
        const short = r.chunk.file.split(/[/\\]/).slice(-2).join("/");
        const sig = (r.chunk as any).signature || r.chunk.name;
        console.log(`  [${r.score.toFixed(3)}] ${r.chunk.name}`);
        console.log(`         ${short}`);
        console.log(`         ${sig}\n`);
      }

      closeDb();
    } catch (err) {
      console.error("❌ Search failed:", err);
      closeDb();
      process.exit(1);
    }
  });

// ============================================
// Context
// ============================================
program
  .command("context <file>")
  .description("Build context for a file + task, export in any format")
  .requiredOption("-t, --task <task>", "Task description")
  .option("-k, --top <number>", "Max context entries", "15")
  .option("-f, --format <format>", "Output format: text, json, markdown, clipboard", "text")
  .option("--tokens <number>", "Max token budget (auto-packs best context)")
  .action(async (file, opts) => {
    try {
      if (getChunkCount() === 0) {
        console.log("No data. Run `Graphra generate` first.");
        closeDb();
        return;
      }

      const graph = loadGraph();
      const resolvedFile = path.resolve(file);
      const queryEmbedding = await embed(opts.task);

      // Get graph neighbors
      const neighbors = new Set<string>();
      for (const [src, targets] of Object.entries(graph)) {
        if (src === resolvedFile) targets.forEach((t) => neighbors.add(t));
        if (targets.includes(resolvedFile)) neighbors.add(src);
      }
      neighbors.add(resolvedFile);

      // Hybrid search for task-relevant chunks
      const results = hybridSearch(opts.task, queryEmbedding, graph, {
        topK: parseInt(opts.top),
      });

      // Collect all context entries
      const allChunks = getAllChunks();
      const neighborChunks = allChunks.filter((c) => neighbors.has(c.file));

      const entries: { file: string; name: string; signature: string; score: number; source: string }[] = [];
      const seen = new Set<string>();

      // Graph neighbors first (architecture)
      for (const c of neighborChunks.slice(0, 15)) {
        seen.add(c.id);
        entries.push({
          file: c.file.split(/[/\\]/).slice(-2).join("/"),
          name: c.name,
          signature: c.signature,
          score: 1.0,
          source: "graph",
        });
      }

      // Then search results
      for (const r of results) {
        if (seen.has(r.chunk.id)) continue;
        seen.add(r.chunk.id);
        entries.push({
          file: r.chunk.file.split(/[/\\]/).slice(-2).join("/"),
          name: r.chunk.name,
          signature: (r.chunk as any).signature || r.chunk.name,
          score: r.score,
          source: "search",
        });
      }

      // --- Token budget packing ---
      let packedEntries = entries;
      if (opts.tokens) {
        const maxTokens = parseInt(opts.tokens);
        packedEntries = [];
        let tokenCount = 0;
        for (const e of entries) {
          const entryTokens = Math.ceil(e.signature.length / 4) + 10; // rough estimate
          if (tokenCount + entryTokens > maxTokens) break;
          packedEntries.push(e);
          tokenCount += entryTokens;
        }
      }

      // --- Format output ---
      const format = opts.format.toLowerCase();

      if (format === "json") {
        const output = {
          task: opts.task,
          file: resolvedFile,
          entries: packedEntries,
          totalEntries: packedEntries.length,
        };
        console.log(JSON.stringify(output, null, 2));
      } else if (format === "markdown" || format === "md") {
        console.log(`# Context for: ${opts.task}\n`);
        console.log(`**Target file:** \`${file}\`\n`);
        console.log("## Architecture (dependencies)\n");
        for (const e of packedEntries.filter((e) => e.source === "graph")) {
          console.log(`- \`${e.file}\`: \`${e.signature}\``);
        }
        console.log("\n## Relevant code\n");
        for (const e of packedEntries.filter((e) => e.source === "search")) {
          console.log(`- **${e.name}** (\`${e.file}\`): \`${e.signature}\``);
        }
        console.log(`\n## Task\n\n${opts.task}`);
      } else if (format === "clipboard") {
        // Build a clean prompt ready to paste into any AI
        let prompt = `I'm working on the file \`${file}\` in a codebase. Here's the relevant context:\n\n`;
        prompt += "## Codebase Architecture\n\n";
        for (const e of packedEntries.filter((e) => e.source === "graph")) {
          prompt += `${e.file}: ${e.signature}\n`;
        }
        prompt += "\n## Related Code\n\n";
        for (const e of packedEntries.filter((e) => e.source === "search")) {
          prompt += `${e.file}: ${e.signature}\n`;
        }
        prompt += `\n## Task\n\n${opts.task}`;

        // Copy to clipboard
        try {
          const { execSync } = require("child_process");
          if (process.platform === "win32") {
            execSync("clip", { input: prompt });
          } else if (process.platform === "darwin") {
            execSync("pbcopy", { input: prompt });
          } else {
            execSync("xclip -selection clipboard", { input: prompt });
          }
          console.log(`📋 Context copied to clipboard! (${packedEntries.length} entries)`);
          console.log("   Paste into ChatGPT, Claude, Cursor, or any AI tool.");
        } catch {
          // Fallback: print to stdout
          console.log(prompt);
        }
      } else {
        // Default: text format
        console.log("ARCH:");
        for (const e of packedEntries.filter((e) => e.source === "graph")) {
          console.log(`  ${e.file}: ${e.signature}`);
        }
        console.log("\nCONTEXT:");
        for (const e of packedEntries.filter((e) => e.source === "search")) {
          console.log(`  ${e.file}: ${e.signature}`);
        }
        console.log(`\nTASK:\n  ${opts.task}`);
      }

      closeDb();
    } catch (err) {
      console.error("❌ Context failed:", err);
      closeDb();
      process.exit(1);
    }
  });

// ============================================
// Diff — context for a PR/branch
// ============================================
program
  .command("diff")
  .description("Generate context for changed files in current branch/PR")
  .option("-b, --base <branch>", "Base branch to diff against", "main")
  .option("-t, --task <task>", "Task description", "Review these changes")
  .option("-f, --format <format>", "Output format: text, json, markdown, clipboard", "markdown")
  .action(async (opts) => {
    try {
      if (getChunkCount() === 0) {
        console.log("No data. Run `Graphra generate` first.");
        closeDb();
        return;
      }

      // Get changed files from git
      const { execSync } = require("child_process");
      let changedFiles: string[] = [];
      try {
        const diffOutput = execSync(
          `git diff --name-only ${opts.base}...HEAD`,
          { encoding: "utf-8", timeout: 5000 }
        ).trim();
        if (diffOutput) changedFiles = diffOutput.split("\n").filter((f: string) => f.endsWith(".ts") || f.endsWith(".js"));
      } catch {
        // Fallback: uncommitted changes
        try {
          const statusOutput = execSync("git diff --name-only", { encoding: "utf-8", timeout: 5000 }).trim();
          if (statusOutput) changedFiles = statusOutput.split("\n").filter((f: string) => f.endsWith(".ts") || f.endsWith(".js"));
        } catch {
          console.log("❌ Not a git repository or git not available.");
          closeDb();
          return;
        }
      }

      if (changedFiles.length === 0) {
        console.log("No changed .ts/.js files found.");
        closeDb();
        return;
      }

      console.log(`📝 ${changedFiles.length} changed files:\n`);
      changedFiles.forEach((f: string) => console.log(`   ${f}`));

      // Find chunks in changed files + their neighbors
      const allChunks = getAllChunks();
      const graph = loadGraph();

      const changedSet = new Set(changedFiles.map((f: string) => path.resolve(f)));
      const changedChunks = allChunks.filter((c) => {
        for (const cf of changedSet) {
          if (c.file === cf || c.file.endsWith(cf.replace(/\\/g, "/")) || cf.endsWith(c.file.replace(/\\/g, "/"))) return true;
        }
        return false;
      });

      // Get neighbor files for context
      const neighborFiles = new Set<string>();
      for (const cf of changedSet) {
        for (const [src, targets] of Object.entries(graph)) {
          if (src === cf) targets.forEach((t) => neighborFiles.add(t));
          if (targets.includes(cf)) neighborFiles.add(src);
        }
      }
      const neighborChunks = allChunks.filter((c) => neighborFiles.has(c.file) && !changedSet.has(c.file));

      // Also do a semantic search for the task
      const queryEmbedding = await embed(opts.task);
      const searchResults = hybridSearch(opts.task, queryEmbedding, graph, { topK: 10 });

      // Format output
      const format = opts.format.toLowerCase();
      if (format === "markdown" || format === "md") {
        console.log(`\n# PR Context: ${opts.task}\n`);
        console.log(`## Changed files (${changedChunks.length} chunks)\n`);
        for (const c of changedChunks) {
          const short = c.file.split(/[/\\]/).slice(-2).join("/");
          console.log(`- \`${short}\`: \`${c.signature}\``);
        }
        console.log(`\n## Dependencies (${neighborChunks.length} chunks)\n`);
        for (const c of neighborChunks.slice(0, 20)) {
          const short = c.file.split(/[/\\]/).slice(-2).join("/");
          console.log(`- \`${short}\`: \`${c.signature}\``);
        }
        console.log(`\n## Related code\n`);
        const seen = new Set([...changedChunks, ...neighborChunks].map((c) => c.id));
        for (const r of searchResults) {
          if (seen.has(r.chunk.id)) continue;
          const short = r.chunk.file.split(/[/\\]/).slice(-2).join("/");
          console.log(`- **${r.chunk.name}** (\`${short}\`): \`${(r.chunk as any).signature}\``);
        }
      } else if (format === "json") {
        console.log(JSON.stringify({
          task: opts.task,
          base: opts.base,
          changedFiles,
          changedChunks: changedChunks.map((c) => ({ name: c.name, file: c.file, signature: c.signature })),
          neighborChunks: neighborChunks.slice(0, 20).map((c) => ({ name: c.name, file: c.file, signature: c.signature })),
        }, null, 2));
      } else {
        console.log(`\nCHANGED:\n`);
        for (const c of changedChunks) {
          console.log(`  ${c.file.split(/[/\\]/).slice(-2).join("/")}: ${c.signature}`);
        }
        console.log(`\nDEPENDENCIES:\n`);
        for (const c of neighborChunks.slice(0, 20)) {
          console.log(`  ${c.file.split(/[/\\]/).slice(-2).join("/")}: ${c.signature}`);
        }
      }

      closeDb();
    } catch (err) {
      console.error("❌ Diff failed:", err);
      closeDb();
      process.exit(1);
    }
  });

// ============================================
// Stats
// ============================================
program
  .command("stats")
  .description("Show database statistics")
  .action(() => {
    try {
      const db = getDb();
      const chunks = (db.prepare("SELECT COUNT(*) as c FROM chunks").get() as any).c;
      const embs = (db.prepare("SELECT COUNT(*) as c FROM embeddings").get() as any).c;
      const edges = (db.prepare("SELECT COUNT(*) as c FROM graph").get() as any).c;
      const files = (db.prepare("SELECT COUNT(DISTINCT file) as c FROM chunks").get() as any).c;

      console.log("\n📊 Graphra v2 Stats:\n");
      console.log(`   Files:       ${files}`);
      console.log(`   Chunks:      ${chunks}`);
      console.log(`   Embeddings:  ${embs} (384-dim neural)`);
      console.log(`   Graph edges: ${edges}`);

      const dbPath = path.join(".graphra", "graphra.db");
      if (fs.existsSync(dbPath)) {
        console.log(`   DB size:     ${(fs.statSync(dbPath).size / 1024 / 1024).toFixed(1)}MB`);
      }

      const types = db.prepare("SELECT type, COUNT(*) as c FROM chunks GROUP BY type ORDER BY c DESC").all() as any[];
      console.log("\n   By type:");
      for (const t of types) console.log(`     ${t.type}: ${t.c}`);

      closeDb();
    } catch (err) {
      console.error("❌ Stats failed:", err);
      closeDb();
    }
  });

// ============================================
// Explain — auto-generate architecture overview
// ============================================
program
  .command("explain")
  .description("Auto-generate a natural language architecture overview")
  .action(() => {
    try {
      if (getChunkCount() === 0) {
        console.log("No data. Run `Graphra generate` first.");
        closeDb();
        return;
      }

      const db = getDb();
      const graph = loadGraph();
      const allChunks = getAllChunks();

      // Group chunks by file
      const fileMap = new Map<string, typeof allChunks>();
      for (const c of allChunks) {
        const short = c.file.split(/[/\\]/).slice(-2).join("/");
        if (!fileMap.has(short)) fileMap.set(short, []);
        fileMap.get(short)!.push(c);
      }

      // Detect layers/patterns
      const layers: Record<string, string[]> = {
        controllers: [],
        services: [],
        "data access (DAL/models)": [],
        routes: [],
        middleware: [],
        utilities: [],
        types: [],
        config: [],
        tests: [],
        other: [],
      };

      for (const [file, chunks] of fileMap) {
        const lower = file.toLowerCase();
        if (lower.includes("controller")) layers.controllers.push(file);
        else if (lower.includes("service")) layers.services.push(file);
        else if (lower.includes("dal") || lower.includes("model") || lower.includes("repository")) layers["data access (DAL/models)"].push(file);
        else if (lower.includes("route")) layers.routes.push(file);
        else if (lower.includes("middleware") || lower.includes("validator") || lower.includes("validation")) layers.middleware.push(file);
        else if (lower.includes("util") || lower.includes("helper") || lower.includes("lib")) layers.utilities.push(file);
        else if (lower.includes("type") || lower.includes("interface")) layers.types.push(file);
        else if (lower.includes("config") || lower.includes("constant")) layers.config.push(file);
        else if (lower.includes("test") || lower.includes("spec")) layers.tests.push(file);
        else layers.other.push(file);
      }

      // PageRank for importance
      const { computePageRank } = require("./search");
      const pageRank = computePageRank(graph);
      const topFiles = Array.from(pageRank.entries() as Iterable<[string, number]>)
        .sort((a: [string, number], b: [string, number]) => b[1] - a[1])
        .slice(0, 10);

      // Chunk type stats
      const typeStats = db.prepare("SELECT type, COUNT(*) as c FROM chunks GROUP BY type ORDER BY c DESC").all() as any[];
      const fileCount = (db.prepare("SELECT COUNT(DISTINCT file) as c FROM chunks").get() as any).c;

      // Output
      console.log("# 🏗️ Architecture Overview\n");
      console.log(`This codebase has **${fileCount} files** with **${allChunks.length} code elements**.\n`);

      console.log("## Code composition\n");
      for (const t of typeStats) {
        console.log(`- ${t.c} ${t.type}s`);
      }

      console.log("\n## Layers detected\n");
      for (const [layer, files] of Object.entries(layers)) {
        if (files.length === 0) continue;
        console.log(`### ${layer.charAt(0).toUpperCase() + layer.slice(1)} (${files.length} files)\n`);
        for (const f of files.slice(0, 8)) {
          const chunks = fileMap.get(f) ?? [];
          const names = chunks.slice(0, 5).map((c) => c.name).join(", ");
          console.log(`- \`${f}\`: ${names}${chunks.length > 5 ? ` (+${chunks.length - 5} more)` : ""}`);
        }
        if (files.length > 8) console.log(`- ... and ${files.length - 8} more files`);
        console.log("");
      }

      console.log("## Most important files (PageRank)\n");
      for (const [file, rank] of topFiles) {
        const short = file.split(/[/\\]/).slice(-2).join("/");
        const chunks = allChunks.filter((c) => c.file === file);
        console.log(`- \`${short}\` (importance: ${(rank as number).toFixed(4)}) — ${chunks.length} chunks`);
      }

      console.log("\n## Dependency flow\n");
      const edgeCount = (db.prepare("SELECT COUNT(*) as c FROM graph").get() as any).c;
      console.log(`${edgeCount} import/require edges connecting ${fileCount} files.\n`);

      // Show top dependency chains
      const topImporters = Object.entries(graph)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5);
      for (const [file, deps] of topImporters) {
        const short = file.split(/[/\\]/).slice(-2).join("/");
        console.log(`- \`${short}\` imports ${deps.length} files`);
      }

      closeDb();
    } catch (err) {
      console.error("❌ Explain failed:", err);
      closeDb();
    }
  });

// ============================================
// Serve — background server mode (like ESLint daemon)
// ============================================
program
  .command("serve")
  .description("Start Graphra MCP server (alias for `Graphra mcp`)")
  .action(async () => {
    if (getChunkCount() === 0) {
      console.log("No data. Run `Graphra generate` first.");
      closeDb();
      return;
    }

    const { startMcpServer } = await import("./mcpServer");
    await startMcpServer();
  });

// ============================================
// MCP — start as MCP stdio server
// ============================================
program
  .command("mcp")
  .description("Start as an MCP server (stdio transport) for Claude/Cursor/VS Code")
  .action(async () => {
    const { startMcpServer } = await import("./mcpServer");
    await startMcpServer();
  });

// ============================================
// Setup — generate config for AI tools
// ============================================
program
  .command("setup")
  .description("Generate configuration for Claude Desktop, Cursor, or VS Code")
  .option("--claude", "Generate Claude Desktop config")
  .option("--cursor", "Generate Cursor config")
  .option("--vscode", "Generate VS Code MCP config")
  .option("--all", "Generate config for all tools")
  .action((opts) => {
    const cwd = process.cwd();
    const nodeExe = process.execPath;
    // Use the built JS file if available, otherwise ts-node
    const mcpScript = fs.existsSync(path.join(__dirname, "../dist/mcp.js"))
      ? path.join(__dirname, "../dist/mcp.js")
      : path.join(__dirname, "mcp.ts");

    const isTs = mcpScript.endsWith(".ts");
    const command = isTs ? "npx" : nodeExe;
    const args = isTs ? ["ts-node", mcpScript] : [mcpScript];

    const showAll = opts.all || (!opts.claude && !opts.cursor && !opts.vscode);

    if (opts.claude || showAll) {
      console.log("\n📋 Claude Desktop — add to claude_desktop_config.json:\n");
      const config = {
        mcpServers: {
          Graphra: {
            command,
            args,
            cwd,
          },
        },
      };
      console.log(JSON.stringify(config, null, 2));
      console.log(`\n   Config file location:`);
      console.log(`   Windows: %APPDATA%\\Claude\\claude_desktop_config.json`);
      console.log(`   macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json\n`);
    }

    if (opts.cursor || showAll) {
      console.log("\n📋 Cursor — add to .cursor/mcp.json in your project:\n");
      const cursorConfig = {
        mcpServers: {
          Graphra: {
            command,
            args,
            cwd,
          },
        },
      };
      const cursorDir = path.join(cwd, ".cursor");
      if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });
      fs.writeFileSync(
        path.join(cursorDir, "mcp.json"),
        JSON.stringify(cursorConfig, null, 2)
      );
      console.log(`   ✅ Written to .cursor/mcp.json\n`);
    }

    if (opts.vscode || showAll) {
      console.log("\n📋 VS Code — add to .vscode/mcp.json:\n");
      const vscodeConfig = {
        servers: {
          Graphra: {
            command,
            args,
            cwd,
          },
        },
      };
      const vscodeDir = path.join(cwd, ".vscode");
      if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(vscodeDir, "mcp.json"),
        JSON.stringify(vscodeConfig, null, 2)
      );
      console.log(`   ✅ Written to .vscode/mcp.json\n`);
    }

    // Always generate .github/copilot-instructions.md — Copilot reads this on EVERY message
    try {
      const allChunks = getAllChunks();
      if (allChunks.length > 0) {
        const githubDir = path.join(cwd, ".github");
        if (!fs.existsSync(githubDir)) fs.mkdirSync(githubDir, { recursive: true });

        // Build a compact architecture summary
        const fileMap = new Map<string, string[]>();
        for (const c of allChunks) {
          const short = c.file.split(/[/\\]/).slice(-2).join("/");
          if (!fileMap.has(short)) fileMap.set(short, []);
          fileMap.get(short)!.push(c.name);
        }

        let instructions = `# Codebase Context (auto-generated by Graphra)\n\n`;
        instructions += `This project has ${allChunks.length} code elements across ${fileMap.size} files.\n\n`;
        instructions += `## Key files and their exports\n\n`;

        // Show top 30 files with their exports
        const sorted = Array.from(fileMap.entries())
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 30);

        for (const [file, names] of sorted) {
          const display = names.slice(0, 8).join(", ");
          const more = names.length > 8 ? ` (+${names.length - 8} more)` : "";
          instructions += `- \`${file}\`: ${display}${more}\n`;
        }

        instructions += `\n## Rules\n\n`;
        instructions += `- Before writing code, check if a similar function already exists above\n`;
        instructions += `- Follow existing patterns — use the same helpers, services, and types\n`;
        instructions += `- This project uses Graphra MCP tools — call Graphra_auto for detailed context\n`;

        fs.writeFileSync(path.join(githubDir, "copilot-instructions.md"), instructions);
        console.log("📋 Generated .github/copilot-instructions.md (Copilot reads this on every message)");
      }
      closeDb();
    } catch { /* non-critical */ }

    console.log("\n🎉 After adding the config, restart your AI tool and Graphra tools will appear automatically!");
  });

program.parse();
