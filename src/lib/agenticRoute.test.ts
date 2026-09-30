import assert from 'node:assert/strict';
import test from 'node:test';
import { isAgentCandidate } from './agenticRoute.ts';

test('routes explicit browser requests to the Agentic classifier', () => {
  const requests = [
    'Open openai.com and tell me the page title and main message.',
    'Visit GitHub\u2019s pricing page and explain the differences between Free, Team, and Enterprise.',
    'Use browser automation to inspect https://example.com/products.',
    'Navigate to the Stripe pricing page and compare the plans.',
    'fetch top selling men product on myntra',
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
  ];

  for (const request of requests) {
    assert.equal(isAgentCandidate(request), false, request);
  }
});
