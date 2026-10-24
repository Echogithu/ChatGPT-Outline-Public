const assert = require("node:assert/strict");
const path = require("node:path");
const { launchBrowser } = require("./browser-launch.cjs");
const root = path.resolve(__dirname, "..");
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0}header{height:600px}main{width:900px;margin:auto}#history{height:500px;overflow:auto}
article{height:450px}p{margin:0}footer{height:600px}
</style></head><body><header>页面顶部</header><main><div id="history">
<article id="q1"><div data-message-author-role="user"><p>问题一</p></div></article>
<article id="a1"><div data-message-author-role="assistant"><div class="markdown"><h2>共同标题</h2><p>回答一</p></div></div></article>
<article id="q2"><div data-message-author-role="user"><p>问题二</p></div></article>
<article id="a2"><div data-message-author-role="assistant"><div class="markdown"><h2>共同标题</h2><p>回答二</p></div></div></article>
</div></main><footer></footer></body></html>`;
(async()=>{
 const browser=await launchBrowser();
 const failures=[];
 try {
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  await context.route("https://chatgpt.com/**",route=>route.fulfill({contentType:"text/html; charset=utf-8",body:fixture}));
  const page=await context.newPage();
  async function reset(){
   await page.goto("https://chatgpt.com/c/navigation-regression");
   await page.addScriptTag({path:path.join(root,"src/content/dom-adapter.js")});
  }
  async function check(name, run){
   try {await run();console.log("通过："+name)}catch(error){failures.push(name+": "+error.message);console.log("失败："+name+": "+error.message)}
  }
  await check("整页与内部历史同时回到顶部",async()=>{
   await reset();
   const result=await page.evaluate(()=>{
    window.scrollTo(0,300);document.querySelector("#history").scrollTop=500;
    const api=__CHATGPT_HELPER__.domAdapter;
    api.scrollToBoundary("top");
    return {pageTop:window.scrollY,historyTop:document.querySelector("#history").scrollTop};
   });
   assert.deepEqual(result,{pageTop:0,historyTop:0});
  });
  await check("已移除回答不能误跳到别的同名章节",async()=>{
   await reset();
   const result=await page.evaluate(()=>{
    const api=__CHATGPT_HELPER__.domAdapter;
    const second=api.getAssistantMessages()[1];
    const heading=api.extractHeadings(second.contentElement,second.id)[0];
    document.querySelector("#a2").remove();
    document.querySelector("#history").scrollTop=0;
    const moved=api.scrollToHeading(heading.id,heading.element,heading);
    return {moved,historyTop:document.querySelector("#history").scrollTop};
   });
   assert.deepEqual(result,{moved:false,historyTop:0});
  });
  await check("插入历史消息后旧问题节点仍指向原问题",async()=>{
   await reset();
   const result=await page.evaluate(()=>{
    const api=__CHATGPT_HELPER__.domAdapter;
    const previous=api.getQuestionItems()[0];
    const newQuestion=document.createElement("article");
    newQuestion.id="inserted";
    newQuestion.innerHTML='<div data-message-author-role="user"><p>更早问题</p></div>';
    document.querySelector("#history").prepend(newQuestion);
    api.getQuestionItems();
    api.scrollToQuestion(previous.id);
    return Math.round(document.querySelector("#q1").getBoundingClientRect().top);
   });
   assert.equal(result,96);
  });
  await check("轮次测试标记重新编号不会复用问题身份",async()=>{
   await reset();
   const result=await page.evaluate(()=>{
    const api=__CHATGPT_HELPER__.domAdapter;
    document.querySelector("#q1").setAttribute("data-testid","conversation-turn-1");
    const previous=api.getQuestionItems()[0];
    const inserted=document.createElement("article");
    inserted.setAttribute("data-testid","conversation-turn-1");
    inserted.innerHTML='<div data-message-author-role="user"><p>更早的问题</p></div>';
    document.querySelector("#history").prepend(inserted);
    document.querySelector("#q1").setAttribute("data-testid","conversation-turn-3");
    api.getQuestionItems();
    api.scrollToQuestion(previous.id);
    return Math.round(document.querySelector("#q1").getBoundingClientRect().top);
   });
   assert.equal(result,96);
  });
  await check("重复标题重渲染后不能用旧序号误跳",async()=>{
   await reset();
   const result=await page.evaluate(()=>{
    const api=__CHATGPT_HELPER__.domAdapter;
    document.querySelector("#a1").setAttribute("data-message-id","stable-answer");
    const markdown=document.querySelector("#a1 .markdown");
    markdown.innerHTML='<h2 data-section="A">重复标题</h2><h2 data-section="B">重复标题</h2>';
    const message=api.getAssistantMessages()[0];
    const heading=api.extractHeadings(message.contentElement,message.id)[1];
    markdown.innerHTML='<h2 data-section="NEW">重复标题</h2><h2 data-section="A">重复标题</h2><h2 data-section="B">重复标题</h2>';
    let hit=null;
    const original=Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView=function(...args){hit=this.dataset.section;return original.apply(this,args)};
    const moved=api.scrollToHeading(heading.id,heading.element,heading);
    return {moved,hit};
   });
   assert.deepEqual(result,{moved:false,hit:null});
  });
  await check("前插标题保持原锚点唯一，回答目录点击仍选中原章节",async()=>{
   await reset();
   for(const file of ["sidebar.js","message-outline.js"])await page.addScriptTag({path:path.join(root,"src/content",file)});
   const result=await page.evaluate(()=>{
    const helper=__CHATGPT_HELPER__,api=helper.domAdapter;
    const message=api.getAssistantMessages()[0];
    const original=api.extractHeadings(message.contentElement,message.id)[0];
    let selected=null,moved=false;
    const outline=helper.messageOutline.mount(document.body,{onSelect:heading=>{
     selected=heading.text;moved=api.scrollToHeading(heading.id,heading.element,heading);
    }});
    outline.render(message,[original]);
    for(const text of ["新章节一","新章节二"]){
     const heading=document.createElement("h2");heading.textContent=text;
     message.contentElement.prepend(heading);
     outline.render(message,api.extractHeadings(message.contentElement,message.id));
    }
    const headings=api.extractHeadings(message.contentElement,message.id);
    outline.list.querySelectorAll("button")[2].click();
    return {ids:headings.map(heading=>heading.id),originalId:original.id,currentId:headings[2].id,selected,moved,top:original.element.getBoundingClientRect().top};
   });
   assert.equal(new Set(result.ids).size,3,"动态新增标题不得复用已有锚点");
   assert.equal(result.currentId,result.originalId,"原章节的锚点应保持稳定");
   assert.equal(result.selected,"共同标题");
   assert.equal(result.moved,true);assert.ok(Math.abs(result.top-96)<2,"目录点击应实际定位原章节");
  });
  await check("页面尾部空间不足时在滚动底部保持目标可见",async()=>{
   await reset();
   await page.setContent('<style>body{margin:0}main{width:900px;height:500px;overflow:auto}article{margin:0}h2{margin:0}</style><main><article style="height:800px"><div data-message-author-role="user">问题</div></article><article style="height:200px"><div data-message-author-role="assistant"><div class="markdown"><h2>末尾章节</h2></div></div></article></main>');
   const result=await page.evaluate(()=>{
    const api=__CHATGPT_HELPER__.domAdapter,message=api.getAssistantMessages()[0];
    const heading=api.extractHeadings(message.contentElement,message.id)[0];
    const moved=api.scrollToHeading(heading.id,heading.element,heading),main=document.querySelector("main");
    const rect=heading.element.getBoundingClientRect(),bounds=main.getBoundingClientRect();
    return {moved,top:rect.top,visible:rect.top>=bounds.top&&rect.bottom<=bounds.bottom,position:main.scrollTop,max:main.scrollHeight-main.clientHeight};
   });
   assert.equal(result.moved,true);assert.equal(result.position,result.max);
   assert.equal(result.visible,true);assert.ok(result.top>96,"页底定位受最大滚动距离限制");
  });
  await check("空的流式回复不能跨轮次复用旧 Markdown，正文到达后正常识别",async()=>{
   await reset();
   for(const marker of ['data-turn-key="turn"','data-message-id="turn"','data-testid="conversation-turn-1"','',"article"]){
    for(const contentClass of ["MarkdownRoot-test","markdown","prose"]){
    const tag=marker==="article"?"article":"div",attribute=marker==="article"?"":marker;
    await page.setContent(`<style>main{width:900px}p{height:48px}article{height:auto}</style><main><section>
     <${tag} ${attribute}><h4>你说：</h4><div class="group/user-message">问题一</div>
      <div><div><h4>ChatGPT 说：</h4></div><div class="${contentClass}"><h2>已有章节</h2><p>已完成回复</p></div></div>
     </${tag}>
     <${tag} ${attribute.replace("turn\"","next\"").replace("turn-1","turn-2")}><h4>你说：</h4><div class="group/user-message"><div class="markdown"><p>用户引用的 Markdown</p></div></div>
      <div id="pending"><div><h4>ChatGPT 说：</h4></div><div role="status">正在生成</div></div>
     </${tag}>
    </section></main>`);
    const before=await page.evaluate(()=>__CHATGPT_HELPER__.domAdapter.getAssistantMessages().map(message=>message.contentElement.textContent));
    assert.equal(before.length,1,`${marker||"无标记"}：空回复不得产生额外回答`);
    assert.ok(before[0].includes("已有章节"));
    const after=await page.evaluate(contentClass=>{
     document.querySelector("#pending").insertAdjacentHTML("beforeend",`<div class="${contentClass}"><h2>新回复章节</h2><p>新的正文</p></div>`);
     const api=__CHATGPT_HELPER__.domAdapter;
     return api.getAssistantMessages().map(message=>api.extractHeadings(message.contentElement,message.id).map(heading=>heading.text));
    },contentClass);
    assert.deepEqual(after,[["已有章节"],["新回复章节"]],`${marker||"无标记"}：每条回答只包含自己的章节`);
    const regenerating=await page.evaluate(()=>{
     document.querySelector("#pending").parentElement.insertAdjacentHTML("beforeend",'<div><h4>ChatGPT 说：</h4><div role="status">重新生成中</div></div>');
     return __CHATGPT_HELPER__.domAdapter.getAssistantMessages().length;
    });
    assert.equal(regenerating,2,"同一轮重新生成的空回复也不得复用已有正文");
    }
   }
  });
  if(failures.length)throw new Error(failures.join("\n"));
  console.log("全部导航回归通过");
 }finally{await browser.close()}
})().catch(error=>{console.error(error.message);process.exitCode=1});
