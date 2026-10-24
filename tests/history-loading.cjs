const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { launchBrowser } = require("./browser-launch.cjs");
const root = path.resolve(__dirname,"..");
const scripts=JSON.parse(fs.readFileSync(path.join(root,"manifest.json"),"utf8")).content_scripts[0].js;
const body=`<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%;overflow:hidden;margin:0}main{width:900px;margin:auto;height:100%;overflow:auto}article{height:300px}p{margin:0}
</style></head><body><main></main><script>
const historyScroller=document.querySelector('main');
window.loadedStart=7;
function turn(i){return '<article data-message-id="q'+i+'"><div data-message-author-role="user"><p>问题 '+i+'</p></div></article><article data-message-id="a'+i+'"><div data-message-author-role="assistant"><div class="markdown"><h2>章节 '+i+'</h2><p>回答正文</p></div></div></article>'}
historyScroller.innerHTML=[7,8].map(turn).join('');
historyScroller.scrollTop=historyScroller.scrollHeight;
let pending=false;
historyScroller.addEventListener('scroll',()=>{
 if(historyScroller.scrollTop>10 || window.loadedStart===1 || pending)return;
 pending=true;
 setTimeout(()=>{
  const height=historyScroller.scrollHeight;
  const next=Math.max(1,window.loadedStart-2);
  historyScroller.insertAdjacentHTML('afterbegin',Array.from({length:window.loadedStart-next},(_,i)=>turn(next+i)).join(''));
  window.loadedStart=next;
  // 模拟加载较早轮次后，页面保持原阅读位置，顶部被新增内容推远。
  historyScroller.scrollTop+=historyScroller.scrollHeight-height;
  pending=false;
 },Number(window.location.search.slice(1)) || 300);
});
<\/script></body></html>`;
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
  await page.goto("https://chatgpt.com/c/body-scroll?"+(process.env.LOAD_DELAY || "300"));
  await page.addStyleTag({path:path.join(root,"src/content/styles.css")});
  for(const script of scripts)await page.addScriptTag({path:path.join(root,script)});
  await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperLayout==="merged");
  const original=await page.evaluate(()=>document.querySelector('main').scrollTop);
  const rail=await page.locator(".chatgpt-helper-sidebar__rail").boundingBox();
  await page.mouse.move(rail.x+rail.width/2,rail.y+rail.height/2);
  await page.getByRole("button",{name:"固定面板",exact:true}).click();
  const notice=page.locator('.chatgpt-helper-loading-notice');
  assert.equal(await notice.isVisible(),true,"首次扫描展示独立加载提示");
  assert.match(await notice.textContent(),/自动滚动.*返回你刚才的阅读位置/);
  if(process.env.STOP_LOADING){
   await page.waitForTimeout(800);
   await page.getByRole('button',{name:'停止加载',exact:true}).click();
   assert.equal(await notice.isVisible(),false);
   assert.equal(await page.locator('.chatgpt-helper-sidebar').getAttribute('data-loading'),'false');
   await page.waitForTimeout(500);
   const stoppedPosition=await page.locator('main').evaluate(el=>el.scrollTop);
   await page.waitForTimeout(800);
   assert.equal(await page.locator('main').evaluate(el=>el.scrollTop),stoppedPosition,'停止后不再自动滚动');
   assert.ok(await page.locator('.chatgpt-helper-sidebar__group').count()>=2,'已收集目录仍可使用');
   await page.getByRole('button',{name:'取消固定',exact:true}).focus();
   await page.keyboard.press('Escape');
   await page.mouse.move(600,100);
   const reopenedRail=await page.locator('.chatgpt-helper-sidebar__rail').boundingBox();
   await page.mouse.move(reopenedRail.x+reopenedRail.width/2,reopenedRail.y+reopenedRail.height/2);
   await page.waitForTimeout(600);
   assert.equal(await notice.isVisible(),false,'停止后再次悬停只展开目录，不重新弹窗扫描');
   await page.getByRole('button',{name:'重新加载目录',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('.chatgpt-helper-loading-notice').hidden);
   assert.equal(await notice.isVisible(),true,'只有主动重新加载才再次展示提示');
   await page.getByRole('button',{name:'停止加载',exact:true}).click();
   await page.screenshot({path:path.join(root,'.claude','loading-notice-stopped.png')});
   console.log('通过：停止后再次悬停不弹窗、不扫描，已收集目录仍可使用');
   return;
  }
  await page.screenshot({path:path.join(root,'.claude','loading-notice.png')});
  await page.waitForFunction(()=>document.querySelectorAll('.chatgpt-helper-sidebar__group').length===8,{},{timeout:30000});
  assert.equal(await page.evaluate(()=>window.loadedStart),1);
  await page.waitForFunction(()=>document.querySelector('.chatgpt-helper-sidebar').dataset.loading!=="true");
  assert.equal(await notice.isVisible(),false,'加载完成后自动关闭提示');
  console.log("首次打开：自动收集全部8轮，而初始仅有2轮");
  // 加载增加了顶部内容，原第7轮在视口中的位置应保持。
  const restored=await page.locator('[data-message-id="q7"]').evaluate(el=>el.getBoundingClientRect().top);
  assert.ok(Math.abs(restored-(0-original))<3,`恢复阅读位置：${restored}`);
  await page.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend',turn(9)));
  await page.getByRole('button',{name:'问题 9',exact:true}).waitFor({state:'attached'});
  await page.getByRole('button',{name:'取消固定',exact:true}).focus();
  await page.keyboard.press('Escape');
  await page.mouse.move(600,100);
  const beforeHover=await page.locator('main').evaluate(el=>el.scrollTop);
  const updatedRail=await page.locator('.chatgpt-helper-sidebar__rail').boundingBox();
  await page.mouse.move(updatedRail.x+updatedRail.width/2,updatedRail.y+updatedRail.height/2);
  await page.waitForTimeout(600);
  assert.equal(await notice.isVisible(),false,'新消息让索引过期后，悬停仍不自动扫描');
  assert.equal(await page.locator('main').evaluate(el=>el.scrollTop),beforeHover,'新消息后悬停不移动正文');
  await page.getByRole('button',{name:'固定面板',exact:true}).click();
  await page.getByRole("button",{name:"问题 6",exact:true}).click();
  await page.getByRole("button",{name:"回到整个会话历史顶部",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('main').scrollTop===0);
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(()=>document.querySelector('main').scrollTop),0);
  console.log("通过：懒加载后回到整个历史顶部且不被旧选择拉回");
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
