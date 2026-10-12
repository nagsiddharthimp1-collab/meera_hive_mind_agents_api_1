import assert from 'node:assert/strict';
import { aggregateDashboard, matchesSegment } from '../src/lib/analyticsDashboardMetrics.ts';

const users = [
  { id: 'new-a', auth_id: 'auth-a', created_at: '2026-09-01T12:00:00Z' },
  { id: 'new-b', auth_id: 'auth-b', created_at: '2026-09-05T12:00:00Z' },
  { id: 'old', auth_id: 'auth-old', created_at: '2026-08-01T00:00:00Z' },
  { id: 'future', auth_id: 'auth-future', created_at: '2026-09-11T00:00:00Z' },
];
const messages = [
  { user_id: 'new-a', timestamp: '2026-09-01', content_type: 'user', count: 5 },
  { user_id: 'new-a', timestamp: '2026-09-02', content_type: 'user', count: 1 },
  { user_id: 'new-b', timestamp: '2026-09-05', content_type: 'user', count: 1 },
  { user_id: 'old', timestamp: '2026-09-03', content_type: 'user', count: 4 },
  { user_id: 'old', timestamp: '2026-08-31', content_type: 'user', count: 2 },
  { user_id: 'future', timestamp: '2026-09-11', content_type: 'user', count: 999 },
];
const input = {
  users,
  messages,
  payments: [
    { user_id: 'new-a', payment_date: '2026-09-02', amount: 219, payment_status: 'paid' },
    { user_id: 'old', payment_date: '2026-09-08', amount: 99, payment_status: 'success' },
    { user_id: 'old', payment_date: '2026-08-20', amount: 99, payment_status: 'paid' },
    { user_id: 'new-b', payment_date: '2026-09-12', amount: 219, payment_status: 'paid' },
  ],
  events: [{ user_id: 'auth-a', event_name: 'payment_page_opened', created_at: '2026-09-02' }],
  attributions: [{ auth_user_id: 'auth-a', link_id: 'l', attributed_at: '2026-09-01' }],
  links: [{ id: 'l', utm_source: 'newsletter' }],
  warnings: [],
};
const d = aggregateDashboard(input, '2026-09-01', '2026-09-10');
assert.equal(d.metrics.totalUsers.value, 3);
assert.equal(d.metrics.newUsers.value, 2);
assert.equal(d.metrics.activeUsers.value, 3);
assert.equal(d.metrics.returningUsers.value, 1);
assert.equal(d.metrics.messages.value, 11);
assert.equal(d.metrics.messages.previous, 2);
assert.equal(
  d.daily.reduce((s, p) => s + p.messages, 0),
  11,
);
assert.equal(d.metrics.activation.value, 1);
assert.equal(d.metrics.paidConversion.value, 0.5);
assert.equal(d.metrics.revenue.value, 318);
assert.deepEqual(
  d.funnel.map((f) => f.count),
  [
    2,
    2,
    1,
    1,
  ],
);
assert.equal(d.previousFrom, '2026-08-22');
assert.equal(d.previousTo, '2026-08-31');
assert.equal(d.paymentOpened, 1);
assert.equal(d.metrics.paymentOpened.value, 1);
assert.equal(d.metrics.newUserMessages.value, 3.5);
assert.equal(d.metrics.newUserMessages.previous, null);
const extraEvents = aggregateDashboard(
  {
    ...input,
    events: [
      ...input.events,
      { user_id: 'new-a', event_name: 'payment_page_opened', created_at: '2026-09-03' },
      { user_id: 'auth-old', event_name: 'payment_page_opened', created_at: '2026-09-04' },
      { user_id: 'old', event_name: 'payment_page_opened', created_at: '2026-08-30' },
    ],
  },
  '2026-09-01',
  '2026-09-10',
);
assert.equal(extraEvents.metrics.paymentOpened.value, 2);
assert.equal(extraEvents.metrics.paymentOpened.previous, 1);
assert.equal(extraEvents.paymentOpened, 1);
assert.equal(extraEvents.details.filter((u) => matchesSegment(u, 'opened')).length, 2);
const idleSignup = aggregateDashboard(
  { ...input, users: [...users, { id: 'idle', created_at: '2026-09-06' }] },
  '2026-09-01',
  '2026-09-10',
);
assert.equal(idleSignup.metrics.newUserMessages.value, 7 / 3);
const previousSignup = aggregateDashboard(
  {
    ...input,
    users: [...users, { id: 'prior', created_at: '2026-08-25' }],
    messages: [...messages, { user_id: 'prior', timestamp: '2026-08-26', content_type: 'user', count: 8 }],
  },
  '2026-09-01',
  '2026-09-10',
);
assert.equal(previousSignup.metrics.newUserMessages.previous, 8);
assert.equal(d.channels.find((c) => c.source === 'newsletter').activated, 1);
assert.equal(d.channels.find((c) => c.source === 'Unknown').users, 1);
assert.equal(d.retention[0].cells.find((c) => c.day === 1).rate, 0.5);
assert.equal(d.retention[0].cells.find((c) => c.day === 7).eligible, 1);
assert.equal(d.retention[0].cells.find((c) => c.day === 30).rate, null);
assert.equal(d.details.filter((u) => matchesSegment(u, 'repeat')).length, 1);
assert.equal(d.details.filter((u) => matchesSegment(u, 'returning')).length, 1);
assert.equal(d.details.filter((u) => matchesSegment(u, 'free')).length, 1);
const missing = aggregateDashboard({ ...input, messages: null, payments: null }, '2026-09-01', '2026-09-10');
assert.equal(missing.metrics.activeUsers.value, null);
assert.equal(missing.metrics.revenue.value, null);
assert.equal(missing.metrics.newUsers.value, 2);
assert.equal(missing.metrics.newUserMessages.value, null);
assert.equal(
  aggregateDashboard({ ...input, events: null }, '2026-09-01', '2026-09-10').metrics.paymentOpened.value,
  null,
);
const zero = aggregateDashboard({ ...input, messages: [], payments: [] }, '2026-09-01', '2026-09-10');
assert.equal(zero.metrics.activeUsers.value, 0);
assert.equal(zero.metrics.revenue.value, 0);
assert.equal(zero.messagesPerActive, null);
assert.equal(zero.metrics.activation.value, 0);
assert.equal(zero.metrics.newUserMessages.value, 0);
const long = aggregateDashboard(input, '2026-01-01', '2026-09-10');
assert.equal(long.bucketDays, 7);
assert.equal(
  long.daily.reduce((s, p) => s + p.messages, 0),
  13,
);
console.log(
  'PASS metric boundaries, comparison windows, weighted daily activity, cohorts, maturity, funnel nesting, identities, attribution, drilldowns, missing vs zero, and weekly bucketing',
);
