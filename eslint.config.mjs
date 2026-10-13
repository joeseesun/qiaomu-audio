import obsidianmd from "eslint-plugin-obsidianmd";

// The community scanner runs this rule set and publishes the result, so warnings matter here.
export default [
  { ignores: ["main.js", "node_modules/**"] },
  ...obsidianmd.configs.recommended,
  {
    // Node-only tests and dev scripts: never bundled into the plugin.
    files: ["tests/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { globals: { setImmediate: "readonly", process: "readonly", console: "readonly", Buffer: "readonly", macSpeechPlatform: "writable" } },
    rules: {
      "obsidianmd/no-nodejs-modules": "off", "obsidianmd/no-global-this": "off", "obsidianmd/rule-custom-message": "off",
      "no-console": "off", "no-unsanitized/method": "off",
    },
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        activeDocument: "readonly", activeWindow: "readonly", document: "readonly", window: "readonly", globalThis: "readonly",
        console: "readonly", setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
        createFragment: "readonly", TextEncoder: "readonly", TextDecoder: "readonly", URL: "readonly", Blob: "readonly",
        Intl: "readonly", AbortController: "readonly", WebSocket: "readonly",
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", { mode: "loose", brands: ["Qiaomu Audio", "Qiaomu Reader", "SenseVoice", "Edge", "SiliconFlow", "OpenAI", "Groq", "Whisper"] }],
    },
  },
];
