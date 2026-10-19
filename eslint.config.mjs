import js from "@eslint/js"
import { defineConfig, globalIgnores } from "eslint/config"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import globals from "globals"
import tseslint from "typescript-eslint"

/** One lint config for every package; CI runs it from the repo root. */
export default defineConfig([
  globalIgnores(["**/dist", "**/.cloudflare", "**/node_modules"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: {
      "react-refresh/only-export-components": "off",
      // A leading underscore marks a value that's deliberately unused, e.g. a field split off with rest.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // These check code for the React Compiler, which Eos doesn't use. They flag
      // deliberate patterns such as reading the latest value from a ref.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "no-restricted-imports": [
        "error",
        {
          name: "cn",
          message:
            "Import cn from @workspace/ui/lib/utils. It knows Eos's text-* sizes; the stock cn treats text-body as a colour and drops classes like text-primary-foreground.",
        },
      ],
    },
  },
  {
    // Tests poke at loosely typed tool results.
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
])
