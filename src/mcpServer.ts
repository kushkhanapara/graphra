/**
 * Graphra MCP Server — proper Model Context Protocol implementation.
 *
 * Runs via stdio transport (standard for Claude Desktop, Cursor, VS Code).
 * When an AI tool chats, it automatically calls these tools to get context.
 *
 * Tools:
 *   Graphra_search    — Hybrid search across the codebase
 *   Graphra_context   — Get relevant context for a file + task
 *   Graphra_explain   — Get architecture overview
 *   Graphra_stats     — Get database statistics
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as path from "path";
import { embed } from "./neuralEmbedder";
import { hybridSearch, computePageRank } from "./search";
import {
  getDb, loadGraph, getAllChunks, getChunkCount,
} from "./storage";
import { packText, getTokenBudget, estimateTokens } from "./tokenBudget";

// Use console.error for logging (stdout is reserved for MCP protocol)
const log = (...args: any[]) => console.error("[Graphra]", ...args);

// Default MCP context budget — conservative to leave room for conversation
const MCP_DEFAULT_BUDGET = 4000;

export async function startMcpServer() {
  const server = new Server(
    { name: "graphra", version: "1.0.0" },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // ============================================
  // Handle tools/list
  // ============================================
  server.setRequestHandler(
    { method: "tools/list" } as any,
    async () => ({
      tools: [
        {
          name: "Graphra_search",
          description:
            "Search the codebase for relevant functions, classes, and types using hybrid search " +
            "(BM25 + neural embeddings + PageRank + git recency). Returns actual code signatures. " +
            "Results are automatically packed within a token budget.",
          inputSchema: {
            type: "object" as const,
            properties: {
              query: { type: "string", description: "Search query" },
              topK: { type: "number", description: "Number of results", default: 10 },
              maxTokens: { type: "number", description: "Max tokens for response (default: auto based on model)" },
              model: { type: "string", description: "AI model name for auto token budget (e.g. gpt-4o, claude-3-sonnet)" },
            },
            required: ["query"],
          },
        },
        {
          name: "Graphra_context",
          description:
            "Get relevant codebase context for a task. Returns architecture (dependencies) " +
            "and semantically related code signatures. Token-budget aware.",
          inputSchema: {
            type: "object" as const,
            properties: {
              task: { type: "string", description: "What you're trying to do" },
              file: { type: "string", description: "Target file path (optional)" },
              topK: { type: "number", description: "Max results", default: 15 },
              maxTokens: { type: "number", description: "Max tokens for response" },
              model: { type: "string", description: "AI model name for auto token budget" },
            },
            required: ["task"],
          },
        },
        {
          name: "Graphra_explain",
          description:
            "Get architecture overview: layers, important files, code composition.",
          inputSchema: {
            type: "object" as const,
            properties: {},
          },
        },
        {
          name: "Graphra_stats",
          description: "Get index statistics: files, chunks, embeddings, graph edges.",
          inputSchema: {
            type: "object" as const,
            properties: {},
          },
        },
        {
          name: "Graphra_auto",
          description:
            "IMPORTANT: Call this tool BEFORE answering ANY coding question, code review, or code modification request. " +
            "It returns the relevant codebase context (existing functions, types, patterns) so you can write code that " +
            "fits the existing codebase instead of reinventing the wheel. Pass the user's message and the active file path. " +
            "Returns ~2K tokens of compact context: current file signatures, dependencies, and related code.",
          inputSchema: {
            type: "object" as const,
            properties: {
              message: { type: "string", description: "The user's full chat message / question" },
              activeFile: { type: "string", description: "Path of the file currently open in the editor (if known)" },
            },
            required: ["message"],
          },
        },
      ],
    })
  );

  // ============================================
  // Handle tools/call
  // ============================================
  server.setRequestHandler(
    { method: "tools/call" } as any,
    async (request: any) => {
      const { name, arguments: args } = request.params;
      log(`tool call: ${name}`, args);

      // --- Graphra_search ---
      if (name === "Graphra_search") {
        if (getChunkCount() === 0) {
          return { content: [{ type: "text", text: "No index. Run `Graphra generate` first." }] };
        }
        const graph = loadGraph();
        const queryEmbedding = await embed(args.query);
        const budget = args.maxTokens || getTokenBudget(args.model) || MCP_DEFAULT_BUDGET;
        const results = hybridSearch(args.query, queryEmbedding, graph, { topK: args.topK || 10 });

        if (results.length === 0) {
          return { content: [{ type: "text", text: "No results found." }] };
        }

        // Token-aware packing — stop adding results when budget is hit
        const lines: string[] = [];
        let tokenCount = 0;
        for (const r of results) {
          const short = r.chunk.file.split(/[/\\]/).slice(-2).join("/");
          const sig = (r.chunk as any).signature || r.chunk.name;
          const line = `${short}: ${sig}`;
          const lineTokens = estimateTokens(line);
          if (tokenCount + lineTokens > budget) break;
          lines.push(line);
          tokenCount += lineTokens;
        }

        const text = lines.join("\n");
        log(`search: returned ${lines.length} results, ~${tokenCount} tokens (budget: ${budget})`);
        return { content: [{ type: "text", text }] };
      }

      // --- Graphra_context ---
      if (name === "Graphra_context") {
        if (getChunkCount() === 0) {
          return { content: [{ type: "text", text: "No index. Run `Graphra generate` first." }] };
        }
        const graph = loadGraph();
        const resolvedFile = args.file ? path.resolve(args.file) : "";
        const queryEmbedding = await embed(args.task);

        const neighbors = new Set<string>();
        if (resolvedFile) {
          for (const [src, targets] of Object.entries(graph)) {
            if (src === resolvedFile) targets.forEach((t: string) => neighbors.add(t));
            if (targets.includes(resolvedFile)) neighbors.add(src);
          }
          neighbors.add(resolvedFile);
        }

        const allChunks = getAllChunks();
        const neighborChunks = resolvedFile ? allChunks.filter((c) => neighbors.has(c.file)) : [];
        const searchResults = hybridSearch(args.task, queryEmbedding, graph, { topK: args.topK || 15 });

        // Token-aware packing
        const budget = args.maxTokens || getTokenBudget(args.model) || MCP_DEFAULT_BUDGET;
        let text = "";
        let tokenCount = 0;

        if (neighborChunks.length > 0) {
          text += "ARCHITECTURE:\n";
          for (const c of neighborChunks.slice(0, 10)) {
            const line = `  ${c.file.split(/[/\\]/).slice(-2).join("/")}: ${c.signature}\n`;
            const lineTokens = estimateTokens(line);
            if (tokenCount + lineTokens > budget * 0.4) break; // Reserve 40% for architecture
            text += line;
            tokenCount += lineTokens;
          }
          text += "\n";
        }

        text += "RELATED CODE:\n";
        const seen = new Set(neighborChunks.map((c) => c.id));
        for (const r of searchResults) {
          if (seen.has(r.chunk.id)) continue;
          seen.add(r.chunk.id);
          const line = `  ${r.chunk.file.split(/[/\\]/).slice(-2).join("/")}: ${(r.chunk as any).signature || r.chunk.name}\n`;
          const lineTokens = estimateTokens(line);
          if (tokenCount + lineTokens > budget) break;
          text += line;
          tokenCount += lineTokens;
        }

        log(`context: ~${tokenCount} tokens (budget: ${budget})`);
        return { content: [{ type: "text", text }] };
      }

      // --- Graphra_explain ---
      if (name === "Graphra_explain") {
        if (getChunkCount() === 0) {
          return { content: [{ type: "text", text: "No index. Run `Graphra generate` first." }] };
        }

        const db = getDb();
        const graph = loadGraph();
        const allChunks = getAllChunks();

        const fileMap = new Map<string, string[]>();
        for (const c of allChunks) {
          const short = c.file.split(/[/\\]/).slice(-2).join("/");
          if (!fileMap.has(short)) fileMap.set(short, []);
          fileMap.get(short)!.push(c.name);
        }

        const layers: Record<string, string[]> = {};
        for (const [file] of fileMap) {
          const lower = file.toLowerCase();
          let layer = "other";
          if (lower.includes("controller")) layer = "controllers";
          else if (lower.includes("service")) layer = "services";
          else if (lower.includes("dal") || lower.includes("model")) layer = "data-access";
          else if (lower.includes("route")) layer = "routes";
          else if (lower.includes("util") || lower.includes("helper")) layer = "utilities";
          if (!layers[layer]) layers[layer] = [];
          layers[layer].push(file);
        }

        const pageRank = computePageRank(graph);
        const topFiles = Array.from(pageRank.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

        const fileCount = (db.prepare("SELECT COUNT(DISTINCT file) as c FROM chunks").get() as any).c;
        let text = `CODEBASE: ${fileCount} files, ${allChunks.length} elements\n\n`;
        text += "LAYERS:\n";
        for (const [layer, files] of Object.entries(layers)) {
          if (files.length === 0) continue;
          text += `  ${layer}: ${files.length} files\n`;
        }
        text += "\nTOP FILES:\n";
        for (const [file, rank] of topFiles) {
          text += `  ${file.split(/[/\\]/).slice(-2).join("/")}: ${rank.toFixed(4)}\n`;
        }

        // Pack to budget
        const packed = packText(text, MCP_DEFAULT_BUDGET);
        log(`explain: ~${packed.tokens} tokens${packed.truncated ? " (truncated)" : ""}`);
        return { content: [{ type: "text", text: packed.text }] };
      }

      // --- Graphra_auto (the key tool — called on every message) ---
      if (name === "Graphra_auto") {
        if (getChunkCount() === 0) {
          return { content: [{ type: "text", text: "No index. Run `Graphra generate` first." }] };
        }

        const message = args.message || "";
        const activeFile = args.activeFile || "";
        const AUTO_BUDGET = 2000; // Compact — leaves room for conversation

        log(`auto: "${message.slice(0, 80)}..." file=${activeFile || "none"}`);

        const graph = loadGraph();
        const resolvedFile = activeFile ? path.resolve(activeFile) : "";
        const queryEmbedding = await embed(message);

        // 1. Get neighbors of active file (architecture)
        const neighbors = new Set<string>();
        if (resolvedFile) {
          for (const [src, targets] of Object.entries(graph)) {
            if (src === resolvedFile) targets.forEach((t: string) => neighbors.add(t));
            if (targets.includes(resolvedFile)) neighbors.add(src);
          }
          neighbors.add(resolvedFile);
        }

        const allChunks = getAllChunks();
        const neighborChunks = resolvedFile ? allChunks.filter((c) => neighbors.has(c.file)) : [];

        // 2. Hybrid search for the message
        const searchResults = hybridSearch(message, queryEmbedding, graph, { topK: 10 });

        // 3. Build compact output within budget
        let text = "";
        let tokenCount = 0;

        // Active file's signatures first (most relevant)
        if (neighborChunks.length > 0) {
          const fileChunks = resolvedFile
            ? neighborChunks.filter((c) => c.file === resolvedFile)
            : [];
          const depChunks = neighborChunks.filter((c) => c.file !== resolvedFile);

          if (fileChunks.length > 0) {
            text += "CURRENT FILE:\n";
            for (const c of fileChunks.slice(0, 8)) {
              const line = `  ${c.name}: ${c.signature}\n`;
              const lt = estimateTokens(line);
              if (tokenCount + lt > AUTO_BUDGET * 0.3) break;
              text += line;
              tokenCount += lt;
            }
          }

          if (depChunks.length > 0) {
            text += "\nDEPENDENCIES:\n";
            for (const c of depChunks.slice(0, 5)) {
              const short = c.file.split(/[/\\]/).slice(-2).join("/");
              const line = `  ${short}: ${c.signature}\n`;
              const lt = estimateTokens(line);
              if (tokenCount + lt > AUTO_BUDGET * 0.5) break;
              text += line;
              tokenCount += lt;
            }
          }
        }

        // Search results
        text += "\nRELATED:\n";
        const seen = new Set(neighborChunks.map((c) => c.id));
        for (const r of searchResults) {
          if (seen.has(r.chunk.id)) continue;
          seen.add(r.chunk.id);
          const short = r.chunk.file.split(/[/\\]/).slice(-2).join("/");
          const sig = (r.chunk as any).signature || r.chunk.name;
          const line = `  ${short}: ${sig}\n`;
          const lt = estimateTokens(line);
          if (tokenCount + lt > AUTO_BUDGET) break;
          text += line;
          tokenCount += lt;
        }

        log(`auto: ~${tokenCount} tokens`);
        return { content: [{ type: "text", text }] };
      }

      // --- Graphra_stats ---
      if (name === "Graphra_stats") {
        const db = getDb();
        const chunks = (db.prepare("SELECT COUNT(*) as c FROM chunks").get() as any).c;
        const embs = (db.prepare("SELECT COUNT(*) as c FROM embeddings").get() as any).c;
        const edges = (db.prepare("SELECT COUNT(*) as c FROM graph").get() as any).c;
        const files = (db.prepare("SELECT COUNT(DISTINCT file) as c FROM chunks").get() as any).c;
        return { content: [{ type: "text", text: `Files: ${files}, Chunks: ${chunks}, Embeddings: ${embs}, Graph: ${edges} edges` }] };
      }

      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  );

  // ============================================
  // Connect via stdio transport
  // ============================================
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("Graphra MCP server running on stdio");
}
