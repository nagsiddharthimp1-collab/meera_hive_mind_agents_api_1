import assert from 'node:assert/strict';
const base = process.env.NEXT_PUBLIC_BACKEND_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!base || !key) throw new Error('Public backend configuration required');
for (const [body, expected] of [
  [{ plan_type: 'monthly', amount: 129 }, 'Only lifetime access'],
  [{ plan_type: 'lifetime', amount: 1 }, 'INR 499'],
  [{ plan_type: 'lifetime', amount: 499, order_currency: 'USD' }, 'INR only'],
]) {
  const response = await fetch(`${base}/payment`, { method: 'POST', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key,
  }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, 400, `Expected rejection for ${JSON.stringify(body)}`);
  assert.ok(String(result.error).includes(expected));
  console.log('PASS production Cashfree validation:', expected);
}
console.log('All malformed purchase requests rejected before order creation; no charge made');
