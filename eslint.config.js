// @ts-check
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // ── Ignored paths ──────────────────────────────────────────────────────────
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/target/**", "**/*.d.ts", "src-tauri/**"],
  },

  // ── TypeScript base rules (all TS/TSX files) ───────────────────────────────
  ...tseslint.configs.recommended,

  // ── React hooks rules (UI package only) ───────────────────────────────────
  // Use only the stable, well-established rules from react-hooks.
  // The v7 "recommended" config includes many experimental rules (immutability,
  // refs, set-state-in-effect, etc.) that flag valid React patterns and are
  // disabled here until they stabilise.
  {
    files: ["packages/ui/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // ── Project-wide custom rules ──────────────────────────────────────────────
  {
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      // Unused vars: error, but allow leading-underscore names to opt out
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Explicit any: warn — some uses are unavoidable (Tauri window detection, etc.)
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow empty catch blocks — intentional error suppression in Tauri invoke calls
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // ── Disable formatting rules that conflict with Prettier ───────────────────
  prettierConfig
);
