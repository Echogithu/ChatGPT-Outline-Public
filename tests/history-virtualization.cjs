const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { launchBrowser } = require("./browser-launch.cjs");
const root = path.resolve(__dirname, "..");
const scripts = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")).content_scripts[0].js;
const body = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%;overflow:hidden;margin:0}main{width:900px;margin:auto;height:100%;overflow:auto;overflow-anchor:none}article{height:300px}p,h2{margin:0}
</style></head><body><main></main><script>
const scroller=document.querySelector('main');
function renderWindow(){
 const center=Math.floor(scroller.scrollTop/600)+1;
 const start=Math.max(1,center-1),end=Math.min(8,center+2);
 if(scroller.dataset.range===start+':'+end)return;
 scroller.dataset.range=start+':'+end;
 const offset=scroller.scrollTop;
 scroller.innerHTML='<div style="height:'+((start-1)*600)+'px"></div>'+Array.from({length:end-start+1},(_,i)=>{
  const n=start+i;
  return '<article data-message-id="q'+n+'"><div data-message-author-role="user"><p>问题 '+n+'</p></div></article><article data-message-id="a'+n+'"><div data-message-author-role="assistant"><div class="markdown"><h2>章节 '+n+'</h2><p>回答正文</p></div></div></article>';
 }).join('')+'<div style="height:'+((8-end)*600+400)+'px"></div>';
 scroller.scrollTop=offset;
}
renderWindow();scroller.scrollTop=3900;renderWindow();
scroller.addEventListener('scroll',renderWindow);
if(window.location.search.includes('lazy-headings')){
 const original=renderWindow;
 renderWindow=function(){
  original();
  for(const md of scroller.querySelectorAll('.markdown')){
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
    let stored={layout:'merged'};
    await context.exposeBinding('readOutlineStorage',()=>stored);
    await context.exposeBinding('writeOutlineStorage',(_,values)=>{stored={...stored,...values}});
    await context.exposeBinding('removeOutlineStorage',(_,keys)=>{for(const key of [].concat(keys))delete stored[key]});
    await context.addInitScript((namespace) => {
      window[namespace]={storage:{local:{get:()=>window.readOutlineStorage(),set:values=>window.writeOutlineStorage(values),remove:keys=>window.removeOutlineStorage(keys)},onChanged:{addListener(){}}}};
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
    await page.waitForFunction(()=>document.querySelector('.chatgpt-helper-sidebar').dataset.loading==="false",{},{timeout:30000});
    assert.equal(await page.locator('.chatgpt-helper-sidebar__group').count(),8,"虚拟列表移除较早节点后仍保留完整目录");
    assert.equal(await page.locator('.chatgpt-helper-sidebar__heading').count(),8);
    assert.ok(Math.abs(await page.locator('main').evaluate(el=>el.scrollTop)-3900)<3,"恢复打开目录前的阅读位置");
    assert.equal(await page.locator('[data-message-id="q1"]').count(),0,"目标问题此时已被虚拟列表卸载");
    await page.getByRole('button',{name:'问题 1',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('[data-message-id="q1"]')?.getBoundingClientRect().top)<3);
    const firstGroup=page.locator('.chatgpt-helper-sidebar__group').first();
    await firstGroup.locator('.chatgpt-helper-sidebar__toggle').click();
    assert.equal(await firstGroup.locator('.chatgpt-helper-sidebar__children').evaluate(el=>el.hidden),true);
    await page.getByRole('button',{name:'问题 1',exact:true}).click();
    assert.equal(await firstGroup.locator('.chatgpt-helper-sidebar__children').evaluate(el=>el.hidden),false,'点击当前问题也应展开已收起的树');
    await page.getByRole('button',{name:'章节 1',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('[data-message-id="a1"] h2')?.getBoundingClientRect().top-96)<3);
    await page.getByRole('button',{name:'问题 8',exact:true}).click();
    await page.waitForFunction(()=>Math.abs(document.querySelector('[data-message-id="q8"]')?.getBoundingClientRect().top-96)<3);
    assert.equal(await page.locator('.chatgpt-helper-sidebar__group').count(),8);
    console.log("通过：虚拟历史索引8轮及标题，恢复阅读位置，点击已卸载问题/标题重新定位");
    if(process.env.CACHE_REVISIT){
      await page.reload();
      await page.addStyleTag({path:path.join(root,'src/content/styles.css')});
      for(const script of scripts)await page.addScriptTag({path:path.join(root,script)});
      await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperLayout==='merged');
      const before=await page.locator('main').evaluate(el=>el.scrollTop);
      const start=Date.now();
      const railAgain=await page.locator('.chatgpt-helper-sidebar__rail').boundingBox();
      await page.mouse.move(railAgain.x+railAgain.width/2,railAgain.y+railAgain.height/2);
      await page.waitForFunction(()=>document.querySelector('.chatgpt-helper-sidebar').dataset.loading==='false'&&document.querySelectorAll('.chatgpt-helper-sidebar__group').length===8,{},{timeout:1500});
      assert.equal(await page.locator('main').evaluate(el=>el.scrollTop),before,'缓存命中不自动滚动正文');
      assert.equal(await page.locator('.chatgpt-helper-sidebar__heading').count(),8);
      assert.equal(await page.locator('.chatgpt-helper-loading-notice').isVisible(),false);
      assert.ok(!JSON.stringify(stored).includes('回答正文'),'缓存不存回答正文');
      console.log('通过：刷新复用完整目录缓存，保留8轮及标题，不扫描、不弹提示，耗时'+(Date.now()-start)+'ms');
      const previousURL=page.url();
      await page.evaluate(()=>{
        history.pushState({},'', '/c/cache-other');
        document.querySelector('main').outerHTML='<main><article data-message-id="other-q"><div data-message-author-role="user"><p>另一个会话</p></div></article></main>';
      });
      await page.waitForFunction(()=>document.querySelectorAll('.chatgpt-helper-sidebar__group').length===1);
      assert.equal(await page.locator('.chatgpt-helper-sidebar__item').textContent(),'另一个会话');
      await page.goto(previousURL);
      await page.addStyleTag({path:path.join(root,'src/content/styles.css')});
      for(const script of scripts)await page.addScriptTag({path:path.join(root,script)});
      await page.waitForFunction(()=>document.documentElement.dataset.chatgptHelperLayout==='merged');
      const returningRail=await page.locator('.chatgpt-helper-sidebar__rail').boundingBox();
      await page.mouse.move(returningRail.x+returningRail.width/2,returningRail.y+returningRail.height/2);
      await page.waitForFunction(()=>document.querySelector('.chatgpt-helper-sidebar').dataset.loading==='false'&&document.querySelectorAll('.chatgpt-helper-sidebar__group').length===8,{},{timeout:1500});
      console.log('通过：切换其他会话不混入旧目录，返回原会话再次命中缓存');
      const corrected=await page.evaluate(async()=>{
        const main=document.querySelector('main');
        main.removeEventListener('scroll',renderWindow);
        main.innerHTML=Array.from({length:7},(_,i)=>{
          const n=i+1;
          return '<article data-message-id="q'+n+'"><div data-message-author-role="user"><p>问题 '+n+'</p></div></article><article data-message-id="a'+n+'"><div data-message-author-role="assistant"><div class="markdown"><h2>章节 '+n+'</h2><p>回答正文</p></div></div></article>';
        }).join('');
        const api=__CHATGPT_HELPER__.historyLoader;
        api.reset();await api.load();
        return api.getGroups().map(item=>item.title);
      });
      assert.deepEqual(corrected,Array.from({length:7},(_,i)=>'问题 '+(i+1)),'内容变化后重新校验，不能保留缓存中已删除的问题');
      console.log('通过：会话内容改变后重建缓存并移除已删除问题');
      return;
    }
    await page.getByRole('button',{name:'回到整个会话历史顶部',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('main').scrollTop===0);
    // 扫描期间切换会话，旧任务不得继续滚动新页面。
    await page.evaluate(()=>{
      history.pushState({},'', '/c/new-conversation');
      document.querySelector('main').outerHTML='<main><article data-message-id="new-q"><div data-message-author-role="user"><p>新问题</p></div></article><article><div data-message-author-role="assistant"><p>新回答</p></div></article></main>';
    });
    await page.waitForTimeout(3000);
    assert.equal(await page.locator('.chatgpt-helper-sidebar__group').count(),1);
    assert.equal(await page.locator('main').evaluate(el=>el.scrollTop),0);
    console.log("通过：扫描途中切换会话取消旧任务并清空缓存");
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
