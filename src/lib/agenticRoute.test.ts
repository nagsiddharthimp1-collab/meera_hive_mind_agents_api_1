import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node's strip-types test runner requires the explicit TS extension.
import { isAgentCandidate } from './agenticRoute.ts';

test('routes explicit browser requests to the Agentic classifier', () => {
  const requests = [
    'Open openai.com and tell me the page title and main message.',
    'Visit GitHub\u2019s pricing page and explain the differences between Free, Team, and Enterprise.',
    'Use browser automation to inspect https://example.com/products.',
    'Navigate to the Stripe pricing page and compare the plans.',
    'fetch top selling men product on myntra',
    'Get top selling products on Myntra for men and order for me.',
    'Order me a trimmer from Amazon.',
    'Do agentic search best barber shop in HSR.',
    'Find the best salon near Koramangala and compare prices.',
    'Show my unread emails from today.',
    'Schedule a meeting with Arya tomorrow at 3 PM.',
    "What's on my calendar tomorrow?",
  ];

  for (const request of requests) {
    assert.equal(isAgentCandidate(request), true, request);
  }
});

test('keeps ordinary conversation out of the Agentic classifier', () => {
  const requests = [
    'What do you think about open source software?',
    'Tell me why pricing matters for a startup.',
    'I visited Kolkata last year.',
    'Rewrite my LinkedIn post about agentic email and calendar capabilities.',
    'Draft a LinkedIn post about Gmail and Calendar integrations.',
    'I am not able to receive or send mail, tell me what to do.',
  ];

  for (const request of requests) {
    assert.equal(isAgentCandidate(request), false, request);
  }
});
