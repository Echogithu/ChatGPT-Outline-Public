const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { launchBrowser } = require("./browser-launch.cjs");
const root = path.resolve(__dirname,"..");
const scripts=JSON.parse(fs.readFileSync(path.join(root,"manifest.json"),"utf8")).content_scripts[0].js;
const messages=Array.from({length:8},(_,i)=>`<article><div data-message-author-role="user"><p>问题 ${i+1}</p></div></article><article><div data-message-author-role="assistant"><div class="markdown"><h2>章节 ${i+1}</h2><p>回答正文</p></div></div></article>`).join("");
const body=`<!doctype html><html><head><meta charset="utf-8"><style>
html{height:100%;overflow:hidden}body{height:100%;overflow:auto;margin:0}main{width:900px;margin:0 auto}article{height:350px}p{margin:0}
</style></head><body><main>${messages}</main></body></html>`;
(async()=>{
 const browser=await launchBrowser();
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.addInitScript((namespace)=>{
   window[namespace]={storage:{local:{get:async()=>({layout:"merged"})},onChanged:{addListener(){}}}};
   window.sidebarViewportScrolls=[];
   const original=Element.prototype.scrollIntoView;
   Element.prototype.scrollIntoView=function(...args){
    if(this.closest(".chatgpt-helper-sidebar")) window.sidebarViewportScrolls.push(this.textContent);
    return original.apply(this,args);
   };
  }, process.env.EXTENSION_API || (process.env.BROWSER === "firefox" ? "browser" : "chrome"));
  await context.route("https://chatgpt.com/**",route=>route.fulfill({contentType:"text/html; charset=utf-8",body}));
  const page=await context.newPage();
  await page.goto("https://chatgpt.com/c/body-scroll");
  await page.addStyleTag({path:path.join(root,"src/content/styles.css")});
  for(const script of scripts)await page.addScriptTag({path:path.join(root,script)});
  await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperLayout==="merged");
  const rail=await page.locator(".chatgpt-helper-sidebar__rail").boundingBox();
  await page.mouse.move(rail.x+rail.width/2,rail.y+rail.height/2);
  await page.getByRole("button",{name:"固定面板",exact:true}).click();
  await page.getByRole("button",{name:"问题 6",exact:true}).click();
  await page.waitForFunction(()=>document.body.scrollTop>1000);
  await page.getByRole("button",{name:"回到整个会话历史顶部",exact:true}).click();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const result=await page.evaluate(()=>({bodyTop:document.body.scrollTop,pageTop:window.scrollY,sidebarViewportScrolls:window.sidebarViewportScrolls}));
  console.log("点击问题后返回顶部",JSON.stringify(result));
  assert.equal(result.bodyTop,0,"body 作为真实历史滚动容器时必须回到0");
  assert.equal(result.pageTop,0);
  assert.deepEqual(result.sidebarViewportScrolls,[],"更新目录高亮只能滚动目录内部，不能调用会影响正文的 scrollIntoView");
  await page.getByRole("button",{name:"回到整个会话历史底部",exact:true}).click();
  await page.waitForFunction(()=>Math.abs(document.body.scrollHeight-document.body.clientHeight-document.body.scrollTop)<2);
  await page.getByRole("button",{name:"回到整个会话历史顶部",exact:true}).click();
  await page.waitForFunction(()=>document.body.scrollTop===0);
  // 等过问题点击留下的260/900ms刷新回调，确保它们不会拉回旧位置。
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(()=>document.body.scrollTop),0);
  console.log("通过：实际目录点击 → 首尾跳转 → 延迟回调后仍保持边界");
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
