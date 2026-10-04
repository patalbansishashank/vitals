// J4 helper snippet: show the app window without focus and park it on a private special workspace so captures paint
ctx.park = async () => {
  const app = ctx.run.app;
  const pid = app.process().pid;
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const sig = fs.readdirSync(`/run/user/${process.getuid()}/hypr`)[0];
  const env = { ...process.env, HYPRLAND_INSTANCE_SIGNATURE: sig };
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  for (let i = 0; i < 200; i++) {
    const cl = JSON.parse(execFileSync('hyprctl', ['-j', 'clients'], { env, encoding: 'utf8' }));
    const w = cl.find((c) => c.pid === pid);
    if (w) {
      if (w.workspace?.name === 'special:j4qa') return 'already parked';
      const out = execFileSync('hyprctl', ['dispatch', `hl.dsp.window.move({ workspace = "special:j4qa", follow = false, window = "address:${w.address}" })`], { env, encoding: 'utf8' });
      const after = JSON.parse(execFileSync('hyprctl', ['-j', 'clients'], { env, encoding: 'utf8' })).find((c) => c.pid === pid);
      if (after?.workspace?.name !== 'special:j4qa') await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
      return `move: ${out.trim()} -> ${after?.workspace?.name} after ${i} polls`;
    }
    await ctx.sleep(10);
  }
  return 'window not found';
};
return 'ok';
