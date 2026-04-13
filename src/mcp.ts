#!/usr/bin/env node
/**
 * Graphra MCP Server entry point.
 *
 * This file is spawned as a child process by Claude Desktop, Cursor, VS Code, etc.
 * Communicates via stdio (stdin/stdout) using the MCP protocol.
 *
 * Usage:
 *   node dist/mcp.js
 *   npx Graphra mcp
 */

import { startMcpServer } from "./mcpServer";

startMcpServer().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
