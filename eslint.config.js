import js from "@eslint/js";
import globals from "globals";

export default [
  {
    files: ["src/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      eqeqeq: "error",
      "no-useless-assignment": "warn",
    },
  },
  {
    files: ["src/environment/chunkPayloadWorker.js"],
    languageOptions: {
      globals: {
        ...globals.worker,
      },
    },
  },
];
