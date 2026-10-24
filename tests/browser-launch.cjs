// 浏览器仅用于回归测试，不是插件运行依赖。
const { chromium, firefox } = require("playwright");

async function launchBrowser() {
  const engine = process.env.BROWSER || "chromium";
  if (!["chromium", "edge", "firefox"].includes(engine)) throw new Error(`未知测试浏览器：${engine}`);
  const executablePath = engine === "firefox" ? process.env.FIREFOX_PATH
    : engine === "edge" ? (process.env.EDGE_PATH || process.env.CHROME_PATH || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
      : (process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  const browser = await (engine === "firefox" ? firefox : chromium).launch({ headless: true, executablePath });
  console.log(`测试浏览器：${engine} ${browser.version()}`);
  return browser;
}

module.exports = { launchBrowser };
