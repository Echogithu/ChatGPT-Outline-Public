const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { launchBrowser } = require("./browser-launch.cjs");
const root = path.resolve(__dirname, "..");
const scripts = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")).content_scripts[0].js;
const body = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%;overflow:hidden;margin:0}main{width:900px;margin:auto;height:100%;overflow:hidden}.thread-scroll-container{height:100%;overflow:auto;display:flex;flex-direction:column-reverse;overflow-anchor:none}.history-content{flex-shrink:0}article{height:300px}p,h2{margin:0}
</style></head><body><main><div class="thread-scroll-container"><div class="history-content"></div></div></main><script>
const scroller=document.querySelector('.thread-scroll-container');
const content=scroller.firstElementChild;
function renderWindow(){
 const center=Math.floor((scroller.scrollHeight-scroller.clientHeight+scroller.scrollTop)/600)+1;
 const start=Math.max(1,center-1),end=Math.min(8,center+2);
 if(scroller.dataset.range===start+':'+end)return;
 scroller.dataset.range=start+':'+end;
 const offset=scroller.scrollTop;
 content.innerHTML='<div style="height:'+((start-1)*600)+'px"></div>'+Array.from({length:end-start+1},(_,i)=>{
  const n=start+i;
  return '<article data-turn-key="q'+n+'"><div data-message-author-role="user"><p>问题 '+n+'</p></div></article><article data-turn-key="a'+n+'"><div data-message-author-role="assistant"><div class="markdown"><h2>章节 '+n+'</h2><p>回答正文</p></div></div></article>';
 }).join('')+'<div style="height:'+((8-end)*600+400)+'px"></div>';
 scroller.scrollTop=offset;
}
renderWindow();scroller.scrollTop=0;renderWindow();
scroller.addEventListener('scroll',renderWindow);
if(window.location.search.includes('lazy-headings')){
 const original=renderWindow;
 renderWindow=function(){
  original();
  for(const md of content.querySelectorAll('.markdown')){
   if(md.dataset.delayed)continue;
   md.dataset.delayed='true';
   const heading=md.querySelector('h2');
   heading.remove();md.setAttribute('aria-busy','true');
   setTimeout(()=>{md.prepend(heading);md.removeAttribute('aria-busy')},300);
  }
 };
 scroller.removeEventListener('scroll',original);
 scroller.addEventListener('scroll',renderWindow);
 renderWindow();
}
<\/script></body></html>`;
(async () => {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    await context.addInitScript((namespace) => {
      window[namespace]={storage:{local:{get:async()=>({layout:"merged"})},onChanged:{addListener(){}}}};
    }, process.env.EXTENSION_API || (process.env.BROWSER === "firefox" ? "browser" : "chrome"));
    await context.route("https://chatgpt.com/**",route=>route.fulfill({contentType:"text/html; charset=utf-8",body}));
    const page = await context.newPage();
    await page.goto("https://chatgpt.com/c/virtual-history?"+(process.env.LAZY_HEADINGS ? "lazy-headings" : ""));
    await page.addStyleTag({path:path.join(root,"src/content/styles.css")});
    for (const script of scripts) await page.addScriptTag({path:path.join(root,script)});
    await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperLayout==="merged");
    const rail=await page.locator(".chatgpt-helper-sidebar__rail").boundingBox();
    await page.mouse.move(rail.x+rail.width/2,rail.y+rail.height/2);
    await page.getByRole("button",{name:"固定面板",exact:true}).click();
    const before=await page.evaluate(()=>{
      const container=document.querySelector('.thread-scroll-container');
      __CHATGPT_HELPER__.domAdapter.scrollToBoundary('top');
      return {top:container.scrollTop,expected:-(container.scrollHeight-container.clientHeight)};
    });
    assert.equal(before.top,before.expected,'反向历史：顶部必须使用负 scrollTop');
    await page.waitForFunction(()=>document.querySelector('.chatgpt-helper-sidebar').dataset.loading==="false",{},{timeout:30000});
    assert.equal(await page.locator('.chatgpt-helper-sidebar__group').count(),8,"虚拟列表移除较早节点后仍保留完整目录");
    assert.equal(await page.locator('.chatgpt-helper-sidebar__heading').count(),8);
    assert.ok(Math.abs(await page.locator('.thread-scroll-container').evaluate(el=>el.scrollTop)-0)<3,"恢复打开目录前的阅读位置");
    assert.equal(await page.locator('[data-turn-key="q1"]').count(),0,"目标问题此时已被虚拟列表卸载");
    await page.getByRole('button',{name:'问题 1',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('[data-turn-key="q1"]')?.getBoundingClientRect().top)<3);
    await page.getByRole('button',{name:'章节 1',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('[data-turn-key="a1"] h2')?.getBoundingClientRect().top-96)<3);
    await page.getByRole('button',{name:'问题 8',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('[data-turn-key="q8"]')?.getBoundingClientRect().top-96)<3);
    assert.equal(await page.locator('.chatgpt-helper-sidebar__group').count(),8);
    console.log("通过：虚拟历史索引8轮及标题，恢复阅读位置，点击已卸载问题/标题重新定位");
    await page.getByRole('button',{name:'回到整个会话历史顶部',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('.thread-scroll-container').scrollTop+(document.querySelector('.thread-scroll-container').scrollHeight-document.querySelector('.thread-scroll-container').clientHeight))<2);
    await page.getByRole('button',{name:'回到整个会话历史底部',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.thread-scroll-container').scrollTop===0);
    console.log('通过：反向滚动首尾跳转、自动收集全部目录、稳定原生turn-key定位');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
