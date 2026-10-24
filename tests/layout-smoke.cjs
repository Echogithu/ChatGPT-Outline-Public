// 使用真实浏览器 DOM 验证布局；扩展存储通过测试替身模拟，不访问真实账号。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { launchBrowser } = require("./browser-launch.cjs");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body {margin:0;font:16px system-ui} nav {position:fixed;left:0;top:0;width:240px;height:100vh;background:#eee}
main {margin-left:240px;padding:30px 120px} article {min-height:260px;padding:20px} .markdown p {height:180px}
</style></head><body><nav aria-label="原生会话列表">会话</nav><main>
<article data-testid="conversation-turn-1"><div data-message-author-role="user"><p>如何设计 Agent？</p></div></article>
<article data-testid="conversation-turn-2"><div data-message-author-role="assistant"><div class="markdown"><h2>架构概览</h2><p>正文</p><h3>工具调用</h3><p>正文</p><h2>实施步骤</h2><p>正文</p></div></div></article>
<article data-testid="conversation-turn-3"><div data-message-author-role="user"><p>没有标题的回答</p></div></article>
<article data-testid="conversation-turn-4"><div data-message-author-role="assistant"><div class="markdown"><p>普通回答内容</p></div></div></article>
<article data-testid="conversation-turn-5"><div data-message-author-role="assistant"><div class="markdown"><h2>补充回答</h2><p>正文</p></div></div></article>
<article data-testid="conversation-turn-6"><div data-message-author-role="user"><p>等待回答的问题</p></div></article>
</main></body></html>`;

(async () => {
  for (const file of manifest.content_scripts[0].js.concat(manifest.content_scripts[0].css, [manifest.options_page, manifest.action.default_popup])) {
    assert.ok(fs.existsSync(path.join(root, file)), `入口文件存在：${file}`);
  }
  assert.deepEqual(manifest.permissions, ["storage"]);
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000}});
    const errors = [];
    context.on("page", (page) => page.on("pageerror", error => errors.push(error.message)));
    let stored = {};
    let failRead = false;
    let failWrite = false;
    await context.exposeBinding("layoutStorageGet", () => {
      if (failRead) throw new Error("模拟读取失败");
      return stored;
    });
    await context.exposeBinding("layoutStorageSet", async (_, values) => {
      if (failWrite) throw new Error("模拟保存失败");
      const changes = Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{oldValue:stored[key],newValue:value}]));
      stored = {...stored,...values};
      await Promise.all(context.pages().map(page => page.evaluate(changes => {
        window.storageListeners.forEach(listener => listener(changes, "local"));
      }, changes)));
    });
    await context.addInitScript((namespace) => {
      window.storageListeners = [];
      window[namespace] = { storage: {
        local: {get: () => window.layoutStorageGet(), set: values => window.layoutStorageSet(values)},
        onChanged: {addListener: listener => window.storageListeners.push(listener)}
      }};
    }, process.env.EXTENSION_API || (process.env.BROWSER === "firefox" ? "browser" : "chrome"));
    await context.route("https://chatgpt.com/**", route => route.fulfill({contentType:"text/html; charset=utf-8",body:fixture}));
    const page = await context.newPage();
    async function inject(target = page) {
      await target.addStyleTag({path:path.join(root,"src/content/styles.css")});
      for (const script of manifest.content_scripts[0].js) await target.addScriptTag({path:path.join(root,script)});
      assert.deepEqual(errors, [], "扩展 API 初始化无异常");
      await target.waitForSelector(".chatgpt-helper-sidebar__item", {state:"attached"});
    }
    await page.goto("https://chatgpt.com/c/layout-test");
    await inject();
    const questionSide = page.locator(".chatgpt-helper-sidebar");
    const outlineSide = page.locator(".chatgpt-helper-message-outline");
    await page.waitForFunction(() => document.documentElement.dataset.chatgptHelperLayout === "merged");
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.chatgptHelperTheme),"light");
    assert.equal(await questionSide.getAttribute("data-side"), "right");
    assert.equal(await outlineSide.getAttribute("data-side"), "left");
    assert.equal(await outlineSide.evaluate(el=>getComputedStyle(el).display),"none");
    assert.equal(await outlineSide.evaluate(el => getComputedStyle(el).left), "240px");
    assert.equal(await page.locator(".chatgpt-helper-sidebar__item").count(), 3);
    assert.equal(await questionSide.locator(".chatgpt-helper-sidebar__header > strong").textContent(), "目录");
    console.log("通过：默认布局、原生边栏避让、问题提取");

    const options = await context.newPage();
    await options.goto("file://" + path.join(root,"src/options/options.html"));
    await options.waitForFunction(() => !document.querySelector("fieldset").disabled);
    assert.equal(await options.locator('input[name="layout"]:checked').inputValue(), "merged");
    assert.equal(await options.locator('input[name="theme"]:checked').inputValue(), "light");
    assert.equal(await options.locator('small').count(),0);
    assert.equal(await options.locator('input[name="layout"]').count(),4);
    await options.setViewportSize({width:340,height:600});
    assert.ok((await options.getByRole('button',{name:'保存设置'}).boundingBox()).y+44<=600,'配置弹窗无需滚动即可看到主题和保存');
    assert.ok(await options.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await options.setViewportSize({width:1440,height:1000});
    async function save(layout) {
      await options.locator(`input[value="${layout}"]`).check();
      await options.getByRole("button", {name:"保存设置"}).click();
      await options.waitForFunction(() => document.querySelector("#status").textContent.startsWith("已保存"));
      await page.waitForFunction(value => document.documentElement.dataset.chatgptHelperLayout === value, layout);
      assert.equal(stored.layout, layout);
    }
    await options.emulateMedia({colorScheme:"dark"});
    assert.equal(await options.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(245, 247, 251)','主题默认亮色，不跟随系统');
    await options.locator('input[name="theme"][value="dark"]').check();
    await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperTheme==='dark');
    assert.equal(await page.locator('.chatgpt-helper-sidebar__card').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(30, 41, 59, 0.97)','点选主题立即同步到目录面板');
    await save("merged-left");
    await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperTheme==='dark');
    assert.equal(await questionSide.getAttribute('data-side'),'left');
    assert.equal(await questionSide.evaluate(el=>getComputedStyle(el).left),'240px');
    assert.equal(await outlineSide.evaluate(el=>getComputedStyle(el).display),'none');
    assert.equal(await page.locator('.chatgpt-helper-sidebar__group').count(),3);
    assert.equal(await page.locator('.chatgpt-helper-sidebar__card').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(30, 41, 59, 0.97)');
    assert.equal(await page.locator('.chatgpt-helper-sidebar__card').evaluate(el=>getComputedStyle(el).borderRadius),'12px');
    await save("outline-left");
    assert.equal(await outlineSide.evaluate(el=>getComputedStyle(el).display),'block');
    assert.equal(await page.locator('.chatgpt-helper-message-outline__card').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(30, 41, 59, 0.97)');
    await save("questions-left");
    assert.equal(await questionSide.locator('.chatgpt-helper-sidebar__header > strong').textContent(),'问题');
    assert.equal(await outlineSide.locator('.chatgpt-helper-sidebar__header > strong').textContent(),'回答');
    for (const panel of [questionSide, outlineSide]) {
      const rail = await panel.locator('[class$="__rail"]').boundingBox();
      await page.mouse.move(rail.x+rail.width/2,rail.y+rail.height/2);
      await panel.getByRole('button',{name:'固定面板',exact:true}).click();
      await page.mouse.move(650,100);
      assert.equal(await panel.getAttribute('data-expanded'),'true','两侧均可独立固定');
      assert.equal(await panel.getByRole('button',{name:'取消固定',exact:true}).getAttribute('aria-pressed'),'true');
    }
    await outlineSide.getByRole('button',{name:'回到整个会话历史底部',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.scrollingElement.scrollHeight-document.scrollingElement.clientHeight-document.scrollingElement.scrollTop)<2);
    await questionSide.getByRole('button',{name:'回到整个会话历史顶部',exact:true}).click();
    await page.waitForFunction(()=>document.scrollingElement.scrollTop===0);
    await page.waitForFunction(()=>document.querySelector('.chatgpt-helper-message-outline').dataset.visible==='true');
    await outlineSide.getByRole('button',{name:'回到整个会话历史顶部',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.chatgpt-helper-sidebar').dataset.loading==='false');
    await questionSide.getByRole('button',{name:'回到整个会话历史底部',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.scrollingElement.scrollHeight-document.scrollingElement.clientHeight-document.scrollingElement.scrollTop)<2);
    await questionSide.getByRole('button',{name:'取消固定',exact:true}).focus();
    await page.keyboard.press('Escape');
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.waitForFunction(()=>document.querySelector('.chatgpt-helper-message-outline').dataset.visible==='true');
    await outlineSide.getByRole('button',{name:'取消固定',exact:true}).focus();
    await page.keyboard.press('Escape');
    assert.equal(await outlineSide.getAttribute('data-expanded'),'false');
    await page.keyboard.press('Enter');
    assert.equal(await outlineSide.getAttribute('data-expanded'),'true');
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'固定面板');
    await page.mouse.move(650,100);
    assert.equal(await outlineSide.getAttribute('data-expanded'),'true','回答面板焦点保持展开');
    await page.keyboard.press('Escape');
    assert.equal(await outlineSide.getAttribute('data-expanded'),'false');
    console.log('通过：问题／回答标题、两侧独立固定、两侧按钮均跳到整个会话边界');
    assert.equal(await questionSide.getAttribute("data-side"), "left");
    assert.equal(await page.locator(".chatgpt-helper-sidebar__toolbar button[aria-label='全部展开']").isVisible(), false);
    assert.equal(await outlineSide.getAttribute("data-side"), "right");
    assert.equal(await questionSide.evaluate(el => getComputedStyle(el).left), "240px");
    assert.equal(await outlineSide.evaluate(el => getComputedStyle(el).right), "0px");
    await page.locator("nav").evaluate(el=>el.style.display="none");
    await page.waitForFunction(()=>getComputedStyle(document.querySelector(".chatgpt-helper-sidebar")).left==="0px");
    await page.locator("nav").evaluate(el=>el.style.display="block");
    await page.waitForFunction(()=>getComputedStyle(document.querySelector(".chatgpt-helper-sidebar")).left==="240px");
    console.log("通过：配置保存、即时生效、左右交换、边栏展开收起避让");
    await options.locator('input[name="theme"][value="light"]').check();
    await save("merged");
    await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperTheme==='light');
    console.log('通过：四种布局、左侧合并、原生边栏避让、亮暗主题实时切换与默认亮色');
    assert.equal(await outlineSide.evaluate(el => getComputedStyle(el).display), "none");
    const railBox = await page.locator(".chatgpt-helper-sidebar__rail").boundingBox();
    await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + railBox.height / 2);
    await page.getByRole("button", {name:"固定面板",exact:true}).click();
    const groups = page.locator(".chatgpt-helper-sidebar__group");
    assert.equal(await groups.count(), 3);
    assert.equal(await groups.nth(0).locator("[data-heading-id]").count(), 3);
    assert.equal(await groups.nth(1).locator("[data-heading-id]").count(), 1);
    assert.equal(await groups.nth(2).locator(".chatgpt-helper-sidebar__answer-label").textContent(), "暂无回答");
    // 仅当前页面的精确偏移测试需要尾部空间，不影响后面的独立嵌套滚动夹具。
    await page.evaluate(()=>{
      const space=document.createElement("div");space.style.height="1000px";
      space.setAttribute("aria-hidden","true");document.body.appendChild(space);
    });
    await groups.nth(1).locator(".chatgpt-helper-sidebar__toggle").click();
    await groups.nth(1).getByRole("button",{name:"跳到回答",exact:true}).click();
    assert.ok(Math.abs(await page.locator('[data-testid="conversation-turn-4"] .markdown').evaluate(el=>el.getBoundingClientRect().top)-96)<3);
    await page.evaluate(()=>{
      const content = document.querySelector('[data-testid="conversation-turn-4"] .markdown');
      content.replaceWith(content.cloneNode(true));
      window.scrollTo(0,0);
    });
    await groups.nth(1).getByRole("button",{name:"跳到回答",exact:true}).click();
    assert.ok(Math.abs(await page.locator('[data-testid="conversation-turn-4"] .markdown').evaluate(el=>el.getBoundingClientRect().top)-96)<3);
    if (await groups.nth(0).locator(".chatgpt-helper-sidebar__toggle").getAttribute("aria-expanded") !== "true") {
      await groups.nth(0).locator(".chatgpt-helper-sidebar__toggle").click();
    }
    await groups.nth(0).getByRole("button",{name:"工具调用",exact:true}).click();
    assert.ok(Math.abs(await page.locator("h3").evaluate(el=>el.getBoundingClientRect().top)-96)<3);
    assert.equal(await groups.nth(0).getByRole("button",{name:"工具调用",exact:true}).getAttribute("aria-current"), "location");
    assert.equal(await groups.nth(1).locator(".chatgpt-helper-sidebar__toggle").getAttribute("aria-expanded"), "true");
    console.log("通过：问答树关联、多回复、无标题回答、暂无回答、章节跳转与高亮");

    await page.evaluate(()=>{
      const h = document.createElement("h2"); h.textContent="流式新增章节";
      document.querySelector('[data-testid="conversation-turn-2"] .markdown').append(h);
    });
    await page.getByRole("button",{name:"流式新增章节",exact:true}).waitFor({state:"attached"});
    assert.equal(await groups.nth(1).locator(".chatgpt-helper-sidebar__toggle").getAttribute("aria-expanded"), "true");
    await page.mouse.move(500,100);
    assert.equal(await questionSide.getAttribute("data-expanded"), "true");
    console.log("通过：流式更新、手动展开状态保留、固定展开");
    assert.equal(await questionSide.locator(".chatgpt-helper-sidebar__toolbar button svg").count(), 5);
    assert.equal(await page.getByRole("button",{name:"取消固定",exact:true}).getAttribute("aria-pressed"), "true");
    await page.getByRole("button",{name:"全部展开",exact:true}).click();
    assert.equal(await page.locator('.chatgpt-helper-sidebar__children[hidden]').count(),0);
    await page.getByRole("button",{name:"全部收起",exact:true}).click();
    assert.equal(await page.locator('.chatgpt-helper-sidebar__children[hidden]').count(),3);
    await page.getByRole("button",{name:"回到整个会话历史底部",exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.scrollingElement.scrollHeight-document.scrollingElement.clientHeight-document.scrollingElement.scrollTop)<2);
    assert.equal(await page.locator('.chatgpt-helper-sidebar__children[hidden]').count(),3);
    await page.getByRole("button",{name:"回到整个会话历史顶部",exact:true}).click();
    await page.waitForFunction(()=>document.scrollingElement.scrollTop===0);
    assert.equal(await page.locator('.chatgpt-helper-sidebar__children[hidden]').count(),3);
    await page.getByRole("button",{name:"全部展开",exact:true}).click();
    console.log("通过：SVG 图标、固定状态、全部展开收起、会话顶部底部");

    await page.setViewportSize({width:1024,height:768});
    assert.equal(await questionSide.evaluate(el=>getComputedStyle(el).display), "block");
    await page.setViewportSize({width:375,height:812});
    assert.equal(await questionSide.evaluate(el=>getComputedStyle(el).display), "none");
    assert.ok(await options.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await options.locator('input[name="theme"][value="dark"]').check();
    await save('merged');
    await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperTheme==='dark');
    assert.equal(await options.locator("body").evaluate(el=>getComputedStyle(el).backgroundColor), "rgb(15, 23, 42)");
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:path.join(root,".claude/layout-merged.png")});
    await options.screenshot({path:path.join(root,".claude/layout-options.png"),fullPage:true});
    console.log("通过：窄屏行为、配置页暗色与布局截图");
    await page.getByRole("button",{name:"取消固定",exact:true}).click();
    await page.mouse.move(500,100);
    assert.equal(await questionSide.getAttribute("data-expanded"), "true");
    await page.keyboard.press("Escape");
    assert.equal(await questionSide.getAttribute("data-expanded"), "false");
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute("aria-label")), "固定面板");
    await page.mouse.move(1350,450);
    await page.mouse.move(500,100);
    assert.equal(await questionSide.getAttribute("data-expanded"), "true");
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute("aria-label")), "固定面板");
    await page.keyboard.press("Escape");
    assert.equal(await questionSide.getAttribute("data-expanded"), "false");
    console.log("通过：键盘展开、鼠标离开保留焦点、Escape 退出");

    await page.reload(); await inject();
    await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperLayout==="merged");
    await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperTheme==='dark');
    console.log("通过：刷新后保留布局");
    await page.evaluate(()=>{
      history.pushState({},"","/c/another-conversation");
      document.querySelector("main").innerHTML='<article><div data-message-author-role="user"><p>新的会话</p></div></article>';
    });
    await page.waitForFunction(()=>document.querySelectorAll(".chatgpt-helper-sidebar__group").length===1);
    assert.equal(await page.locator(".chatgpt-helper-sidebar__item").textContent(), "新的会话");
    assert.equal(await page.locator(".chatgpt-helper-sidebar__heading").count(), 0);
    await page.evaluate(()=>{history.pushState({},"","/settings");document.querySelector("main").innerHTML="";});
    await page.waitForFunction(()=>document.querySelector(".chatgpt-helper-sidebar").dataset.visible==="false");
    console.log("通过：会话切换、清理旧树、非会话页隐藏");

    for (const mode of ["main", "ancestor", "descendant"]) {
      const nested = await context.newPage();
      const body = mode === "descendant"
        ? fixture.replace("</style>", "body {height:100vh;overflow:hidden} main {height:100vh;padding:0;overflow:hidden} #conversation-history {height:100vh;overflow:auto} .markdown {height:200px;overflow:auto}</style>").replace("<main>", '<main><div id="conversation-history">').replace("</main>", "</div></main>")
        : mode === "main"
        ? fixture.replace("</style>", "body {height:100vh;overflow:hidden} main {height:100vh;overflow:auto;box-sizing:border-box}</style>")
        : fixture.replace("</style>", "body {height:100vh;overflow:hidden} #conversation-scroll {height:100vh;overflow:auto}</style>").replace("<main>", '<div id="conversation-scroll"><main>').replace("</main>", "</main></div>");
      await nested.route("https://chatgpt.com/**", route=>route.fulfill({contentType:"text/html; charset=utf-8",body}));
      await nested.goto(`https://chatgpt.com/c/nested-${mode}`);
      await inject(nested);
      await nested.waitForFunction(()=>document.documentElement.dataset.chatgptHelperLayout==="merged");
      const box=await nested.locator(".chatgpt-helper-sidebar__rail").boundingBox();
      await nested.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await nested.getByRole("button",{name:"固定面板",exact:true}).click();
      if (mode === "descendant") {
        await nested.locator(".markdown").first().evaluate(el=>el.scrollTop=50);
      }
      await nested.getByRole("button",{name:"回到整个会话历史底部",exact:true}).click();
      const selector=mode==="main" ? "main" : mode==="descendant" ? "#conversation-history" : "#conversation-scroll";
      await nested.waitForFunction(selector=>{
        const el=document.querySelector(selector);
        return el.scrollTop>0 && Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop)<2;
      },selector);
      assert.equal(await nested.evaluate(()=>window.scrollY),0);
      if (mode === "descendant") assert.equal(await nested.locator(".markdown").first().evaluate(el=>el.scrollTop),50);
      await nested.getByRole("button",{name:"回到整个会话历史顶部",exact:true}).click();
      await nested.waitForFunction(selector=>document.querySelector(selector).scrollTop===0,selector);
      if (mode === "descendant") assert.equal(await nested.locator(".markdown").first().evaluate(el=>el.scrollTop),50);
      assert.deepEqual(await nested.evaluate(()=>[
        __CHATGPT_HELPER__.domAdapter.scrollToBoundary("invalid"),
        __CHATGPT_HELPER__.domAdapter.getScrollContainer().scrollTop
      ]),[false,0]);
      await nested.close();
    }
    for (const ancestor of [false,true]) {
      const short = await context.newPage();
      const content = '<main><article><div data-message-author-role="user"><p>短溢出测试</p></div></article></main>';
      const body = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body {margin:0;height:100%;overflow:hidden}
        main {height:${ancestor ? 420 : 400}px;overflow:${ancestor ? "visible" : "auto"}}
        article {height:420px} p {margin:0} #short-scroll {height:400px;overflow:auto}
      </style></head><body>${ancestor ? `<div id="short-scroll">${content}</div>` : content}</body></html>`;
      await short.route("https://chatgpt.com/**",route=>route.fulfill({contentType:"text/html; charset=utf-8",body}));
      await short.goto("https://chatgpt.com/c/short-overflow");
      await inject(short);
      await short.waitForFunction(()=>document.documentElement.dataset.chatgptHelperLayout==="merged");
      const selector=ancestor ? "#short-scroll" : "main";
      assert.equal(await short.locator(selector).evaluate(el=>el.scrollHeight-el.clientHeight),20);
      const box=await short.locator(".chatgpt-helper-sidebar__rail").boundingBox();
      await short.mouse.move(box.x+box.width/2,box.y+box.height/2);
      await short.getByRole("button",{name:"固定面板",exact:true}).click();
      await short.getByRole("button",{name:"回到整个会话历史底部",exact:true}).click();
      await short.waitForFunction(selector=>document.querySelector(selector).scrollTop===20,selector);
      await short.getByRole("button",{name:"回到整个会话历史顶部",exact:true}).click();
      await short.waitForFunction(selector=>document.querySelector(selector).scrollTop===0,selector);
      assert.equal(await short.evaluate(()=>window.scrollY),0);
      await short.close();
    }
    console.log("通过：整个会话历史的 main／祖先／内部滚动容器，局部回答不被滚动，20px 溢出保护");
    await options.evaluate(()=>(globalThis.browser || globalThis.chrome).storage.local.set({layout:"invalid"}));
    await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperLayout==="merged");
    await options.reload(); await options.waitForFunction(()=>!document.querySelector("fieldset").disabled);
    assert.equal(await options.locator('input[name="layout"]:checked').inputValue(), "merged");
    failWrite=true;
    await options.getByRole("button",{name:"保存设置"}).click();
    await options.waitForFunction(()=>document.querySelector("#status").textContent.startsWith("保存失败"));
    assert.equal(await options.locator("fieldset").evaluate(el=>el.disabled),false);
    failRead=true;
    await options.reload();
    await options.waitForFunction(()=>document.querySelector("#status").textContent.startsWith("读取设置失败"));
    assert.equal(await options.locator("fieldset").evaluate(el=>el.disabled),true);
    assert.deepEqual(errors,[]);
    console.log("通过：无效设置回退、读取及保存失败提示、无页面异常");
    console.log("全部布局回归通过（真实浏览器 DOM；存储 API 为测试替身）");
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
