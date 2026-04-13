/**
 * Graphra init — Zero-config project detection and setup.
 *
 * Auto-detects:
 *   - Language (JS/TS, Python, Go, Rust, Java, etc.)
 *   - Framework (Express, React, Next.js, Django, FastAPI, etc.)
 *   - Project structure (monorepo, MVC, microservices, etc.)
 *   - Package manager (npm, yarn, pnpm, pip, cargo, go mod)
 *   - Test framework (jest, mocha, pytest, etc.)
 *
 * Generates .graphra/config.json with optimal settings.
 */

import * as fs from "fs";
import * as path from "path";

export interface ProjectConfig {
  version: string;
  language: string[];
  framework: string[];
  structure: string;
  include: string[];
  ignore: string[];
  testPatterns: string[];
  entryPoints: string[];
}

interface Detection {
  languages: Set<string>;
  frameworks: Set<string>;
  structure: string;
  testPatterns: string[];
  entryPoints: string[];
}

/** Detect project language from files and config */
function detectLanguages(root: string): Set<string> {
  const langs = new Set<string>();
  const files = fs.readdirSync(root, { withFileTypes: true });

  for (const f of files) {
    if (f.name === "package.json" || f.name === "tsconfig.json") langs.add("javascript");
    if (f.name === "tsconfig.json" || f.name.endsWith(".ts")) langs.add("typescript");
    if (f.name === "requirements.txt" || f.name === "pyproject.toml" || f.name === "setup.py" || f.name === "Pipfile") langs.add("python");
    if (f.name === "go.mod" || f.name === "go.sum") langs.add("go");
    if (f.name === "Cargo.toml") langs.add("rust");
    if (f.name === "pom.xml" || f.name === "build.gradle" || f.name === "build.gradle.kts") langs.add("java");
    if (f.name === "Gemfile") langs.add("ruby");
    if (f.name === "composer.json") langs.add("php");
    if (f.name === "Package.swift") langs.add("swift");
    if (f.name === "pubspec.yaml") langs.add("dart");
    if (f.name === ".csproj" || f.name.endsWith(".sln")) langs.add("csharp");
  }

  // Scan src/ for file extensions if no config files found
  if (langs.size === 0) {
    const exts = new Map<string, string>([
      [".ts", "typescript"], [".tsx", "typescript"],
      [".js", "javascript"], [".jsx", "javascript"],
      [".py", "python"], [".go", "go"], [".rs", "rust"],
      [".java", "java"], [".rb", "ruby"], [".php", "php"],
    ]);
    try {
      const srcFiles = fs.readdirSync(path.join(root, "src"), { recursive: true }) as string[];
      for (const f of srcFiles) {
        const ext = path.extname(String(f));
        if (exts.has(ext)) langs.add(exts.get(ext)!);
      }
    } catch { /* no src dir */ }
  }

  return langs;
}

/** Detect framework from package.json, requirements.txt, etc. */
function detectFrameworks(root: string): Set<string> {
  const frameworks = new Set<string>();

  // Node.js frameworks
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (allDeps["express"]) frameworks.add("express");
    if (allDeps["fastify"]) frameworks.add("fastify");
    if (allDeps["koa"]) frameworks.add("koa");
    if (allDeps["next"]) frameworks.add("nextjs");
    if (allDeps["nuxt"]) frameworks.add("nuxt");
    if (allDeps["react"]) frameworks.add("react");
    if (allDeps["vue"]) frameworks.add("vue");
    if (allDeps["angular"]) frameworks.add("angular");
    if (allDeps["svelte"]) frameworks.add("svelte");
    if (allDeps["nestjs"] || allDeps["@nestjs/core"]) frameworks.add("nestjs");
    if (allDeps["prisma"] || allDeps["@prisma/client"]) frameworks.add("prisma");
    if (allDeps["mongoose"]) frameworks.add("mongoose");
    if (allDeps["sequelize"]) frameworks.add("sequelize");
    if (allDeps["typeorm"]) frameworks.add("typeorm");
  } catch { /* no package.json */ }

  // Python frameworks
  try {
    const req = fs.readFileSync(path.join(root, "requirements.txt"), "utf-8");
    if (/django/i.test(req)) frameworks.add("django");
    if (/flask/i.test(req)) frameworks.add("flask");
    if (/fastapi/i.test(req)) frameworks.add("fastapi");
  } catch { /* no requirements.txt */ }

  return frameworks;
}

/** Detect project structure pattern */
function detectStructure(root: string): string {
  const dirs = new Set<string>();
  try {
    for (const f of fs.readdirSync(root, { withFileTypes: true })) {
      if (f.isDirectory()) dirs.add(f.name.toLowerCase());
    }
  } catch { return "unknown"; }

  // Monorepo
  if (dirs.has("packages") || dirs.has("apps") || dirs.has("services")) {
    if (fs.existsSync(path.join(root, "lerna.json")) ||
        fs.existsSync(path.join(root, "pnpm-workspace.yaml")) ||
        fs.existsSync(path.join(root, "turbo.json"))) {
      return "monorepo";
    }
    return "multi-package";
  }

  // MVC / layered
  if (dirs.has("controllers") || dirs.has("components")) {
    if (dirs.has("services") || dirs.has("models") || dirs.has("dal")) return "mvc-layered";
    return "component-based";
  }

  // Feature-based
  if (dirs.has("features") || dirs.has("modules")) return "feature-based";

  // Simple
  if (dirs.has("src")) return "src-based";

  return "flat";
}

/** Build include/ignore patterns based on detection */
function buildPatterns(detection: Detection): { include: string[]; ignore: string[] } {
  const include: string[] = [];
  const ignore = [
    "node_modules/**", "dist/**", "build/**", ".git/**",
    "coverage/**", ".next/**", ".nuxt/**", "__pycache__/**",
    "*.min.js", "*.bundle.js", "*.map",
  ];

  for (const lang of detection.languages) {
    switch (lang) {
      case "typescript": include.push("**/*.ts", "**/*.tsx"); break;
      case "javascript": include.push("**/*.js", "**/*.jsx"); break;
      case "python": include.push("**/*.py"); break;
      case "go": include.push("**/*.go"); break;
      case "rust": include.push("**/*.rs"); break;
      case "java": include.push("**/*.java"); break;
      case "ruby": include.push("**/*.rb"); break;
      case "php": include.push("**/*.php"); break;
    }
  }

  if (include.length === 0) include.push("**/*.ts", "**/*.js");

  return { include: [...new Set(include)], ignore };
}

/** Detect test patterns */
function detectTestPatterns(root: string): string[] {
  const patterns: string[] = [];

  if (fs.existsSync(path.join(root, "jest.config.js")) ||
      fs.existsSync(path.join(root, "jest.config.ts"))) {
    patterns.push("**/*.test.ts", "**/*.test.js", "**/*.spec.ts", "**/*.spec.js");
  }

  if (fs.existsSync(path.join(root, ".mocharc.yml")) ||
      fs.existsSync(path.join(root, ".mocharc.json"))) {
    patterns.push("test/**/*.js", "test/**/*.ts");
  }

  if (fs.existsSync(path.join(root, "pytest.ini")) ||
      fs.existsSync(path.join(root, "pyproject.toml"))) {
    patterns.push("tests/**/*.py", "test_*.py");
  }

  // Fallback
  if (patterns.length === 0) {
    patterns.push("test/**", "tests/**", "**/*.test.*", "**/*.spec.*");
  }

  return patterns;
}

/** Detect entry points */
function detectEntryPoints(root: string): string[] {
  const entries: string[] = [];

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
    if (pkg.main) entries.push(pkg.main);
    if (pkg.bin) {
      const bins = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin);
      entries.push(...(bins as string[]));
    }
  } catch { /* no package.json */ }

  // Common entry points
  const common = ["src/index.ts", "src/index.js", "src/main.ts", "src/main.js", "app.js", "app.ts", "server.js", "server.ts", "index.js", "index.ts"];
  for (const f of common) {
    if (fs.existsSync(path.join(root, f))) entries.push(f);
  }

  return [...new Set(entries)];
}

/** Run full project detection and generate config */
export function initProject(root: string = "."): ProjectConfig {
  const absRoot = path.resolve(root);

  const detection: Detection = {
    languages: detectLanguages(absRoot),
    frameworks: detectFrameworks(absRoot),
    structure: detectStructure(absRoot),
    testPatterns: detectTestPatterns(absRoot),
    entryPoints: detectEntryPoints(absRoot),
  };

  const { include, ignore } = buildPatterns(detection);

  const config: ProjectConfig = {
    version: "2.0.0",
    language: Array.from(detection.languages),
    framework: Array.from(detection.frameworks),
    structure: detection.structure,
    include,
    ignore,
    testPatterns: detection.testPatterns,
    entryPoints: detection.entryPoints,
  };

  // Save config
  const configDir = path.join(absRoot, ".graphra");
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "config.json"),
    JSON.stringify(config, null, 2)
  );

  return config;
}

/** Load existing config or return null */
export function loadProjectConfig(root: string = "."): ProjectConfig | null {
  try {
    const configPath = path.join(path.resolve(root), ".graphra", "config.json");
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch { /* corrupted */ }
  return null;
}
