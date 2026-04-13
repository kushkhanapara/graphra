<p align="center">
  <h1 align="center">⚡ Graphra</h1>
  <p align="center"><strong>The universal code context engine for AI tools.</strong></p>
  <p align="center">Zero-config · Local-first · Works with every AI tool</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2.0.0-blue" alt="Version" />
  <img src="https://img.shields.io/badge/languages-JS%2FTS-yellow" alt="Languages" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/API%20keys-none%20required-brightgreen" alt="No API Keys" />
</p>

---

AI coding tools re-read your entire codebase on every prompt. **graphra fixes that.** It builds a structural index of your code, then gives any AI tool — Copilot, Cursor, Claude, ChatGPT, or local LLMs — precisely the context it needs.

```bash
npm install -g graphra    # Install once
cd your-project
graphra init              # Auto-detect language, framework, structure
graphra generate           # Index codebase (incremental, <1s on re-runs)
graphra setup             # Generate configs for Claude/Cursor/VS Code
# Done. Restart your AI tool — context flows automatically.
```

`graphra setup` generates:
- `.vscode/mcp.json` — VS Code discovers Graphra's MCP tools
- `.cursor/mcp.json` — Cursor discovers Graphra's MCP tools
- `.github/copilot-instructions.md` — Copilot reads codebase overview on **every** message
- Claude Desktop config (printed to console)

## Why Graphra?

| Problem | How graphra solves it |
|---------|----------------------|
| AI tools don't understand your codebase | Builds a structural index with dependency graph |
| Sending full files wastes tokens | Sends only relevant **code signatures**, not full files |
| Keyword search misses semantic matches | **Hybrid search**: BM25 + neural embeddings + PageRank + git recency |
| Every tool needs different setup | **One index, every tool**: Copilot, Cursor, Claude, ChatGPT, local LLMs |
| Cloud-based tools send your code to servers | **100% local** — no API keys, no cloud, no data leaves your machine |
| Re-indexing is slow | **Incremental** — only re-processes changed files (0.4s when nothing changed) |

## Features

### 🔍 Hybrid Search Engine
Combines 4 ranking signals for the most relevant results:

| Signal | What it does |
|--------|-------------|
| **BM25 full-text** | Exact keyword matching with term frequency weighting |
| **Neural embeddings** | Semantic understanding — "auth" matches "login" matches "sign in" |
| **PageRank** | Files imported by many others rank higher (structural importance) |
| **Git recency** | Recently modified code ranks higher (temporal relevance) |

### 📝 Aider-Style Code Signatures
Instead of generating lossy text summaries, graphra extracts **actual code signatures**:

```
# What other tools show:
"This function handles user authentication with session management"

# What graphra shows:
user/user.service.js: async login(email, inputPassword, session, sessionDetails, keepSessionActive = false)
```

The AI sees real code — parameter names, types, return types — not a summary's interpretation.

### 🧠 Local Neural Embeddings
Uses **all-MiniLM-L6-v2** (same model as Continue.dev) running 100% locally via TransformersJS:
- 384-dimensional vectors
- Understands semantic meaning ("authentication" ≈ "login" ≈ "sign in")
- First run downloads ~23MB model, then cached forever
- No API keys, no cloud, no cost

### 💾 SQLite Storage
Compact, fast, single-file database:
- **13MB** for a 206-file repo (vs 39MB JSON in v1)
- Binary float32 embedding blobs
- Incremental updates — only re-embeds changed files
- WAL mode for concurrent reads

### 🔌 Universal AI Tool Support
One index works with every AI tool:

| Tool | Integration | How |
|------|------------|-----|
| **Claude Desktop** | MCP (stdio) | `graphra setup --claude` |
| **Cursor** | MCP (stdio) | `graphra setup --cursor` |
| **VS Code Copilot** | MCP (stdio) | `graphra setup --vscode` |
| **ChatGPT** | Clipboard | `graphra context file -t "task" -f clipboard` |
| **Any AI** | REST API | `graphra serve` → `POST /context` |
| **Custom tools** | JSON export | `graphra context file -t "task" -f json` |

### 📊 Context Confidence Scoring
Every response includes a confidence score:
```json
{
  "confidence": 87,
  "confidenceLabel": "high",
  "tokenEstimate": 1240
}
```

### 🎯 Model-Aware Token Budgets
Automatically optimizes context size for your model. graphra uses a smart token estimation heuristic (word-level analysis, ~15% accuracy vs tiktoken) and priority-based packing (graph entries get 1.5x boost, sorted by relevance score).

| Model | Token Budget | | Model | Token Budget |
|-------|-------------|---|-------|-------------|
| GPT-4o | 8,000 | | Claude 4 Opus | 12,000 |
| GPT-4o-mini | 4,000 | | Claude 3.5 Sonnet | 10,000 |
| o3 | 10,000 | | Claude 3 Haiku | 4,000 |
| o3-mini | 6,000 | | Gemini 2 | 10,000 |
| Llama 3.1 405B | 6,000 | | DeepSeek v2 | 6,000 |
| Llama 3 70B | 4,000 | | Qwen 2.5 Coder | 4,000 |
| Llama 3 8B | 2,000 | | Mistral 7B | 2,000 |
| Mixtral | 4,000 | | StarCoder 2 | 3,000 |

**30+ models** pre-configured. Pass `model: "gpt-4o"` and graphra auto-packs the best context within that budget. Works in CLI (`--tokens`), REST API (`model` field), and MCP tools (`maxTokens` or `model` param).

**Token packing is applied everywhere:**
- ✅ CLI: `graphra context file -t "task" --tokens 2000`
- ✅ REST API: `POST /context { model: "gpt-4o" }` → auto 8K budget
- ✅ MCP Server: All 4 tools respect token budgets (default 4K)
- Architecture entries capped at 40% of budget, remaining 60% for search results

### ⚡ Incremental Re-indexing
| Scenario | Time |
|----------|------|
| Full build (206 files, 2923 chunks) | 23s |
| No changes | **0.4s** |
| 1 file changed | **1.1s** |

## Quick Start

### 1. Install

```bash
npm install -g graphra
```

### 2. Initialize & Index

```bash
cd your-project
graphra init       # Auto-detects: language, framework, structure, entry points
graphra generate   # Indexes codebase with neural embeddings
```

### 3. Use

```bash
# Search your codebase
graphra search "authentication login"
graphra search "database query postgres"
graphra search "send email notification"

# Get context for a task
graphra context src/auth.js -t "Add rate limiting to login" -f clipboard
# → Copied to clipboard! Paste into ChatGPT/Claude/any AI.

# Architecture overview
graphra explain

# PR/diff context
graphra diff -b main

# Database stats
graphra stats
```

### 4. Connect to AI Tools

```bash
graphra setup   # Generates configs for Claude, Cursor, VS Code
```

Then restart your AI tool. Graphra's tools appear automatically:
- `Graphra_search` — Hybrid codebase search
- `Graphra_context` — Task-specific context with architecture
- `Graphra_explain` — Architecture overview
- `Graphra_stats` — Index statistics

## CLI Reference

| Command | Description |
|---------|-------------|
| `graphra init` | Auto-detect project language, framework, and structure |
| `graphra generate` | Index codebase (incremental — only re-processes changed files) |
| `graphra generate --force` | Full rebuild (ignores cache) |
| `graphra search <query>` | Hybrid search: BM25 + neural + PageRank + git recency |
| `graphra search <query> -k 20` | Return top 20 results |
| `graphra context <file> -t <task>` | Build context for a file + task |
| `graphra context <file> -t <task> -f json` | Export as JSON |
| `graphra context <file> -t <task> -f markdown` | Export as Markdown |
| `graphra context <file> -t <task> -f clipboard` | Copy to clipboard |
| `graphra context <file> -t <task> --tokens 4000` | Pack into 4K token budget |
| `graphra diff` | Context for changed files in current branch |
| `graphra diff -b develop` | Diff against a specific branch |
| `graphra explain` | Auto-generated architecture overview |
| `graphra stats` | Database statistics |
| `graphra serve` | Start REST API server (port 4567) |
| `graphra mcp` | Start MCP stdio server (for Claude/Cursor/VS Code) |
| `graphra setup` | Generate AI tool configs |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLI (cli.ts)                            │
│  init · generate · search · context · diff · explain · stats   │
│  serve · mcp · setup                                           │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Core Pipeline                              │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌────────────────┐  ┌──────────┐ │
│  │ Scanner  │→ │ Chunker  │→ │  Signature     │→ │ Neural   │ │
│  │          │  │ (ts-morph)│  │  Extractor     │  │ Embedder │ │
│  │ globby + │  │          │  │  (Aider-style) │  │ (MiniLM) │ │
│  │ gitignore│  │ AST parse│  │                │  │ 384-dim  │ │
│  └──────────┘  └──────────┘  └────────────────┘  └──────────┘ │
│                                                                 │
│  ┌──────────┐  ┌──────────────────────────────────────────────┐ │
│  │  Graph   │  │            Hybrid Search                     │ │
│  │ Builder  │  │  BM25 + Neural + PageRank + Git Recency      │ │
│  │ import + │  │  → Confidence scoring                        │ │
│  │ require  │  │  → Model-aware token packing                 │ │
│  └──────────┘  └──────────────────────────────────────────────┘ │
└──────────┬──────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SQLite Storage                                │
│                                                                 │
│  ┌──────────┐ ┌────────────┐ ┌─────────┐ ┌──────┐ ┌─────────┐│
│  │  chunks  │ │ embeddings │ │  graph  │ │ meta │ │  files  ││
│  │ id,file, │ │ chunk_id,  │ │ source, │ │ key, │ │ path,   ││
│  │ name,sig,│ │ vector     │ │ target  │ │ value│ │ mtime   ││
│  │ code,hash│ │ (float32)  │ │         │ │      │ │         ││
│  └──────────┘ └────────────┘ └─────────┘ └──────┘ └─────────┘│
│                                                                 │
│  .graphra/graphra.db (single file, WAL mode)                 │
└─────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Output Layer                                  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Token Budget (tokenBudget.ts)               │   │
│  │  estimateTokens() · getTokenBudget() · packEntries()    │   │
│  │  30+ model presets · priority-based packing              │   │
│  │  Architecture capped at 40% · search results get 60%    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐│
│  │  MCP Server  │  │  REST API    │  │  CLI Output            ││
│  │  (stdio)     │  │  (HTTP)      │  │                        ││
│  │  token-aware │  │  token-aware │  │  text · json · markdown ││
│  │  Claude      │  │  /context/   │  │  clipboard             ││
│  │  Cursor      │  │    copilot   │  │  --tokens flag         ││
│  │  VS Code     │  │    cursor    │  │                        ││
│  │              │  │    chatgpt   │  │                        ││
│  │              │  │    claude    │  │                        ││
│  └──────────────┘  └──────────────┘  └────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. SCAN        globby scans files, respects .gitignore + always ignores node_modules
                    │
2. CHUNK       ts-morph parses AST → extracts functions, classes, methods,
               interfaces, types, arrow functions, constants
                    │
3. SIGNATURE   Extracts actual code declaration lines (Aider-style)
               "async login(email, password, session)" not "handles login"
                    │
4. EMBED       all-MiniLM-L6-v2 generates 384-dim vectors locally
               Understands semantic meaning: "auth" ≈ "login" ≈ "sign in"
                    │
5. GRAPH       Parses import/require statements → builds dependency graph
               Computes PageRank for file importance ranking
                    │
6. STORE       Everything saved to SQLite (.graphra/graphra.db)
               Embeddings as binary float32 blobs (compact)
               File mtimes tracked for incremental updates
                    │
7. SEARCH      Query → BM25 + Neural + PageRank + Git Recency
               Results ranked by combined score with confidence
                    │
8. PACK        Token budget applied (model-aware: GPT-4o→8K, Llama→2K)
               Priority packing: graph entries 1.5x boost, sorted by score
               Architecture capped at 40%, search results get 60%
                    │
9. SERVE       MCP (stdio) for Claude/Cursor/VS Code — token-aware
               REST API for any HTTP client — model-aware budgets
               CLI for terminal usage — --tokens flag
```

### Module Map

```
src/
├── cli.ts                  # Commander CLI — 10 commands
├── mcp.ts                  # MCP entry point (spawned by AI tools)
├── mcpServer.ts            # MCP protocol (5 tools: auto, search, context, explain, stats)
├── tokenBudget.ts          # Token estimation, 30+ model budgets, priority packing
├── init.ts                 # Auto-detect language/framework/structure
├── scanner.ts              # File discovery (globby + gitignore)
├── chunker.ts              # AST chunking (ts-morph)
├── signatureExtractor.ts   # Aider-style signature extraction
├── neuralEmbedder.ts       # TransformersJS (all-MiniLM-L6-v2)
├── search.ts               # Hybrid search (BM25 + Neural + PageRank + Git)
├── graph.ts                # Dependency graph builder (import + require)
├── storage.ts              # SQLite (better-sqlite3)
├── types.ts                # Core type definitions
└── utils/
    └── hash.ts             # MD5 hash utility

14 files, ~2,400 lines of TypeScript.
```

## How It Compares

| Feature | graphra | Aider | Continue.dev | code-review-graph |
|---------|----------|-------|-------------|-------------------|
| **Zero config** | ✅ `npm install` + `init` | ❌ Needs LLM | ❌ Needs config | ❌ `pip install` + `build` |
| **Languages** | JS/TS | Multi (tree-sitter) | Multi | Multi (tree-sitter) |
| **Code signatures** | ✅ Aider-style | ✅ | ❌ | ✅ |
| **Neural embeddings** | ✅ Local (MiniLM) | ❌ | ✅ (MiniLM) | ✅ (optional) |
| **BM25 full-text** | ✅ | ❌ | ✅ | ✅ (FTS5) |
| **PageRank** | ✅ | ✅ (graph) | ❌ | ❌ |
| **Git recency** | ✅ | ❌ | ❌ | ❌ |
| **Incremental** | ✅ mtime-based | ✅ | ✅ | ✅ git-based |
| **MCP server** | ✅ | ❌ | ❌ | ✅ (22 tools) |
| **Universal AI export** | ✅ All tools | ❌ Chat only | ❌ IDE only | ❌ Claude only |
| **Confidence scoring** | ✅ | ❌ | ❌ | ❌ |
| **Model-aware tokens** | ✅ 30+ models, priority packing | ❌ | ❌ | ✅ (detail levels) |
| **Clipboard export** | ✅ | ❌ | ❌ | ❌ |
| **PR/diff context** | ✅ | ❌ | ❌ | ✅ |
| **Architecture explain** | ✅ | ❌ | ❌ | ✅ |
| **Storage** | SQLite (13MB) | SQLite | LanceDB | SQLite |
| **API keys required** | ❌ None | ✅ LLM key | ✅ Embed key | ❌ None |

### Graphra's unique position:

> **The only zero-config, local-first codebase context engine that works with every AI tool.**

## REST API

Start with `graphra serve` (default port 4567):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check + chunk count |
| `/stats` | GET | Database statistics |
| `/search` | POST | Hybrid search `{ query, topK? }` |
| `/context` | POST | Raw context `{ file?, task, topK?, maxTokens?, model? }` |
| `/context/copilot` | POST | GitHub Copilot optimized format |
| `/context/cursor` | POST | Cursor optimized format |
| `/context/chatgpt` | POST | ChatGPT paste-ready format |
| `/context/claude` | POST | Claude MCP format |

## MCP Tools

When connected via `graphra mcp` or `graphra setup`:

| Tool | Description |
|------|-------------|
| `Graphra_auto` | **Primary tool — called on every coding question.** Takes the user's message + active file, returns ~2K tokens of compact context: current file signatures, dependencies, and related code. |
| `Graphra_search` | Hybrid codebase search — returns code signatures. Params: `query`, `topK?`, `maxTokens?`, `model?` |
| `Graphra_context` | Full context with architecture + related code. Token-budget aware. Params: `task`, `file?`, `topK?`, `maxTokens?`, `model?` |
| `Graphra_explain` | Codebase architecture overview (auto-truncated to budget) |
| `Graphra_stats` | Index statistics |

All MCP tools respect token budgets. Default: 4,000 tokens. `Graphra_auto` uses a compact 2K budget.

## How Context Reaches the AI — 3 Layers

graphra delivers context through three complementary layers:

```
Layer 1: STATIC (every message, zero latency)
│  .github/copilot-instructions.md
│  → Auto-generated file listing top 30 files + exports
│  → Copilot reads this on EVERY chat message automatically
│  → AI already knows what exists before you even ask
│
Layer 2: AUTO TOOL (called on coding questions)
│  Graphra_auto(message, activeFile)
│  → Tool description tells AI: "IMPORTANT: Call BEFORE answering
│    ANY coding question"
│  → Returns ~2K tokens: current file, dependencies, related code
│  → AI sees real signatures, not summaries
│
Layer 3: DEEP TOOLS (called when AI needs more)
   Graphra_search(query)    → find specific code
   Graphra_context(task)    → full context with architecture
   Graphra_explain()        → architecture overview
```

**Layer 1** works on every single message with zero tool calls. **Layer 2** the AI calls on most coding questions. **Layer 3** is for deep dives.

## Benchmarks

Tested on a real-world 206-file Node.js/Express codebase:

| Metric | Value |
|--------|-------|
| Files indexed | 206 |
| Chunks extracted | 2,923 |
| Embeddings | 2,923 (384-dim) |
| Graph edges | 585 |
| Full build time | **23.6s** |
| Incremental (no changes) | **0.4s** |
| Incremental (1 file) | **1.1s** |
| Database size | **13MB** |
| Search accuracy (top-5) | **92.5%** |

### Search Accuracy (8 queries, top-5 precision)

| Query | Precision | #1 Result |
|-------|-----------|-----------|
| "authentication login" | 5/5 | `UserController.login` ✅ |
| "send email notification" | 5/5 | `sendNotificationEmailToInfluencer` ✅ |
| "database query postgres" | 4/5 | `readAndWriteDataFromSQLiteToPostgres` ✅ |
| "cron job scheduler" | 5/5 | `CronJobScheduler.init` ✅ |
| "file upload S3 storage" | 5/5 | `directUploadToS3Bucket` ✅ |
| "validate user input" | 4/5 | `validatePassword` ✅ |
| "redis cache session" | 4/5 | `IORedisClient` ✅ |
| "password hash bcrypt" | 5/5 | `generatePasswordHash` ✅ |

**Overall: 37/40 = 92.5% top-5 precision**

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript |
| AST Parser | ts-morph |
| Embeddings | TransformersJS (all-MiniLM-L6-v2) |
| Storage | better-sqlite3 |
| Search | Custom BM25 + cosine similarity + PageRank + git recency |
| Token optimization | Custom word-level estimator, 30+ model presets, priority packing |
| CLI | Commander.js |
| File scanning | globby |
| MCP Protocol | @modelcontextprotocol/sdk (stdio transport) |
| Schema validation | Zod |

## License

MIT

---

<p align="center">
  Built with ❤️ for developers who want AI tools that actually understand their codebase.
</p>
