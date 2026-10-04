// Synthetic, unpaired mobile overlay survey. BASE must point to this worktree.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../../..');
const output=path.join(root,'.e6-tmp/c-mobileui');
const base=process.env.BASE;
if(!base) throw new Error('BASE required');
const phase=process.argv[2] || 'before';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const state=JSON.parse(fs.readFileSync(path.join(output,'synthetic-state.json'),'utf8'));
const rows=[];
const click=(name,role='button')=>async p=>p.getByRole(role,{name,exact:typeof name==='string'}).first().click();
const menu=(name)=>async p=>{await click('Today menu')(p);await click(name,'menuitem')(p)};
const screens=[
['welcome','/welcome',null,true],['screening','/welcome?step=screening',null,true],['consent-real','/welcome?step=screening',async p=>{for(const f of await p.locator('fieldset').all()){const r=f.getByRole('radio',{name:/^(18–64|no)$/});if(await r.count())await r.first().click()}await p.getByRole('button',{name:'Continue',exact:true}).click();await p.locator('.lm-onb[data-step=consent]').waitFor()},true],
['more-menu','/today',click('More')],['today-menu','/today',click('Today menu')],
['busy','/today',menu(/busy or away/)],['checkin','/today',menu(/Check in now/)],['pause','/today',menu(/Pause plan/)],
['today-row','/today',click('More for breakfast')],['meal','/food',click('I ate something else: dinner')],
['other-food','/food',click('Log other food')],['recipe','/food',click('Open breakfast details')],
['no-benefit','/food',click('Things that won’t help your goals')],['swap','/train',click(/^Swap /)],
['session','/train',click('I did something else')],['measurement','/progress',click('Add a measurement')],
['erase-confirmation','/settings/data',click('Reset everything')],['habits','/body',click(/^Edit$/)],
['labs','/body',click('Add values')],['goal-picker','/plan/goals',click('Add a goal')],
['coach-briefing','/coach',click(/what it knows/i)],['server-code','/settings/server',click('Enter code')],
['import','/settings/data',async p=>p.locator('#your-data input[type=file]').first().setInputFiles(path.join(root,'qa/fixtures/q1b/export-m-veg.json'))],
['evidence-mechanism','/evidence',async p=>p.locator('main a[href^="/evidence/"]:not([href*="topics"]):not([href*="validation"])').first().click()],
['evidence-topic','/evidence?group=topic',async p=>p.locator('main a[href*="/evidence/topics/"]').first().click()],
['train-week','/train',click(/^week$/)],
];
try{
for(const width of [360,390]) for(const scheme of ['dark','light']){
const ctx=await browser.newContext({viewport:{width,height:width===390?844:800},isMobile:true,hasTouch:true,deviceScaleFactor:1,colorScheme:scheme,storageState:state,serviceWorkers:'block'});
const p=await ctx.newPage();p.setDefaultTimeout(3500);
for(const [name,route,open,fresh] of screens){
 if(fs.existsSync(path.join(output,phase,`overlay-${name}-${width}-${scheme}.png`)))continue;
 let freshCtx, page=p;
 try{
 if(fresh){freshCtx=await browser.newContext({viewport:{width,height:width===390?844:800},isMobile:true,hasTouch:true,colorScheme:scheme,serviceWorkers:'block'});page=await freshCtx.newPage();page.setDefaultTimeout(3500)}
 await page.goto(new URL(route,base).href,{waitUntil:'domcontentloaded'});await page.locator('main .lm-page,.lm-onb').first().waitFor({timeout:12000});await page.waitForTimeout(700);
 if(open) await open(page);
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(900);
 const shot=`overlay-${name}-${width}-${scheme}.png`;
 await page.screenshot({path:path.join(output,phase,shot),animations:'disabled'});
 const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,dialogs:[...document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog],[role=menu]')].map(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom}})}));
 rows.push({name,route,width,scheme,shot,metrics});console.log(name,width,scheme,JSON.stringify(metrics));
 }catch(e){rows.push({name,route,width,scheme,error:e.message.split('\n')[0]});console.log('LEFT',name,width,scheme)}finally{await freshCtx?.close()}
}
await ctx.close();
}
}finally{await browser.close();fs.writeFileSync(path.join(output,`${phase}-overlays.json`),JSON.stringify(rows,null,2))}
