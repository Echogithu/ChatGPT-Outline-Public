// 在独立测试配置中安装原生扩展；不注入脚本或伪造 storage API，不访问真实账号。
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const root = process.env.EXTENSION_ROOT ? path.resolve(process.env.EXTENSION_ROOT) : path.resolve(__dirname, "..");
const engine = process.env.BROWSER || "edge";
const messages = Array.from({ length: 4 }, (_, i) => `<article data-message-id="q${i}"><div data-message-author-role="user">问题${i + 1}</div></article><article data-message-id="a${i}"><div data-message-author-role="assistant"><div class="markdown"><h2>章节${i + 1}</h2><p>回答正文</p></div></div></article>`).join("");
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{height:100%;overflow:hidden;margin:0}main{height:100%;overflow:auto;width:900px;margin:auto}article{min-height:350px}</style></head><body><main>${messages}</main></body></html>`;

(async () => {
  assert.ok(["edge", "firefox", "chromium"].includes(engine), "选择已支持的测试浏览器");
  if (engine === "firefox") return runFirefox();
  let context;
  try {
    let extensionOrigin;
    const shared = { headless: true, viewport: { width: 1440, height: 900 } };
    context = await chromium.launchPersistentContext("", { ...shared,
      executablePath: engine === "edge" ? (process.env.EDGE_PATH || "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
        : (process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      args: ["--enable-unsafe-extension-debugging"], ignoreDefaultArgs: ["--disable-extensions"]
    });
    const session = await context.browser().newBrowserCDPSession();
    const { id } = await session.send("Extensions.loadUnpacked", { path: root });
    extensionOrigin = `chrome-extension://${id}`;
    await session.detach();
    console.log(`原生扩展测试：${engine} ${context.browser().version()}`);
    const errors = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    await context.route("https://chatgpt.com/**", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture }));
    const options = await context.newPage();
    await options.goto(extensionOrigin + "/src/options/options.html");
    await options.waitForFunction(() => !document.querySelector("fieldset").disabled);
    assert.equal(await options.locator('input[name="theme"]:checked').inputValue(), "light");
    const page = await context.newPage();
    await page.goto("https://chatgpt.com/c/native-browser-test");
    await page.waitForFunction(() => document.documentElement.dataset.chatgptHelperLayout === "merged");
    await page.waitForFunction(() => document.querySelectorAll(".chatgpt-helper-sidebar__group").length === 4);
    assert.equal(await page.locator(".chatgpt-helper-sidebar__group").count(), 4);
    assert.equal(await page.evaluate(() => typeof window.__CHATGPT_HELPER__), "undefined", "内容脚本在隔离环境中运行");
    for (const layout of ["merged-left", "questions-left", "outline-left", "merged"]) {
      await options.locator(`input[name="layout"][value="${layout}"]`).check();
      await options.getByRole("button", { name: "保存设置" }).click();
      await page.waitForFunction(value => document.documentElement.dataset.chatgptHelperLayout === value, layout);
    }
    await options.locator('input[name="theme"][value="dark"]').check();
    await page.waitForFunction(() => document.documentElement.dataset.chatgptHelperTheme === "dark");
    await options.reload();
    await options.waitForFunction(() => !document.querySelector("fieldset").disabled);
    assert.equal(await options.locator('input[name="theme"]:checked').inputValue(), "dark");
    console.log("通过：原生安装、隔离内容脚本、四种布局实时同步、主题保存与重读");

    const rail = await page.locator(".chatgpt-helper-sidebar__rail").boundingBox();
    await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2);
    await page.getByRole("button", { name: "固定面板", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".chatgpt-helper-sidebar").dataset.loading === "false", null, { timeout: 30000 });
    await options.waitForFunction(async () => {
      const values = await (globalThis.browser || globalThis.chrome).storage.local.get("outlineDirectory:v1:native-browser-test");
      return values["outlineDirectory:v1:native-browser-test"]?.complete === true;
    });
    await page.getByRole("button", { name: "回到整个会话历史顶部", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main").scrollTop === 0);
    await page.getByRole("button", { name: "回到整个会话历史底部", exact: true }).click();
    await page.waitForFunction(() => { const el = document.querySelector("main"); return Math.abs(el.scrollTop - (el.scrollHeight - el.clientHeight)) < 2; });
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.chatgptHelperTheme === "dark");
    const newRail = await page.locator(".chatgpt-helper-sidebar__rail").boundingBox();
    await page.mouse.move(newRail.x + newRail.width / 2, newRail.y + newRail.height / 2);
    await page.getByRole("button", { name: "固定面板", exact: true }).click();
    assert.equal(await page.locator(".chatgpt-helper-sidebar__group").count(), 4);
    await page.waitForTimeout(600);
    assert.equal(await page.locator(".chatgpt-helper-loading-notice").isVisible(), false, "刷新命中原生缓存无需再次扫描");
    await page.evaluate(() => {
      history.pushState({}, "", "/c/native-second-test");
      document.querySelector("main").innerHTML = '<article data-message-id="new-q"><div data-message-author-role="user">新会话问题</div></article>';
    });
    await page.waitForFunction(() => document.querySelectorAll(".chatgpt-helper-sidebar__group").length === 1);
    assert.ok((await page.locator(".chatgpt-helper-sidebar").textContent()).includes("新会话问题"));
    assert.deepEqual(errors, []);
    console.log("通过：原生目录缓存、刷新复用、整个会话首尾跳转、页面路由切换");
  } finally {
    await context?.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

async function runFirefox() {
  // Playwright 不支持 Firefox 扩展页面；原生安装测试使用 Selenium。
  const { Builder, By } = require("selenium-webdriver");
  const firefox = require("selenium-webdriver/firefox");
  const files = require("node:fs/promises");
  let addonDirectory;
  const options = new firefox.Options().addArguments("-headless").enableBidi()
    .setPreference("termsofuse.bypassNotification", true);
  if (process.env.FIREFOX_PATH) options.setBinary(process.env.FIREFOX_PATH);
  const service = new firefox.ServiceBuilder(process.env.GECKODRIVER_PATH).addArguments("--allow-system-access");
  let driver;
  const errors = [];
  const wait = script => driver.wait(() => driver.executeScript(script), 15000, script);
  const click = selector => driver.findElement(By.css(selector)).click();
  async function openPanel() {
    // 无界面 WebDriver 在普通页面也未产生悬停；此处验证原生 API，真实鼠标由布局回归覆盖。
    await driver.executeScript('document.querySelector(".chatgpt-helper-sidebar__rail").dispatchEvent(new MouseEvent("mouseenter"))');
    await wait('return document.querySelector(".chatgpt-helper-sidebar").dataset.expanded === "true" && getComputedStyle(document.querySelector(".chatgpt-helper-sidebar__card")).opacity === "1"');
  }
  try {
    // 只打包插件文件，避免读取 Git 元数据、临时锁和测试产物。
    addonDirectory = await files.mkdtemp(path.join(require("node:os").tmpdir(), "outline-addon-"));
    for (const entry of ["manifest.json", "src", "assets"]) {
      await files.cp(path.join(root, entry), path.join(addonDirectory, entry), { recursive: true });
    }
    driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).setFirefoxService(service).build();
    await driver.manage().setTimeouts({ pageLoad: 30000, script: 15000 });
    await driver.manage().window().setRect({ width: 1440, height: 1000 });
    const id = await driver.installAddon(addonDirectory, true);
    assert.equal(id, require(path.join(root, "manifest.json")).browser_specific_settings.gecko.id);
    // 仅在独立测试配置中读取安装后随机生成的内部 UUID。
    await driver.setContext(firefox.Context.CHROME);
    const installed = await driver.executeAsyncScript('const done=arguments[arguments.length-1];ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager.getAddonByID(arguments[0]).then(addon=>done({active:addon.isActive,disabled:addon.appDisabled,optionsURL:addon.optionsURL}),error=>done({error:String(error)}))', id);
    assert.equal(installed.active, true, JSON.stringify(installed));
    assert.equal(installed.disabled, false, JSON.stringify(installed));
    console.log("Firefox 配置入口：", installed.optionsURL);
    assert.ok(installed.optionsURL?.startsWith("moz-extension://"), "浏览器已注册原生配置入口");
    await driver.setContext(firefox.Context.CONTENT);
    console.log(`原生扩展测试：firefox ${(await driver.getCapabilities()).get("browserVersion")}`);
    const bidi = await driver.getBidi();
    (await bidi.socket).on("message", async message => {
      const event = JSON.parse(message.toString());
      if (event.method !== "network.beforeRequestSent" || !event.params.request.url.startsWith("https://chatgpt.com/")) return;
      try {
        const reply = await bidi.send({ method: "network.provideResponse", params: {
          request: event.params.request.request, statusCode: 200,
          headers: [{ name: "content-type", value: { type: "string", value: "text/html; charset=utf-8" } }],
          body: { type: "base64", value: Buffer.from(fixture).toString("base64") }
        } });
        assert.equal(reply.type, "success", JSON.stringify(reply));
      } catch (error) { errors.push(error.message); }
    });
    await bidi.subscribe("network.beforeRequestSent");
    const intercept = await bidi.send({ method: "network.addIntercept", params: {
      phases: ["beforeRequestSent"], urlPatterns: [{ type: "pattern", protocol: "https", hostname: "chatgpt.com" }]
    } });
    assert.equal(intercept.type, "success", JSON.stringify(intercept));
    // 从独立测试浏览器内部打开已注册的配置入口。
    await driver.setContext(firefox.Context.CHROME);
    await driver.executeScript('gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()})', installed.optionsURL);
    await driver.setContext(firefox.Context.CONTENT);
    await wait('return document.querySelector("fieldset")?.disabled === false');
    const optionsTab = await driver.getWindowHandle();
    await driver.switchTo().newWindow("tab");
    const chatTab = await driver.getWindowHandle();
    await driver.get("https://chatgpt.com/c/native-browser-test");
    await wait('return document.querySelectorAll(".chatgpt-helper-sidebar__group").length === 4');
    assert.equal(await driver.executeScript("return typeof window.__CHATGPT_HELPER__"), "undefined");
    for (const layout of ["merged-left", "questions-left", "outline-left", "merged"]) {
      await driver.switchTo().window(optionsTab);
      await click(`input[name="layout"][value="${layout}"]`);
      await click('button[type="submit"]');
      await driver.switchTo().window(chatTab);
      await wait(`return document.documentElement.dataset.chatgptHelperLayout === "${layout}"`);
    }
    await driver.switchTo().window(optionsTab);
    await click('input[name="theme"][value="dark"]');
    await wait('return document.querySelector("fieldset")?.disabled === false');
    await driver.navigate().refresh();
    await wait('return document.querySelector("fieldset")?.disabled === false');
    assert.equal(await driver.findElement(By.css('input[name="theme"][value="dark"]')).isSelected(), true);
    await driver.switchTo().window(chatTab);
    await wait('return document.documentElement.dataset.chatgptHelperTheme === "dark"');
    console.log("通过：原生安装、隔离内容脚本、四种布局实时同步、主题保存与重读");
    await openPanel();
    await click('.chatgpt-helper-sidebar button[aria-label="固定面板"]');
    await wait('return document.querySelector(".chatgpt-helper-sidebar").dataset.loading === "false"');
    await driver.switchTo().window(optionsTab);
    await driver.wait(() => driver.executeAsyncScript('const done=arguments[arguments.length-1]; browser.storage.local.get("outlineDirectory:v1:native-browser-test").then(values=>done(values["outlineDirectory:v1:native-browser-test"]?.complete === true),()=>done(false));'), 10000);
    await driver.switchTo().window(chatTab);
    await click('.chatgpt-helper-sidebar button[aria-label="回到整个会话历史顶部"]');
    await wait('return document.querySelector("main").scrollTop === 0');
    await click('.chatgpt-helper-sidebar button[aria-label="回到整个会话历史底部"]');
    await wait('const el=document.querySelector("main"); return Math.abs(el.scrollTop-(el.scrollHeight-el.clientHeight)) < 2');
    await driver.navigate().refresh();
    await wait('return document.documentElement.dataset.chatgptHelperTheme === "dark" && document.querySelectorAll(".chatgpt-helper-sidebar__group").length === 4');
    await openPanel();
    await click('.chatgpt-helper-sidebar button[aria-label="固定面板"]');
    await driver.sleep(600);
    assert.equal(await driver.findElement(By.css(".chatgpt-helper-loading-notice")).isDisplayed(), false);
    await driver.executeScript('history.pushState({},"","/c/native-second-test");document.querySelector("main").innerHTML=\'<article data-message-id="new-q"><div data-message-author-role="user">新会话问题</div></article>\'');
    await wait('return document.querySelectorAll(".chatgpt-helper-sidebar__group").length === 1 && document.querySelector(".chatgpt-helper-sidebar").textContent.includes("新会话问题")');
    assert.deepEqual(errors, []);
    console.log("通过：原生目录缓存、刷新复用、整个会话首尾跳转、页面路由切换");
  } catch (error) {
    if (!driver) throw error;
    const fs = require("node:fs");
    const diagnosticDirectory = path.resolve(__dirname, "../.claude");
    fs.mkdirSync(diagnosticDirectory, { recursive: true });
    fs.writeFileSync(path.join(diagnosticDirectory, "browser-firefox-native.png"), await driver.takeScreenshot(), "base64");
    console.error("Firefox 测试页面状态：", await driver.executeScript('return {url:document.documentURI,focus:document.hasFocus(),width:innerWidth,title:document.title,text:document.body?.textContent.slice(0,500),settingsDisabled:document.querySelector("fieldset")?.disabled,api:typeof window.__CHATGPT_HELPER__?.extensionApi,root:document.querySelector(".chatgpt-helper-sidebar")?.dataset}'));
    await driver.setContext(firefox.Context.CHROME);
    console.error("Firefox 浏览器标签状态：", await driver.executeScript('return Array.from(gBrowser.tabs,tab=>({selected:tab.selected,url:tab.linkedBrowser.currentURI.spec}))'));
    console.error("模拟会话响应错误：", errors);
    throw error;
  } finally {
    await driver?.quit();
    if (addonDirectory) await files.rm(addonDirectory, { recursive: true, force: true });
  }
}
