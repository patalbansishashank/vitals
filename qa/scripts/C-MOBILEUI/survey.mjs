// Resume a synthetic mobile route survey. Evidence stays in ignored local files.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../../..'),output=path.join(root,'.e6-tmp/c-mobileui');
const base=process.env.BASE;if(!base)throw Error('BASE required');
const phase=process.argv[2]||'before';fs.mkdirSync(path.join(output,phase),{recursive:true});
const source=fs.readFileSync(path.join(root,'qa/scripts/C-MOBILEUI/capture.mjs'),'utf8');
const groups=Function('return '+source.match(/const routeGroups = (\{[\s\S]*?\n\});/)[1])();
const routes=[...new Set(Object.values(groups).flat()),'/profile','/simulator','/planner','/library','/onboarding','/simulate/starter','/dev/components','/dev/picker','/dev/safety','/dev/avatar','/dev/figure','/dev/charts','/dev/error'];
const state=JSON.parse(fs.readFileSync(path.join(output,'synthetic-state.json'),'utf8'));
const rows=[];let b;
const widths=process.env.WIDTHS?.split(',').map(Number)||[360,390];const schemes=process.env.SCHEMES?.split(',')||['dark','light'];
for(const width of widths)for(const scheme of schemes){
let c,p;
for(const [index,route] of routes.entries()){
 const shot=`${route.replace(/^\//,'').replace(/[^a-z0-9]+/gi,'-')||'root'}-${width}-${scheme}.png`;
 if(phase==='before'&&fs.existsSync(path.join(output,phase,shot)))continue;
 try{
 if(!b?.isConnected())b=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 if(!p||p.isClosed()){c=await b.newContext({viewport:{width,height:width===390?844:800},colorScheme:scheme,isMobile:true,hasTouch:true,storageState:state,serviceWorkers:'block'});p=await c.newPage();p.setDefaultTimeout(9000)}
 const u=new URL(route,base);u.searchParams.set('qa','1');await p.goto(u.href,{waitUntil:'domcontentloaded',timeout:20000});
 await p.locator('main .lm-page,main h1,[role=alert]').first().waitFor({state:'visible',timeout:9000}).catch(()=>{});
 await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(route.startsWith('/body')?1300:500);
 const metrics=await p.evaluate(()=>({route:location.pathname+location.search,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),title:document.querySelector('h1')?.textContent,contentLength:document.querySelector('main')?.textContent.length||0}));
 await p.screenshot({path:path.join(output,phase,shot),animations:'disabled',timeout:12000});
 rows.push({route,width,scheme,shot,metrics});console.log('captured',route,width,scheme,metrics.overflow);
 }catch(e){rows.push({route,width,scheme,error:String(e.message).split('\n')[0]});console.log('LEFT',route,width,scheme);await c?.close().catch(()=>{});p=null;c=null;}
 fs.writeFileSync(path.join(output,`${phase}-survey-${width}-${scheme}.json`),JSON.stringify(rows,null,2));
 if(index%12===11){await c?.close().catch(()=>{});p=null;c=null}
}
await c?.close().catch(()=>{});await b?.close().catch(()=>{});b=null;
}
