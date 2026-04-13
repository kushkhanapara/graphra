import { Project, SyntaxKind, SourceFile, Node } from "ts-morph";
import { Chunk } from "./types";
import { md5 } from "./utils/hash";

/**
 * ES-2.1 — AST Chunk Extraction
 * Parses a file using ts-morph and extracts functions/classes as individual chunks.
 *
 * - Each function/class/method is a separate chunk
 * - No full-file chunks
 */

const project = new Project({ skipAddingFilesFromTsConfig: true });

export function chunkFile(filePath: string): Chunk[] {
  const sourceFile = project.addSourceFileAtPath(filePath);
  const chunks: Chunk[] = [];

  // Extract top-level functions
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName() ?? "anonymous";
    const code = fn.getFullText().trim();
    chunks.push({
      id: `${filePath}#${name}`,
      file: filePath,
      type: "function",
      name,
      code,
      hash: md5(code),
    });
  }

  // Extract classes and their methods
  for (const cls of sourceFile.getClasses()) {
    const className = cls.getName() ?? "anonymous";
    const classCode = cls.getFullText().trim();
    chunks.push({
      id: `${filePath}#${className}`,
      file: filePath,
      type: "class",
      name: className,
      code: classCode,
      hash: md5(classCode),
    });

    for (const method of cls.getMethods()) {
      const methodName = `${className}.${method.getName()}`;
      const methodCode = method.getFullText().trim();
      chunks.push({
        id: `${filePath}#${methodName}`,
        file: filePath,
        type: "method",
        name: methodName,
        code: methodCode,
        hash: md5(methodCode),
      });
    }
  }

  // Extract arrow functions (exported and non-exported top-level)
  for (const varStmt of sourceFile.getVariableStatements()) {
    for (const decl of varStmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init && init.getKind() === SyntaxKind.ArrowFunction) {
        const name = decl.getName();
        const code = varStmt.getFullText().trim();
        chunks.push({
          id: `${filePath}#${name}`,
          file: filePath,
          type: "arrow-function",
          name,
          code,
          hash: md5(code),
        });
      } else if (varStmt.isExported() && init) {
        // Exported constants (objects, arrays, primitives — not arrow functions)
        const name = decl.getName();
        const code = varStmt.getFullText().trim();
        chunks.push({
          id: `${filePath}#${name}`,
          file: filePath,
          type: "constant",
          name,
          code,
          hash: md5(code),
        });
      }
    }
  }

  // Extract interfaces
  for (const iface of sourceFile.getInterfaces()) {
    const name = iface.getName();
    const code = iface.getFullText().trim();
    chunks.push({
      id: `${filePath}#${name}`,
      file: filePath,
      type: "interface",
      name,
      code,
      hash: md5(code),
    });
  }

  // Extract type aliases
  for (const typeAlias of sourceFile.getTypeAliases()) {
    const name = typeAlias.getName();
    const code = typeAlias.getFullText().trim();
    chunks.push({
      id: `${filePath}#${name}`,
      file: filePath,
      type: "type-alias",
      name,
      code,
      hash: md5(code),
    });
  }

  // Clean up to avoid memory leaks on repeated calls
  project.removeSourceFile(sourceFile);

  return chunks;
}
