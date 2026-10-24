const assert = require('node:assert/strict');
const { launchBrowser } = require("./browser-launch.cjs");
const path = require('node:path');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await launchBrowser();
  async function createPage(body) {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    await page.setContent(body);
    for (const file of ['dom-adapter.js','history-loader.js']) await page.addScriptTag({path:path.join(root,'src/content',file)});
    return page;
  }
  try {
    const deletionFixture = '<!doctype html><main style="width:900px;height:500px;overflow:auto"><article style="height:800px" data-message-id="q1"><div data-message-author-role="user">Q1</div></article><article style="height:800px" data-message-id="q2"><div data-message-author-role="user">Q2</div></article></main>';
    const page = await createPage(deletionFixture);
    assert.deepEqual(await page.evaluate(()=>{
      const api=__CHATGPT_HELPER__.historyLoader;
      api.collect();document.querySelector('[data-message-id="q2"]').remove();
      return api.collect().map(x=>x.title);
    }),['Q1']);
    console.log('通过：删除原生ID问题时同步移除目录缓存');
    const virtual = await createPage('<!doctype html><style>html,body{height:100%;overflow:hidden;margin:0}main{width:900px;height:100%;overflow:auto}article{height:600px}</style><main><article data-message-id="q7"><div data-message-author-role="user">Q7</div></article><article data-message-id="q8"><div data-message-author-role="user">Q8</div></article></main>');
    const result = await virtual.evaluate(async()=>{
      const api=__CHATGPT_HELPER__.historyLoader;
      const original=api.collect()[0], main=document.querySelector('main');
      const turn=i=>'<article data-message-id="q'+i+'"><div data-message-author-role="user">Q'+i+'</div></article>';
      main.innerHTML=[1,2].map(turn).join('')+'<div style="height:3600px"></div>';
      main.addEventListener('scroll',()=>{
        if(main.scrollTop>=3500&&!document.querySelector('[data-message-id="q7"]'))main.innerHTML='<div style="height:3600px"></div>'+[7,8].map(turn).join('');
      });
      api.collect();const order=api.getGroups().map(x=>x.title);
      const found=await api.reveal(original.id);
      return {order,found,scrollTop:main.scrollTop};
    });
    assert.deepEqual(result.order,['Q1','Q2','Q7','Q8']);assert.equal(result.found,true);assert.equal(result.scrollTop,3504);
    console.log('通过：不重叠虚拟窗口前插及原消息坐标补偿');
    for (const direction of ['column', 'column-reverse']) {
      const overlap=await createPage('<!doctype html><style>html,body{height:100%;overflow:hidden;margin:0}main{width:900px;height:100%;overflow:auto;display:flex;flex-direction:'+direction+'}section{flex-shrink:0}article{height:600px}</style><main><section><article data-turn-key="q7"><div data-message-author-role="user">Q7</div></article><article data-turn-key="q8"><div data-message-author-role="user">Q8</div></article></section></main>');
      const shifted=await overlap.evaluate(async()=>{
        const api=__CHATGPT_HELPER__.historyLoader,dom=__CHATGPT_HELPER__.domAdapter;
        const original=api.collect()[0],main=document.querySelector('main'),content=document.querySelector('section');
        const turn=i=>'<article data-turn-key="q'+i+'"><div data-message-author-role="user">Q'+i+'</div></article>';
        content.innerHTML=turn(1)+'<div style="height:3600px"></div>'+turn(8);
        dom.scrollToPosition(main,0);
        main.addEventListener('scroll',()=>{
          if(dom.getScrollMetrics(main).position>=3500&&!document.querySelector('[data-turn-key="q7"]'))content.innerHTML='<div style="height:3600px"></div>'+[7,8].map(turn).join('');
        });
        api.collect();
        const order=api.getGroups().map(x=>x.title),cachedPosition=api.getGroups().find(x=>x.id===original.id).position;
        return {order,cachedPosition,found:await api.reveal(original.id),position:dom.getScrollMetrics(main).position};
      });
      assert.equal(shifted.cachedPosition,3600,'部分重叠分页应补偿已卸载消息的位置');
      assert.deepEqual(shifted.order,['Q1','Q7','Q8']);
      assert.equal(shifted.found,true);assert.equal(shifted.position,3504);
    }
    console.log('通过：正向与反向部分重叠分页补偿旧坐标，保留顺序并定位卸载消息');
    const recent=await createPage(deletionFixture);
    await recent.evaluate(()=>{__CHATGPT_HELPER__.historyLoader.collect();document.querySelector('main').scrollTop=200});
    await recent.waitForTimeout(50);
    assert.deepEqual(await recent.evaluate(()=>{
      const api=__CHATGPT_HELPER__.historyLoader;api.collect();
      document.querySelector('[data-message-id="q2"]').remove();return api.collect().map(x=>x.title);
    }),['Q1']);
    console.log('通过：滚动后立即删除消息也不会保留幽灵目录');
    for(const kind of ['question','answer']){
      const body=kind==='question'?deletionFixture:'<!doctype html><main style="width:900px;height:500px;overflow:auto"><article style="height:800px" data-message-id="q1"><div data-message-author-role="user">Q1</div></article><article style="height:800px" data-message-id="a1"><div data-message-author-role="assistant"><div class="markdown"><h2>A1</h2></div></div></article></main>';
      const replacement=await createPage(body);
      const result=await replacement.evaluate(async(kind)=>{
        const api=__CHATGPT_HELPER__.historyLoader;
        api.collect();document.querySelector('main').scrollTop=200;
        await new Promise(resolve=>setTimeout(resolve,50));
        const oldId=kind==='question'?'q2':'a1';
        const html=kind==='question'?'<div data-message-author-role="user">Q3</div>':'<div data-message-author-role="assistant"><div class="markdown"><h2>A2</h2></div></div>';
        document.querySelector('[data-message-id="'+oldId+'"]').outerHTML='<article style="height:800px" data-message-id="'+(kind==='question'?'q3':'a2')+'">'+html+'</article>';
        const snapshot=()=>{const groups=api.collect();return kind==='question'?groups.map(item=>item.title):groups[0].answers.map(item=>item.headings[0].text)};
        const immediate=snapshot();await new Promise(resolve=>setTimeout(resolve,1100));
        return {immediate,later:snapshot()};
      },kind);
      const expected=kind==='question'?['Q1','Q3']:['A2'];
      assert.deepEqual(result.immediate,expected,'滚动期间等高替换应移除旧消息');
      assert.deepEqual(result.later,expected,'滚动结束后旧消息也不应残留');
    }
    console.log('通过：滚动期间等高替换问题或回答，立即清理旧身份且无残留');
    for(const boundary of ['', 'bottom'])for(const kind of ['question','answer']){
      const body=kind==='question'?deletionFixture:'<!doctype html><main style="width:900px;height:500px;overflow:auto"><article style="height:800px" data-message-id="q1"><div data-message-author-role="user">Q1</div></article><article style="height:800px" data-message-id="a1"><div data-message-author-role="assistant"><div class="markdown"><h2>A1</h2></div></div></article></main>';
      const replacement=await createPage(body);
      const result=await replacement.evaluate(async({boundary,kind})=>{
        const api=__CHATGPT_HELPER__.historyLoader;
        api.collect();let started=false,finished=false;
        const loading=api.load({boundary:boundary||undefined,onStart(){started=true}}).then(()=>{finished=true});
        await new Promise(resolve=>setTimeout(resolve,50));
        const finishedAtReplacement=finished;
        const oldId=kind==='question'?'q2':'a1';
        const html=kind==='question'?'<div data-message-author-role="user">Q3</div>':'<div data-message-author-role="assistant"><div class="markdown"><h2>A2</h2></div></div>';
        document.querySelector('[data-message-id="'+oldId+'"]').outerHTML='<article style="height:800px" data-message-id="'+(kind==='question'?'q3':'a2')+'">'+html+'</article>';
        const snapshot=()=>{const groups=api.collect();return kind==='question'?groups.map(item=>item.title):groups[0].answers.map(item=>item.headings[0].text)};
        const immediate=snapshot();await loading;
        return {started,finishedAtReplacement,immediate,later:snapshot()};
      },{boundary,kind});
      const expected=kind==='question'?['Q1','Q3']:['A2'];
      assert.equal(result.started,true);assert.equal(result.finishedAtReplacement,false,'替换必须发生在扫描期间');
      assert.deepEqual(result.immediate,expected,'扫描期间同位置的新消息应取代旧消息');
      assert.deepEqual(result.later,expected,'扫描完成后也不得保留旧身份');
    }
    console.log('通过：完整扫描与首尾定位期间替换问题或回答，立即清除旧身份');
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
