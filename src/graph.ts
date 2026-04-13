import { Project } from "ts-morph";
import * as path from "path";
import { DependencyGraph } from "./types";

/**
 * Graph Builder — builds a file-level dependency graph from import/require statements.
 * Storage is handled by storage.ts (SQLite).
 */

/** Build the dependency graph for a set of files.
 *  Supports both ES `import` and CommonJS `require()`. */
export function buildGraph(filePaths: string[]): DependencyGraph {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const graph: DependencyGraph = {};

  for (const fp of filePaths) {
    project.addSourceFileAtPath(fp);
  }

  const fileSet = new Set(filePaths.map((f) => path.resolve(f)));

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = path.resolve(sourceFile.getFilePath());
    const deps: string[] = [];
    const dir = path.dirname(filePath);

    // --- ES imports: import x from './y' ---
    for (const imp of sourceFile.getImportDeclarations()) {
      const moduleSpecifier = imp.getModuleSpecifierValue();
      if (moduleSpecifier.startsWith(".")) {
        const resolved = resolveImport(dir, moduleSpecifier, fileSet);
        if (resolved) deps.push(resolved);
      }
    }

    // --- CommonJS require(): const x = require('./y') ---
    // Scan the raw source text for require('...') patterns
    const sourceText = sourceFile.getFullText();
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = requireRegex.exec(sourceText)) !== null) {
      const specifier = match[1];
      if (specifier.startsWith(".")) {
        const resolved = resolveImport(dir, specifier, fileSet);
        if (resolved) deps.push(resolved);
      }
    }

    graph[filePath] = [...new Set(deps)];
  }

  return graph;
}

/** Resolve a relative import to an absolute file path */
function resolveImport(
  dir: string,
  moduleSpecifier: string,
  knownFiles: Set<string>
): string | null {
  const extensions = [".ts", ".js", "/index.ts", "/index.js"];
  const base = path.resolve(dir, moduleSpecifier);

  // Direct match
  if (knownFiles.has(base)) return base;

  // Try extensions
  for (const ext of extensions) {
    const candidate = base + ext;
    if (knownFiles.has(candidate)) return candidate;
  }

  return null;
}


