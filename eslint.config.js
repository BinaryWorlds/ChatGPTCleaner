import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".output/**", ".wxt/**", "coverage/**", "node_modules/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-console": "error",
    },
  },
  {
    files: ["src/infrastructure/observability/logger.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettier,
);
