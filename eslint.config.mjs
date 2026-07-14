import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([{
    ignores: [
        // Build output / generated
        ".next/**",
        "out/**",
        "build/**",
        "dist/**",
        "coverage/**",
        // Separate sub-projects with their own toolchain (not part of the
        // Next.js app source that `next lint` used to scope to)
        "workers/**",
        "supabase/**",
        "extension/**",
        // Utility scripts — not app source, has its own historically-relaxed
        // lint posture (require() imports, prefer-const looseness, etc.)
        "scripts/**",
        // Docs, plans, backups, and misc non-source content (mirrors .gitignore)
        "docs/**",
        "plans/**",
        "backups/**",
        "srtsource/**",
        "audit/**",
        "audit-mobile/**",
        // AI agent / editor tooling directories (mirrors .gitignore)
        ".agent/**",
        ".agents/**",
        ".claude/**",
        ".cursor/**",
        ".gemini/**",
        ".hermes/**",
        ".kiro/**",
        ".playwright-mcp/**",
        ".qwen/**",
        ".trae/**",
        ".venv/**",
        ".windsurf/**",
        ".vs/**",
        ".vscode/**",
        ".github/**",
        "skills-lock.json",
    ],
}, {
    extends: [...nextCoreWebVitals, ...nextTypescript],

    rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/ban-ts-comment": "off",
        "@typescript-eslint/no-unused-vars": "off",
    },
}]);