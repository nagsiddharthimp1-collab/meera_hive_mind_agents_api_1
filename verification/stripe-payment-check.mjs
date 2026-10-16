import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const RealStripe = require('stripe');
const { NextRequest } = require('next/server');

const rows = new Map();
let user = { id: 'auth-test', email: 'checkout@example.test' };
let profile = { id: 'public-test' };
let createdOptions;
const fixture = { id: 'cs_live_fixture', created: 1792140000, livemode: true, mode: 'payment', currency: 'usd', amount_total: 9900,
  payment_status: 'paid', client_reference_id: 'auth-test', metadata: { auth_user_id: 'auth-test', public_user_id: 'public-test', plan_type: 'lifetime' } };
const db = { auth: { getUser: async () => ({ data: { user }, error: null }) }, from(table) {
  const query = { filters: {}, select() { return this; }, eq(key, value) { this.filters[key] = value; return this; }, in() { return this; },
    async limit() { return { data: [...rows.values()].filter((r) => r.payment_status === 'paid'), error: null }; },
    async maybeSingle() { return { data: table === 'users' ? profile : rows.get(this.filters.payment_id), error: null }; },
    async upsert(row, options) { if (!options.ignoreDuplicates || !rows.has(row.payment_id)) rows.set(row.payment_id, row); return { error: null }; },
    update(values) { this.values = values; return this; },
    then(resolve) { for (const [id, row] of rows) { if (Object.entries(this.filters).every(([key, value]) => row[key] === value)) rows.set(id, {...row, ...this.values}); } resolve({error:null}); },
  };
  return query;
} };
class FakeStripe extends RealStripe {
  constructor(key) { super(key); this.paymentIntents = { retrieve: async () => ({latest_charge:{refunded:false}}) }; this.checkout = { sessions: {
    create: async (options) => { createdOptions = options; return { url: 'https://checkout.stripe.com/c/pay/fixture' }; },
    retrieve: async () => fixture,
    list: async () => ({ data: [fixture] }),
  } }; }
}
const env = { STRIPE_SECRET_KEY: 'sk_live_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', SUPABASE_URL: 'https://api.himeera.com', SUPABASE_SERVICE_ROLE_KEY: 'fixture', VERCEL_ENV: 'production' };
function compile(path, overrides = {}, environment = env) {
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: (name) => overrides[name] ?? require(name), process: { env: environment }, console, Date, URL, Request, Response }, { filename: path });
  return module.exports;
}
const payments = compile('src/lib/stripePayments.ts', { stripe: FakeStripe, '@supabase/supabase-js': { createClient: () => db } });
const checkout = compile('src/app/api/payment/stripe/checkout/route.ts', { '@/lib/stripePayments': payments });
const webhook = compile('src/app/api/payment/stripe/webhook/route.ts', { '@/lib/stripePayments': payments });
const status = compile('src/app/api/payment/stripe/status/route.ts', { '@/lib/stripePayments': payments });
const offer = compile('src/app/api/payment/offer/route.ts', { '@/lib/stripePayments': payments });
function check(value, label) { assert.ok(value, label); console.log('PASS', label); }
check((await offer.GET(new NextRequest('http://localhost/api/payment/offer', {headers:{'x-vercel-ip-country':'IN'}})).json()).market === 'india', 'Indian visitors receive the Cashfree offer');
check((await offer.GET(new NextRequest('http://localhost/api/payment/offer', {headers:{'x-vercel-ip-country':'US'}})).json()).market === 'international', 'international visitors receive the Stripe offer');
check(payments.stripeCheckoutReady(), 'live key and webhook enable production checkout');
env.STRIPE_SECRET_KEY = 'sk_test_fixture';
check(!payments.stripeCheckoutReady(), 'test key cannot enable production checkout');
env.STRIPE_SECRET_KEY = 'sk_live_fixture';
await payments.fulfillStripeSession({ ...fixture, payment_status: 'unpaid' });
check(rows.size === 0, 'unpaid completion cannot grant access');
await assert.rejects(payments.fulfillStripeSession({ ...fixture, amount_total: 1 }), /Unexpected/);
check(rows.size === 0, 'wrong price cannot grant access');
await assert.rejects(payments.fulfillStripeSession({ ...fixture, livemode: false }), /QA database/);
check(rows.size === 0, 'sandbox cannot grant production access');
profile = null;
await assert.rejects(payments.fulfillStripeSession(fixture), /unavailable/);
profile = { id: 'public-test' };
await payments.fulfillStripeSession(fixture);
check(rows.get(fixture.id).currency === 'USD' && rows.get(fixture.id).amount === 99, 'verified payment records USD 99 and lifetime access');
await payments.revokeStripePayment('pi_fixture', 'refunded');
await payments.fulfillStripeSession(fixture);
check(rows.get(fixture.id).payment_status === 'refunded', 'replayed completion cannot overwrite refund');
await payments.restoreStripePayment('pi_fixture');
check(rows.get(fixture.id).payment_status === 'refunded', 'a resolved dispute cannot undo a refund');
await payments.revokeStripePayment('pi_fixture', 'disputed');
await payments.restoreStripePayment('pi_fixture');
check(rows.get(fixture.id).payment_status === 'paid', 'a won dispute restores disputed access');
rows.clear();
let response = await webhook.POST(new Request('http://localhost/api/payment/stripe/webhook', { method: 'POST', body: '{}' }));
check(response.status === 400, 'unsigned webhook is rejected');
const signature = new RealStripe('sk_test_fixture').webhooks.generateTestHeaderString;
const event = JSON.stringify({ id: 'evt_fixture', type: 'checkout.session.completed', data: { object: fixture } });
const header = signature({ payload: event, secret: env.STRIPE_WEBHOOK_SECRET });
response = await webhook.POST(new Request('http://localhost/api/payment/stripe/webhook', { method: 'POST', body: event, headers: { 'stripe-signature': header } }));
check(response.status === 200 && rows.has(fixture.id), 'signed webhook fulfills verified payment');
rows.clear();
const request = new NextRequest('http://localhost/api/payment/stripe/checkout', { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Idempotency-Key': 'test-request-123' }, body: JSON.stringify({ amount: 1, plan_type: 'monthly' }) });
response = await checkout.POST(request);
check(response.status === 200 && createdOptions.line_items[0].price_data.unit_amount === 9900 && createdOptions.mode === 'payment', 'server ignores client price and locks USD 99 one-time purchase');
check(createdOptions.success_url.startsWith('https://www.himeera.com/payment') && createdOptions.cancel_url.startsWith('https://www.himeera.com/payment'), 'production checkout returns directly to the canonical domain');
check(!('payment_method_types' in createdOptions), 'Stripe can select eligible payment methods dynamically');
user = null;
response = await checkout.POST(request);
check(response.status === 401, 'unauthenticated checkout is rejected');
user = { id: 'another-user', email: 'other@example.test' };
response = await status.GET(new NextRequest('http://localhost/api/payment/stripe/status?session_id=cs_live_fixture', { headers: { Authorization: 'Bearer fixture' } }));
check(response.status === 404, 'another account cannot inspect checkout');

if (process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') || process.env.STRIPE_VERIFY_LIVE_CHECKOUT === '1') {
  const stripe = new RealStripe(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.create({ ...createdOptions, success_url: 'http://localhost:3098/payment?checkout_session_id={CHECKOUT_SESSION_ID}', cancel_url: 'http://localhost:3098/payment' });
  check(session.amount_total === 9900 && session.currency === 'usd' && session.mode === 'payment' && session.url?.startsWith('https://checkout.stripe.com/'), `real Stripe ${session.livemode ? 'live account' : 'sandbox'} accepts the USD 99 Checkout configuration`);
  await stripe.checkout.sessions.expire(session.id);
  check(true, 'checkout session expired after verification; no charge made');
}
console.log('Stripe payment verification complete');
