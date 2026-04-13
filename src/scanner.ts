import { globby } from "globby";
import { ScanConfig } from "./types";

/**
 * ES-1.1 — File Scanner
 * Scans the workspace and returns relevant source file paths.
 *
 * - Only returns .ts/.js files
 * - Respects include/ignore patterns
 * - Works on large repos
 */

const DEFAULT_CONFIG: ScanConfig = {
  include: ["src/**/*.ts", "src/**/*.js"],
  ignore: ["node_modules/**", "dist/**", ".graphra/**"],
};

/** Patterns that are ALWAYS ignored regardless of user config */
const ALWAYS_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.git/**",
  "**/.graphra/**",
];

export async function scanFiles(
  config: Partial<ScanConfig> = {}
): Promise<string[]> {
  const merged: ScanConfig = {
    include: config.include ?? DEFAULT_CONFIG.include,
    ignore: [
      ...ALWAYS_IGNORE,
      ...(config.ignore ?? DEFAULT_CONFIG.ignore),
    ],
  };

  // Deduplicate ignore patterns
  merged.ignore = [...new Set(merged.ignore)];

  const files = await globby(merged.include, {
    ignore: merged.ignore,
    absolute: true,
    onlyFiles: true,
    gitignore: true, // Also respect .gitignore
  });

  // Filter to only .ts and .js files (safety net)
  return files.filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
}
