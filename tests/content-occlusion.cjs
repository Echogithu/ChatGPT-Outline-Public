// 模拟 Mac Retina 视窗及原生侧栏，检查打开目录后正文和输入框的边界。
const assert = require("node:assert/strict");
const path = require("node:path");
const { launchBrowser } = require("./browser-launch.cjs");
const root = path.resolve(__dirname, "..");
const manifest = require("../manifest.json");
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;display:flex;height:100vh;font:16px system-ui;background:#111;color:white}
nav{width:240px;flex-shrink:0}main{flex:1;min-width:0;display:flex;flex-direction:column}
.history{overflow:auto;flex:1;min-height:0}article,.composer{width:calc(100% - 64px);max-width:768px;margin:24px auto}
article{min-height:160px}h2{margin-top:0}.composer{padding:16px;background:#333;border-radius:16px}
</style></head><body><nav aria-label="原生会话列表">会话</nav><main><div class="history">
<article data-message-id="q1"><div data-message-author-role="user" data-reader>为什么目录会挡住当前 Mac 屏幕里的正文？</div></article>
<article data-message-id="a1"><div data-message-author-role="assistant" data-reader><div class="markdown"><h2>详细版</h2><p>这段正文应完整可见，展开目录时右侧文字不能被面板盖住。</p></div></div></article>
</div><div class="composer" data-reader><input placeholder="询问 ChatGPT"></div></main></body></html>`;

(async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1512, height: 767 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://chatgpt.com/**", route => route.fulfill({ contentType: "text/html", body: fixture }));
    await page.addInitScript(() => {
      window.storageListeners = [];
      window.browser = { storage: { local: { get: async () => ({}), set: async () => {} },
        onChanged: { addListener: listener => window.storageListeners.push(listener) } } };
    });
    await page.goto("https://chatgpt.com/c/occlusion-test");
    await page.addStyleTag({ path: path.join(root, "src/content/styles.css") });
    for (const script of manifest.content_scripts[0].js) await page.addScriptTag({ path: path.join(root, script) });
    await page.waitForSelector(".chatgpt-helper-sidebar__item", { state: "attached" });
    await page.evaluate(() => window.storageListeners.forEach(listener => listener({ theme: { newValue: "dark" } }, "local")));
    await page.locator(".chatgpt-helper-sidebar__rail").dispatchEvent("mouseenter");
    await page.locator('.chatgpt-helper-sidebar button[aria-label="固定面板"]').click();
    await page.waitForFunction(() => document.querySelector(".chatgpt-helper-sidebar").dataset.loading === "false");
    const bounds = await page.evaluate(() => {
      const panel = document.querySelector(".chatgpt-helper-sidebar__card").getBoundingClientRect();
      return { panelLeft: panel.left, readerRight: Math.max(...Array.from(document.querySelectorAll("[data-reader]"), el => el.getBoundingClientRect().right)) };
    });
    assert.ok(bounds.readerRight <= bounds.panelLeft - 8, `正文／输入框被目录遮挡：${JSON.stringify(bounds)}`);
    console.log("通过：Mac 1512px Retina 视窗展开目录后，正文和输入框不被遮挡");
    await page.screenshot({ path: path.join(root, ".claude/content-occlusion-mac.png") });

    async function closePanels() {
      await page.mouse.move(300, 20);
      for (const selector of [".chatgpt-helper-sidebar", ".chatgpt-helper-message-outline"]) {
        await page.locator(selector).dispatchEvent("keydown", { key: "Escape" });
      }
    }
    let cases = 0;
    for (const width of [1024, 1280, 1440, 1512, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const layout of ["merged", "merged-left", "questions-left", "outline-left"]) {
        await closePanels();
        await page.evaluate(value => window.storageListeners.forEach(listener => listener({ layout: { newValue: value } }, "local")), layout);
        for (const selector of [".chatgpt-helper-sidebar", ".chatgpt-helper-message-outline"]) {
          const panel = page.locator(selector);
          if (!await panel.isVisible()) continue;
          const rail = await panel.locator('[class$="__rail"]').boundingBox();
          await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2);
          await panel.getByRole("button", { name: "固定面板", exact: true }).click();
        }
        await page.waitForTimeout(250);
        const result = await page.evaluate(() => {
          const readers = Array.from(document.querySelectorAll("[data-reader]"), el => el.getBoundingClientRect());
          const panels = Array.from(document.querySelectorAll('.chatgpt-helper-sidebar[data-expanded="true"], .chatgpt-helper-message-outline[data-expanded="true"]'))
            .filter(el => getComputedStyle(el).display !== "none")
            .map(el => ({ side: el.dataset.side, rect: el.querySelector('[class$="__card"]').getBoundingClientRect() }));
          return { clear: panels.every(({ side, rect }) => readers.every(reader => side === "right" ? reader.right <= rect.left - 8 : reader.left >= rect.right + 8)), overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.equal(result.clear, true, `${width}px ${layout}：正文和输入框不与面板重叠`);
        assert.equal(result.overflow, false, `${width}px ${layout}：页面无横向溢出`);
        await closePanels();
        assert.deepEqual(await page.locator("main").evaluate(el => [getComputedStyle(el).paddingLeft, getComputedStyle(el).paddingRight]), ["0px", "0px"], "收起恢复原留白");
        cases++;
      }
    }
    console.log(`通过：${cases} 组视窗／四布局，单侧及双侧均不遮挡；收起恢复原布局`);

    await page.addStyleTag({ content: "main{padding-left:20px;padding-right:24px}@media(max-width:1100px){main{padding-left:8px;padding-right:12px}}" });
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("main")).paddingRight === "12px");
    assert.equal(await page.locator("main").evaluate(el => getComputedStyle(el).paddingLeft), "8px", "保留响应式原生留白");
    await page.setViewportSize({ width: 1512, height: 767 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector("main")).paddingRight === "24px");
    await page.locator(".chatgpt-helper-sidebar__rail").dispatchEvent("mouseenter");
    await page.evaluate(() => {
      const previous = document.querySelector("main");
      const next = document.createElement("main");
      next.innerHTML = previous.innerHTML;
      previous.replaceWith(next);
      history.pushState({}, "", "/c/next-occlusion");
    });
    await page.waitForSelector("main[data-chatgpt-helper-content]");
    await closePanels();
    assert.equal(await page.locator("main").evaluate(el => getComputedStyle(el).paddingRight), "24px", "替换会话 main 后仍能恢复");
    await page.evaluate(() => { history.pushState({}, "", "/"); document.querySelector("main").innerHTML = "<p>新会话主页</p>"; });
    await page.waitForFunction(() => !document.querySelector("main").hasAttribute("data-chatgpt-helper-content"));
    assert.deepEqual(errors, []);
    console.log("通过：响应式留白、会话根节点替换和主页清理，无页面异常");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
