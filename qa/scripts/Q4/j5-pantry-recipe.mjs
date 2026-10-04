// J5: "I have paneer, spinach and an air fryer at home" → pantry and kitchen documents updated; "give me a recipe
// without roti" → the Coach sees the pantry and the kitchen; Food › Plan my day → the AI recipe request carries the
// pantry and the equipment, the recipe uses the air fryer, has no roti and shows real carbohydrate. Tablet viewport.
import fs from 'node:fs';
import { openProfile, go, read, say, cards, sleep, results, providerLog, shot, ROOT, lastTurnText, answerChapter, mainText } from './lib.mjs';

const LOG = `${ROOT}/.e6-tmp/q4-J5.jsonl`;
const requests = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

export async function run({ vp = 'tablet' } = {}) {
  const { check, save } = results(`J5-pantry-recipe-${vp}`);
  fs.rmSync(LOG, { force: true });
  await providerLog(LOG);
  const { ctx, page, errors } = await openProfile(`j5-${vp}`, { from: 'seed-living', vp });
  try {
    await answerChapter(page, '/onboarding/diet', { prefs: { 'Which of these do you eat?': 'eggetarian' } });
    await go(page, '/coach');
    await say(page, 'I have paneer, spinach and an air fryer at home');
    const pantry = await read(page, 'pantry.get');
    check('pantry document has paneer and spinach from the Coach', ['paneer', 'spinach'].every((x) => pantry.items.some((i) => i.label.toLowerCase().includes(x) && i.source === 'coach')), JSON.stringify(pantry.items.map((i) => [i.label, i.source])));
    const kitchen = await read(page, 'kitchen.get');
    check('kitchen document has the air fryer', kitchen.equipment.some((e) => /air fryer/i.test(e.label)), JSON.stringify(kitchen.equipment.map((e) => e.label)));
    check('both changes show as applied cards with Undo', (await cards(page)).filter((c) => c.state === 'applied' && /pantry|kitchen/i.test(c.text) && /Undo/.test(c.text)).length >= 2);
    const n0 = requests().length;
    await say(page, 'give me a recipe without roti');
    const turn = requests().slice(n0);
    const seen = JSON.stringify(turn.map((r) => r.request.messages.filter((m) => m.role === 'tool')));
    check('the Coach looked up the pantry and the kitchen (paneer, spinach, air fryer in its tool results)', /Paneer/.test(seen) && /Spinach/.test(seen) && /Air fryer/i.test(seen), seen.slice(0, 200));
    const reply = await lastTurnText(page);
    check('Coach recipe (scripted model) uses the air fryer and no roti', /air fry/i.test(reply) && /no roti/i.test(reply), reply.slice(0, 200));
    // Food tab: the AI recipe provider
    const n1 = requests().length;
    await go(page, '/food');
    await page.getByRole('button', { name: 'Plan my day' }).click();
    await page.getByRole('button', { name: /^Accept / }).first().waitFor({ timeout: 90000 });
    const rq = requests().slice(n1).find((r) => /propose_day_meals|ALLOWED/.test(JSON.stringify(r.request.messages)));
    const user = rq ? JSON.parse(rq.request.messages.at(-1).content) : {};
    check('recipe request carries the kitchen equipment (air fryer)', (user.KITCHEN?.equipment ?? []).some((e) => /air fryer/i.test(e)), JSON.stringify(user.KITCHEN ?? null));
    check('recipe request carries the pantry and prefers it', ['Paneer', 'Spinach'].every((x) => (user.KITCHEN?.pantry ?? []).some((p) => p.includes(x))) && user.KITCHEN?.preferPantry === true, JSON.stringify(user.KITCHEN?.pantry));
    check('allowed foods carry carbohydrate per 100 g', (user.ALLOWED ?? []).some((a) => a.id === 'rice_white_cooked' && a.per100?.carbG > 20), JSON.stringify((user.ALLOWED ?? []).find((a) => a.id === 'rice_white_cooked')));
    let meals = [];
    try { meals = JSON.parse(rq?.reply?.text ?? '{}').meals ?? []; } catch {}
    check('the planned meals have no roti or atta', meals.length > 0 && meals.every((m) => m.ingredients.every((i) => !/roti|chapati|wheat|atta/i.test(i.foodId))), JSON.stringify(meals.map((m) => m.ingredients.map((i) => i.foodId))));
    await page.getByRole('button', { name: 'Open breakfast details' }).click();
    await sleep(1500);
    const sheet = await mainText(page);
    check('recipe steps use the air fryer', /Air fry/i.test(sheet), '');
    const carbs = /carbs\s*≈\s*([\d.]+)/.exec((await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' '));
    check('recipe card shows carbohydrate per serving (not 0)', carbs && Number(carbs[1]) > 5, carbs?.[0] ?? 'no carbs row');
    await shot(page, `J5-recipe-${vp}`);
    await page.keyboard.press('Escape');
    const groc = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].filter((b) => /Already have (Paneer|Spinach)/.test(b.getAttribute('aria-label') || b.innerText)).map((b) => b.getAttribute('aria-pressed')));
    check('groceries count pantry items as already at home', groc.length > 0 && groc.every((p) => p === 'true'), `aria-pressed: ${groc.join(',')}`);
  } catch (e) { check('journey ran to the end', false, e.message.split('\n')[0]); }
  check('no console or page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
  await ctx.close();
  return save();
}
if (process.argv[1]?.endsWith('j5-pantry-recipe.mjs')) { const rows = await run({ vp: process.argv[2] || 'tablet' }); console.table(rows.map((r) => ({ name: r.name, ok: r.ok }))); }
