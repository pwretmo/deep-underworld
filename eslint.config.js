import js from "@eslint/js";
import globals from "globals";

export default [
  // Global ignore — must be a standalone object with ONLY ignores
  { ignores: ["src/generated/**"] },

  js.configs.recommended,

  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
      "no-undef": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },

  // Web Worker override
  {
    files: ["src/environment/chunkPayloadWorker.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        postMessage: "readonly",
      },
    },
  },
];
