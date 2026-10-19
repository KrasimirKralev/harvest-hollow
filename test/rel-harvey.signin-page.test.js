// QA r1 H-02 (jde#5, hv#2): the page a sign-in lands on (the mock's page and the real ChatGPT /auth/callback) said
// "You are signed in" and, under it, "Something went wrong on the farm's server" (a false failure on every farmer's
// first page after signing in). The server stamped data-code="" on success and the page shows .why-INTERNAL for "".
// The test reads the page's own CSS: which `.why-*` lines does a rule turn on for the stamped <body>?
// RED on 7f67efe: the ok page shows [ 'INTERNAL' ].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAgent } from '../server/agent/index.js';
import { stubCtx, tmpRoot, waitFor } from './helpers/agent-harness.js';

async function serve(env = {}) {
  const root = tmpRoot('rh-signin-page');
  const h = stubCtx({ root, env });
  const agent = createAgent(h.ctx, { pushMs: 1 });
  const app = express();
  agent.loopbackRoutes(app);
  app.use('/api/harness', agent.routes(express.Router()));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  agent.listening(server.address().port);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { body, token = 'tok-p1' } = {}) => {
    const res = await fetch(`${base}${p}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text };
  };
  const close = async () => { await agent.stop(); await new Promise((r) => server.close(r)); };
  return { ...h, agent, call, close };
}

/** The `.why-*` lines the page's CSS shows for the stamped <body> (every `display: block` rule whose conditions hold). */
export function visibleWhy(html) {
  const body = /<body\s+([^>]*)>/.exec(html)[1];
  const attrs = Object.fromEntries([...body.matchAll(/data-([a-z]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const shown = new Set();
  for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/display:\s*block/.test(rule[2])) continue;
    for (const sel of rule[1].split(',')) {
      const m = /\.why-([A-Z_]+)\s*$/.exec(sel.trim());
      if (!m) continue;
      const conds = [...sel.matchAll(/\[data-([a-z]+)="([^"]*)"\]/g)];
      if (conds.every(([, k, v]) => attrs[k] === v)) shown.add(m[1]);
    }
  }
  return { result: attrs.result, code: attrs.code, why: [...shown].sort() };
}

test('H-02: the successful sign-in page shows no "what went wrong" line (EN and BG are one page)', async (t) => {
  const s = await serve();
  t.after(s.close);
  const st = await s.call('POST', '/api/harness/providers/mock/signin', { body: {} });
  assert.equal(st.json.step.kind, 'open_url');
  const page = await s.call('GET', st.json.step.url, { token: null });
  assert.equal(page.status, 200);
  const v = visibleWhy(page.text);
  assert.equal(v.result, 'ok');
  assert.deepEqual(v.why, [], `the ok page shows ${JSON.stringify(v.why)}`);
  // both language cards carry every why line, so "none visible" holds for EN and BG alike
  for (const lang of ['en', 'bg']) assert.match(page.text, new RegExp(`data-lang="${lang}"[\\s\\S]*?class="why why-INTERNAL"`));
  await waitFor(() => s.pushes.some((p) => p.msg.e === 'signin' && p.pid === 'p1'), 2000, 'signin push');
});

test('H-02: an error page still shows exactly its own line', async (t) => {
  const s = await serve();
  t.after(s.close);
  const r = await s.call('GET', '/auth/callback?code=abc&state=forged', { token: null });
  assert.equal(r.status, 400);
  assert.deepEqual(visibleWhy(r.text), { result: 'error', code: 'STATE', why: ['STATE'] });
  const mock = await s.call('GET', '/api/harness/mock/signin?state=nope', { token: null });
  assert.deepEqual(visibleWhy(mock.text).why, ['STATE']);
});
