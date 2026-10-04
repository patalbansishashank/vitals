import { fresh, seed, read, dump, closeAll, mainText, go } from './lib.mjs';
const { page, errors } = await fresh('desktop');
const p = await seed(page);
console.log(JSON.stringify(p).slice(0, 400));
console.log(JSON.stringify(await read(page, 'intake.get')).slice(0, 400));
console.log(JSON.stringify(await read(page, 'plan.get', {}, {raw:true})).slice(0, 400));
await go(page, '/'); await page.waitForTimeout(1500); await dump(page, 'home');
console.log(errors);
await closeAll();
