// 独立测试配置中的演示截图；扩展直接加载当前项目，不访问用户浏览器或真实会话。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'images/screenshots');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const turns = [
 {question:'如何规划一周的阅读与学习？',body:`<p>把任务拆成每天能够完成的动作，比把日程排满更有效。先确定一个清晰目标，再为阅读、练习和复盘分配时间。</p><h2>1. 明确本周目标</h2><p>选择一个你想解决的问题。到周末时，用一页笔记或一次小练习，展示自己已经掌握的内容。</p><h3>选一个可验证的结果</h3><p>例如：读完一本书的三个章节，并整理出五条可以用于日常工作的行动建议。</p><h2>2. 安排每日节奏</h2><p>每天保留一个固定时段，从容易坚持的安排开始。</p><ul><li><strong>周一至周三：</strong>阅读材料，记录关键观点与疑问。</li><li><strong>周四至周五：</strong>挑一个真实问题，尝试应用所学。</li><li><strong>周末：</strong>回看笔记，整理下周的重点。</li></ul><h2>3. 留出复盘时间</h2><p>用十分钟回答三个问题：这周学会了什么？哪个环节遇到了困难？下一次准备怎样调整？</p>`},
 {question:'第一天应该从哪里开始？',body:'<h2>从一个小问题开始</h2><p>写下你最想弄明白的一个问题，围绕它选取一段材料，完成一次短阅读。</p><h2>留下第一份记录</h2><p>用自己的话解释刚学到的内容，记下尚未理解的部分。</p>'},
 {question:'阅读时怎样整理笔记？',body:'<h2>记录观点与例子</h2><p>保留关键观点，并为每个观点配上一个能帮助自己理解的具体例子。</p><h2>写出下一步行动</h2><p>将值得尝试的建议整理成一份简短的行动清单。</p>'},
 {question:'遇到卡点应该怎么调整？',body:'<h2>缩小问题范围</h2><p>找到最早没有理解的一步，换一个更小的例子重新练习。</p><h2>调整学习节奏</h2><p>为难点留出额外时间，也允许暂时跳过不影响主线的细节。</p>'},
 {question:'周末如何回顾学习效果？',body:'<h2>用成果检验理解</h2><p>将本周所学应用到一个具体问题，观察是否能够独立完成。</p><h2>制定下周计划</h2><p>保留有效的安排，围绕仍未解决的问题继续前进。</p>'}
];
const transcript = turns.map((turn,i)=>`<section data-turn-key="readme-${i+1}"><h4 class="sr-only">你说：</h4><div class="user-bubble group/user-message">${turn.question}</div><div class="assistant-reply"><h4 class="sr-only">ChatGPT 说：</h4><div class="MarkdownRoot-readme">${turn.body}</div></div></section>`).join('');
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>阅读与学习计划 · 演示会话</title><style>
*{box-sizing:border-box}html,body{height:100%;overflow:hidden;margin:0}body{font:16px/1.8 'Microsoft YaHei','Segoe UI',sans-serif;color:#202123;background:#fff}
.native-sidebar{position:fixed;left:0;top:0;width:192px;height:100vh;padding:26px 18px;background:#f7f8fa;border-right:1px solid #eceef1;font-size:13px}.brand{font-size:19px;font-weight:650;margin-bottom:26px}.new-chat{padding:9px 12px;border:1px solid #e3e5e9;border-radius:9px;background:#fff;font-size:14px}.nav-caption{font-size:11px;color:#8a909b;margin:30px 10px 12px}.nav-item{padding:9px 12px;margin-bottom:4px;border-radius:8px;color:#626974}.nav-item.selected{background:#e9edf4;color:#1f2937;font-weight:600}.demo-note{position:absolute;bottom:28px;left:28px;font-size:11px;color:#8a909b;line-height:1.8}
.topbar{position:fixed;left:192px;right:0;top:0;height:64px;padding:0 28px;display:flex;align-items:center;justify-content:space-between;background:#fff;border-bottom:1px solid #f0f1f3;z-index:2;font-size:14px}.topbar strong{font-size:17px;font-weight:600}.demo-tag{font-size:11px;color:#6b7280;background:#f3f4f6;padding:3px 10px;border-radius:20px}
main{height:100vh;overflow:auto;margin-left:192px;padding:90px 38px 150px;scrollbar-width:thin}.conversation{max-width:760px;margin:0 auto}section[data-turn-key]{padding-bottom:48px}.user-bubble{margin:0 0 32px auto;padding:12px 20px;max-width:max-content;border-radius:22px;background:#f1f3f5;color:#262a31;font-size:15px}.assistant-reply p{margin:12px 0 20px;line-height:1.9}.assistant-reply h2{font-size:22px;line-height:1.5;margin:30px 0 14px;letter-spacing:-.3px}.assistant-reply h3{font-size:17px;margin:22px 0 10px}.assistant-reply ul{padding-left:22px}.assistant-reply li{margin:9px 0;line-height:1.9}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.composer{position:fixed;bottom:18px;left:calc(230px + var(--chatgpt-helper-space-left,0px));right:calc(38px + var(--chatgpt-helper-space-right,0px));height:68px;max-width:760px;margin:0 auto;padding:18px 22px;border-radius:22px;background:#f5f6f8;border:1px solid #e9ebef;box-shadow:0 0 22px 14px #fff;color:#9298a1;font-size:14px;z-index:3}.composer span{float:right;color:#657084}
@media(prefers-color-scheme:dark){body{background:#1d1f23;color:#e8eaed}.native-sidebar{background:#17191c;border-color:#2b2e33}.new-chat{background:#22252a;border-color:#33373e;color:#dde1e6}.nav-item{color:#9ca4af}.nav-item.selected{background:#2b3039;color:#eef1f5}.topbar{background:#1d1f23;border-color:#292c31}.demo-tag{background:#2b2f35;color:#a9b0bc}.user-bubble{background:#30343c;color:#eceff3}.composer{background:#2a2e35;border-color:#383e47;box-shadow:0 0 22px 14px #1d1f23;color:#929ba8}}
</style><body><nav class="native-sidebar" aria-label="原生会话列表"><div class="brand">ChatGPT</div><div class="new-chat">＋ 新聊天</div><div class="nav-caption">演示会话</div><div class="nav-item selected">阅读与学习计划</div><div class="nav-item">写作与表达</div><div class="nav-item">项目讨论</div><div class="nav-item">灵感记录</div><div class="demo-note">模拟会话内容<br>目录由当前扩展实际渲染</div></nav><header class="topbar"><strong>ChatGPT <span style="font-weight:400;color:#9298a1">⌄</span></strong><span class="demo-tag">阅读与学习计划 · 演示</span></header><main><div class="conversation">${transcript}</div><div class="composer">询问 ChatGPT <span>↑</span></div></main></body></html>`;
async function run(){
 let context;
 try{
  assert.deepEqual(manifest.permissions,['storage']);
  context=await chromium.launchPersistentContext('',{headless:true,viewport:{width:1280,height:800},deviceScaleFactor:1,executablePath:process.env.CHROME_PATH,args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']});
  const session=await context.browser().newBrowserCDPSession();
  const {id}=await session.send('Extensions.loadUnpacked',{path:root});await session.detach();
  await context.route('https://chatgpt.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:fixture}));
  const page=await context.newPage(),options=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));options.on('pageerror',error=>errors.push(error.message));
  await options.goto(`chrome-extension://${id}/src/options/options.html`);await options.waitForFunction(()=>!document.querySelector('fieldset').disabled);
  await page.goto('https://chatgpt.com/c/readme-demo');await page.waitForSelector('.chatgpt-helper-sidebar__rail');
  assert.equal(await page.evaluate(()=>typeof window.__CHATGPT_HELPER__),'undefined','扩展使用隔离内容脚本');
  const sidebar=page.locator('.chatgpt-helper-sidebar'),outline=page.locator('.chatgpt-helper-message-outline');
  async function pin(panel,railSelector){
   if(await panel.getAttribute('data-expanded')!=='true'){
    const bounds=await panel.locator(railSelector).boundingBox();assert.ok(bounds,'目录刻度条可见');
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
   }
   const button=panel.getByRole('button',{name:'固定面板',exact:true});if(await button.count())await button.click();
  }
  async function save(layout,theme){
   await options.locator(`input[name="theme"][value="${theme}"]`).check();
   await options.locator(`input[name="layout"][value="${layout}"]`).check();await options.getByRole('button',{name:'保存设置',exact:true}).click();
   await page.waitForFunction(({layout,theme})=>document.documentElement.dataset.chatgptHelperLayout===layout&&document.documentElement.dataset.chatgptHelperTheme===theme,{layout,theme});
   await page.emulateMedia({colorScheme:theme});
  }
  const shots=[];
  async function capture(name){
   await page.mouse.move(700,35);await page.waitForTimeout(350);
   assert.equal(await page.locator('.chatgpt-helper-loading-notice').isVisible(),false);
   assert.equal(await sidebar.locator('.chatgpt-helper-sidebar__group').count(),5);
   await page.screenshot({path:path.join(output,name),animations:'disabled'});shots.push({name,width:1280,height:800});console.log('已截图：'+name);
  }
  await pin(sidebar,'.chatgpt-helper-sidebar__rail');await page.waitForFunction(()=>document.querySelector('.chatgpt-helper-sidebar').dataset.loading==='false',null,{timeout:30000});
  await sidebar.getByRole('button',{name:'1. 明确本周目标',exact:true}).click();await capture('merged-light.png');
  await save('questions-left','light');await pin(sidebar,'.chatgpt-helper-sidebar__rail');
  await sidebar.getByRole('button',{name:'如何规划一周的阅读与学习？',exact:true}).click();
  await pin(outline,'.chatgpt-helper-message-outline__rail');await outline.getByRole('button',{name:'2. 安排每日节奏',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.chatgpt-helper-sidebar').dataset.loading==='false',null,{timeout:30000});
  // 双侧布局的问题列表没有合并树，单独核对问题与当前回答的标题。
  await page.mouse.move(700,35);await page.waitForTimeout(350);assert.equal(await sidebar.locator('.chatgpt-helper-sidebar__item').count(),5);assert.equal(await outline.locator('[data-heading-id]').count()>0,true);
  await page.screenshot({path:path.join(output,'split-light.png'),animations:'disabled'});shots.push({name:'split-light.png',width:1280,height:800});console.log('已截图：split-light.png');
  await save('merged-left','dark');await pin(sidebar,'.chatgpt-helper-sidebar__rail');
  await sidebar.getByRole('button',{name:'2. 安排每日节奏',exact:true}).click();await capture('merged-left-dark.png');
  await save('questions-left','light');await options.setViewportSize({width:720,height:850});
  assert.equal(await options.locator('input[name="layout"]').count(),4);assert.equal(await options.locator('input[name="theme"]').count(),2);
  assert.ok(await options.getByRole('button',{name:'保存设置',exact:true}).isVisible());await options.screenshot({path:path.join(output,'settings.png'),animations:'disabled'});shots.push({name:'settings.png',width:720,height:850});console.log('已截图：settings.png');
  assert.deepEqual(errors,[]);
  const files=[...new Set(['manifest.json',...manifest.content_scripts.flatMap(s=>s.js.concat(s.css)),manifest.options_page,'src/options/options.js','src/options/options.css'])];
  const sourceHashes=Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
  fs.writeFileSync(path.join(root,'images/screenshots/provenance.json'),JSON.stringify({version:manifest.version,browser:context.browser().version(),type:'native extension / simulated conversation / no real account',shots,sourceHashes},null,2)+'\n');
  console.log('通过：当前源码原生扩展、四张截图、真实配置保存与切换，无页面异常');
 }finally{await context?.close()}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1});
