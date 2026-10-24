(function initSettings(global) {
  const state = global.__CHATGPT_HELPER__ = global.__CHATGPT_HELPER__ || {};
  state.extensionApi = global.browser || global.chrome;
  state.settings = {
    DEFAULT_LAYOUT: "merged",
    DEFAULT_THEME: "light",
    normalizeLayout(value) {
      return ["questions-left", "outline-left", "merged", "merged-left"].includes(value) ? value : "merged";
    },
    normalizeTheme(value) { return value === "dark" ? "dark" : "light"; }
  };
})(globalThis);
