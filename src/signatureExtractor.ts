/**
 * Signature Extractor — Aider-style approach.
 *
 * Instead of generating text summaries, we extract the ACTUAL code signature
 * (function declaration line, class declaration, interface shape, etc.)
 * This is what gets stored and shown to the AI — real code, not lossy summaries.
 */

import { Chunk } from "./types";

/**
 * Extract the signature (declaration line) from a chunk's code.
 * Returns the actual code line(s) that define the function/class/interface.
 *
 * Examples:
 *   "export async function ssoLogin(accessToken, newUser, session, sessionDetails, keepSessionActive) {"
 *   "class CronJobScheduler {"
 *   "interface ScanConfig { include: string[]; ignore: string[]; }"
 */
export function extractSignature(chunk: Chunk): string {
  const code = chunk.code;
  const lines = code.split("\n");

  switch (chunk.type) {
    case "interface":
    case "type-alias":
      return extractInterfaceSignature(lines, chunk.name);

    case "class":
      return extractClassSignature(lines, chunk.name);

    case "function":
    case "method":
    case "arrow-function":
      return extractFunctionSignature(lines, chunk.name);

    case "constant":
      return extractConstantSignature(lines, chunk.name);

    default:
      return lines[0]?.trim() ?? chunk.name;
  }
}

/** Extract function/method signature up to the opening brace */
function extractFunctionSignature(lines: string[], name: string): string {
  // Skip JSDoc/comments
  let start = 0;
  while (
    start < lines.length &&
    (lines[start].trim().startsWith("*") ||
      lines[start].trim().startsWith("/**") ||
      lines[start].trim().startsWith("//") ||
      lines[start].trim().startsWith("/*") ||
      lines[start].trim() === "")
  ) {
    start++;
  }

  // Collect lines until we hit the opening brace
  let sig = "";
  for (let i = start; i < lines.length && i < start + 10; i++) {
    const line = lines[i].trim();
    sig += (sig ? " " : "") + line;

    if (line.includes("{")) {
      // Remove everything after the opening brace
      sig = sig.replace(/\s*\{[\s\S]*$/, "").trim();
      break;
    }
    if (line.includes("=>")) {
      // Arrow function — keep up to =>
      sig = sig.replace(/\s*=>[\s\S]*$/, " =>").trim();
      break;
    }
  }

  return sig || name;
}

/** Extract class signature (class name + constructor params if present) */
function extractClassSignature(lines: string[], name: string): string {
  // Get the class declaration line
  const classLine = lines.find((l) =>
    /^\s*(?:export\s+)?class\s/.test(l)
  );

  if (!classLine) return `class ${name}`;

  let sig = classLine.trim();
  if (sig.includes("{")) {
    sig = sig.replace(/\s*\{.*$/, "").trim();
  }

  // Also extract method names for a compact overview
  const methods: string[] = [];
  for (const line of lines) {
    // Match method declarations: "  methodName(" or "  async methodName("
    const methodMatch = line.match(
      /^\s+(?:async\s+)?(\w+)\s*\(/
    );
    if (methodMatch && methodMatch[1] !== "constructor") {
      methods.push(methodMatch[1]);
    }
  }

  if (methods.length > 0) {
    sig += ` { ${methods.join(", ")} }`;
  }

  return sig;
}

/** Extract interface/type signature with member names */
function extractInterfaceSignature(lines: string[], name: string): string {
  // Get the declaration line
  const declLine = lines.find((l) =>
    /^\s*(?:export\s+)?(?:interface|type)\s/.test(l)
  );

  if (!declLine) return `interface ${name}`;

  // For short interfaces, return the whole thing (up to 200 chars)
  const fullCode = lines.join("\n").trim();
  if (fullCode.length <= 200) {
    return fullCode;
  }

  // For longer ones, extract member names
  const members: string[] = [];
  for (const line of lines) {
    const memberMatch = line.match(/^\s+(\w+)\s*[?]?\s*:/);
    if (memberMatch) {
      members.push(memberMatch[1]);
    }
  }

  let sig = declLine.trim();
  if (sig.includes("{")) {
    sig = sig.replace(/\s*\{.*$/, "").trim();
  }

  if (members.length > 0) {
    sig += ` { ${members.join(", ")} }`;
  }

  return sig;
}

/** Extract constant signature */
function extractConstantSignature(lines: string[], name: string): string {
  // Skip comments
  let start = 0;
  while (
    start < lines.length &&
    (lines[start].trim().startsWith("*") ||
      lines[start].trim().startsWith("/**") ||
      lines[start].trim().startsWith("//") ||
      lines[start].trim().startsWith("/*") ||
      lines[start].trim() === "")
  ) {
    start++;
  }

  const line = lines[start]?.trim() ?? `const ${name}`;

  // If it's a short one-liner, return it
  if (line.length <= 150) return line;

  // Otherwise truncate
  return line.slice(0, 150) + "...";
}

/**
 * Build a compact text representation for embedding/search.
 * Combines: file path + name + signature + JSDoc (if any) + body keywords.
 * This is what gets embedded — NOT the full code.
 */
export function buildSearchableText(chunk: Chunk, signature: string): string {
  const parts: string[] = [];

  // File context (just the filename, not full path)
  const fileName = chunk.file.split(/[/\\]/).pop() ?? "";
  parts.push(fileName);

  // Humanized name
  const humanName = chunk.name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\./g, " ")
    .toLowerCase();
  parts.push(humanName);

  // Signature
  parts.push(signature);

  // JSDoc if present
  const jsdocMatch = chunk.code.match(/\/\*\*([\s\S]*?)\*\//);
  if (jsdocMatch) {
    const jsdocText = jsdocMatch[1]
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter((l) => l && !l.startsWith("@"))
      .join(" ");
    if (jsdocText) parts.push(jsdocText);
  }

  return parts.join(" ");
}
