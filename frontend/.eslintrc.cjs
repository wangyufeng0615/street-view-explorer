module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  ignorePatterns: ["build/", "node_modules/"],
  overrides: [
    {
      files: ["**/*.{js,jsx}"],
      extends: ["eslint:recommended", "plugin:react/recommended", "prettier"],
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      rules: {
        "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        "react/prop-types": "off",
        "react/react-in-jsx-scope": "off",
      },
    },
    {
      files: ["**/*.{ts,tsx}"],
      parser: "@typescript-eslint/parser",
      plugins: ["@typescript-eslint", "react"],
      extends: [
        "eslint:recommended",
        "plugin:react/recommended",
        "plugin:@typescript-eslint/recommended",
        "prettier",
      ],
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      rules: {
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        "react/prop-types": "off",
        "react/react-in-jsx-scope": "off",
      },
    },
    {
      files: ["**/*.test.{js,jsx,ts,tsx}", "src/test/**/*.{js,jsx,ts,tsx}"],
      globals: {
        afterAll: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        beforeEach: "readonly",
        describe: "readonly",
        expect: "readonly",
        it: "readonly",
        vi: "readonly",
      },
    },
  ],
};
