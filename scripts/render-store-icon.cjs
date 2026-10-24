// 从现有 SVG 生成符合商店透明留白规格的 128px 图标。
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const candidate=path.resolve(__dirname,'..');
(async()=>{
 const original=fs.readFileSync(path.join(candidate,'assets/icon.svg'),'utf8');
 const inner=original.replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
 const padded='<svg width="128" height="128" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><g transform="translate(3.2 3.2) scale(0.8)">'+inner+'</g></svg>';
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 try{
  const page=await browser.newPage({viewport:{width:128,height:128},deviceScaleFactor:1});
  await page.setContent('<style>html,body{margin:0;width:128px;height:128px;background:transparent}svg{display:block}</style>'+padded);
  assert.equal(await page.locator('svg').count(),1);
  await page.screenshot({path:path.join(candidate,'assets/icon-128.png'),omitBackground:true});
  fs.writeFileSync(path.join(candidate,'docs/store-icon.svg'),padded+'\n');
  console.log('已生成 128×128 图标：图形约 96×96，四边约 16px 透明留白');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
