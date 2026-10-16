import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
let handler, outgoing;
const source = ts.transpileModule(fs.readFileSync('supabase/functions/payment/index.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(source, {
  module, exports: module.exports, console, crypto, Request, Response, URL, Map, Date,
  Deno: { env: { get: (name) => ({ CASHFREE_APP_ID: 'fixture', CASHFREE_SECRET_KEY: 'fixture' })[name] } },
  require: (name) => {
    if (name.includes('http/server')) return { serve: (callback) => { handler = callback; } };
    if (name.includes('supabase-js')) return { createClient: () => null };
    if (name.includes('/access')) return { clearEffectiveAccessCacheByPublicUserId: () => {} };
    if (name.includes('/cors')) return { getCorsHeaders: () => ({}) };
    throw new Error(`Unexpected module ${name}`);
  },
  fetch: async (_url, options) => {
    if (options.method === 'POST') {
      outgoing = JSON.parse(options.body);
      return new Response(JSON.stringify({ order_id: outgoing.order_id, order_status: 'ACTIVE', payment_session_id: 'fixture-session' }));
    }
    return new Response(JSON.stringify({ order_id: 'legacy-order', order_amount: 129, order_note: 'Plan: monthly', order_status: 'ACTIVE' }));
  },
});
async function send(body, path = '') {
  return handler(new Request(`https://api.himeera.com/functions/v1/payment${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
}
for (const [body, label] of [
  [{ plan_type: 'monthly', amount: 129 }, 'retired monthly plan rejected'],
  [{ plan_type: 'lifetime', amount: 1 }, 'underpriced lifetime payment rejected'],
  [{ plan_type: 'lifetime', amount: 499, order_currency: 'USD' }, 'Cashfree accepts INR only'],
]) {
  assert.equal((await send(body)).status, 400, label); console.log('PASS', label);
}
let response = await send({ plan_type: 'lifetime', amount: 499, order_currency: 'INR' });
assert.equal(response.status, 200);
assert.equal(outgoing.order_amount, 499);
assert.equal(outgoing.order_currency, 'INR');
assert.equal(outgoing.order_note, 'Plan: lifetime');
console.log('PASS new Cashfree orders are locked to INR 499 lifetime');
response = await send({ order_id: 'legacy-order', plan_type: 'lifetime' }, '/verify');
const result = await response.json();
assert.equal(result.data.plan_type, 'monthly');
console.log('PASS existing monthly orders remain verifiable and cannot be relabeled lifetime by the client');
