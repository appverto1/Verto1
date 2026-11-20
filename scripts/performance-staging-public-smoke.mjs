/**
 * Read-only browser/performance smoke of the public Railway Staging hostname.
 * No authentication, patient data or writes. Triggered explicitly from CI.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = new URL(process.env.VERTO_PERF_STAGING_URL || 'https://staging-staging-7cd6.up.railway.app/');
assert.equal(base.protocol, 'https:');
assert.equal(base.hostname, 'staging-staging-7cd6.up.railway.app', 'staging only');
const dir = 'perf-staging-public-evidence';
await fs.mkdir(dir, {recursive:true});
const result = {origin:base.origin,at:new Date().toISOString(),network:{},desktop:null,mobileSlow3g:null,warnings:[]};
const save = () => fs.writeFile(path.join(dir,'results.json'),JSON.stringify(result,null,2)+'\n');
const request = async (pathname, binary=false) => {
  const response = await fetch(new URL(pathname,base),{redirect:'manual',signal:AbortSignal.timeout(30000),
    headers:{'Accept-Encoding':'br, gzip','User-Agent':'Mozilla/5.0 VertoPublicStagingSmoke/1.0'}});
  assert.equal(response.status,200,'public asset '+pathname+' status '+response.status);
  assert.equal(new URL(response.url).origin,base.origin,'never leave staging');
  const bytes=Buffer.from(await response.arrayBuffer());
  const headers=Object.fromEntries(['content-type','content-length','content-encoding','cache-control','vary']
    .map(k=>[k,response.headers.get(k)]));
  return {bytes,text:binary?null:bytes.toString('utf8'),headers};
};
try {
  const html=await request('/');
  assert.match(html.text,/id=["']root["']/);
  result.network.html={decodedBytes:html.bytes.length,...html.headers};
  const assets=[...new Set([...html.text.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:js|mjs|css))["']/g)].map(m=>m[1]))];
  assert.ok(assets.some(x=>/\.(js|mjs)$/.test(x)),'built SPA script must be present');
  assert.ok(assets.some(x=>/\.css$/.test(x)),'built SPA CSS must be present');
  result.network.textAssets=[];
  for (const name of assets.slice(0,4)) {
    const r=await request(name,true);
    result.network.textAssets.push({path:name,decodedBytes:r.bytes.length,...r.headers});
    if(!['br','gzip'].includes(String(r.headers['content-encoding']||'')))
      result.warnings.push('Uncompressed JS/CSS: '+name);
  }
  for(const [name,url,mime,limit] of [
    ['logoSmall','/branding/verto/verto-symbol-128.webp','image/webp',10000],
    ['logoLarge','/branding/verto/verto-symbol-256.webp','image/webp',20000],
    ['logoFallback','/branding/verto/verto-symbol.png','image/png',300000],
    ['heroMobile','/hero-verto-family-diary-480.webp','image/webp',100000],
  ]) {
    const r=await request(url,true);
    assert.ok((r.headers['content-type']||'').includes(mime),name+' must be '+mime);
    assert.ok(r.bytes.length<=limit,name+' should fit transfer budget');
    result.network[name]={path:url,decodedBytes:r.bytes.length,...r.headers};
  }
  const {chromium}=await import('playwright-core');
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    for(const config of [{key:'desktop',width:1440,height:900,slow:false,timeout:45000},
       {key:'mobileSlow3g',width:390,height:844,slow:true,timeout:120000}]) {
      const context=await browser.newContext({viewport:{width:config.width,height:config.height},
        deviceScaleFactor:config.slow?2:1,isMobile:config.slow,hasTouch:config.slow,serviceWorkers:'block'});
      await context.addInitScript(()=>{
        window.__vertoSmoke={cls:0,lcpMs:null};
        try {new PerformanceObserver(list=>{for(const e of list.getEntries())
          if(!e.hadRecentInput)window.__vertoSmoke.cls+=e.value;
        }).observe({type:'layout-shift',buffered:true});}catch{}
        try {new PerformanceObserver(list=>{const es=list.getEntries();
          if(es.length)window.__vertoSmoke.lcpMs=es.at(-1).startTime;
        }).observe({type:'largest-contentful-paint',buffered:true});}catch{}
      });
      const page=await context.newPage(),failed=[];
      page.on('requestfailed',req=>{const u=new URL(req.url());if(u.origin===base.origin)
        failed.push({path:u.pathname,error:req.failure()?.errorText||'failed'});});
      if(config.slow){const cdp=await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:400,
          downloadThroughput:48*1024,uploadThroughput:24*1024,connectionType:'cellular3g'});
      }
      const started=performance.now();
      const nav=await page.goto(base.href,{waitUntil:'domcontentloaded',timeout:config.timeout});
      assert.equal(nav?.status(),200,config.key+' navigation status');
      await page.waitForFunction(()=>document.querySelector('#root')?.children.length>0,
        null,{timeout:config.timeout});
      await page.waitForTimeout(config.slow?4500:2000);
      const metrics=await page.evaluate(()=>{
        const p=performance.getEntriesByType('navigation')[0];
        const f=performance.getEntriesByName('first-contentful-paint')[0];
        return {title:document.title,rootChildren:document.querySelector('#root')?.children.length||0,
          nodes:document.querySelectorAll('*').length,firstContentfulPaintMs:f?Math.round(f.startTime):null,
          largestContentfulPaintMs:window.__vertoSmoke?.lcpMs!=null?Math.round(window.__vertoSmoke.lcpMs):null,
          cumulativeLayoutShift:Math.round((window.__vertoSmoke?.cls||0)*10000)/10000,
          domContentLoadedMs:p?Math.round(p.domContentLoadedEventEnd):null,
          viewportWidth:innerWidth,documentScrollWidth:document.documentElement.scrollWidth};
      });
      metrics.wallClockMs=Math.round(performance.now()-started);
      metrics.failedFirstPartyRequests=failed.slice(0,12);
      result[config.key]=metrics;
      await page.screenshot({path:path.join(dir,config.key+'.png'),fullPage:false});
      await context.close();
    }
  }finally{await browser.close();}
  await save();
  console.log('VERTO_STAGING_PERF_PUBLIC='+JSON.stringify(result));
  assert.equal(result.network.textAssets.filter(x=>['br','gzip'].includes(x['content-encoding'])).length,
    result.network.textAssets.length,'real text asset encoding must be gzip or Brotli');
  assert.equal(result.desktop.failedFirstPartyRequests.length,0);
  assert.equal(result.mobileSlow3g.failedFirstPartyRequests.length,0);
  console.log('PASS: public Staging HTTP encoding, WebP, desktop and mobile Slow 3G');
}catch(error){result.error=String(error?.stack||error);await save();
  console.error('VERTO_STAGING_PERF_FAILURE='+result.error);process.exitCode=1;}
