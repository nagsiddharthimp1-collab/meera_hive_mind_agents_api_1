import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node's strip-types test runner requires the explicit TS extension.
import {
  AgentRouteError,
  getAgentRouteErrorStatus,
  getAgentRouteUserMessage,
  isAgentCandidate,
  isContextualAgentCandidate,
  requestAgentRoute,
} from './agenticRoute.ts';

test('routes explicit browser requests to the Agentic classifier', () => {
  const requests = [
    'Open openai.com and tell me the page title and main message.',
    'Visit GitHub\u2019s pricing page and explain the differences between Free, Team, and Enterprise.',
    'Use browser automation to inspect https://example.com/products.',
    'Navigate to the Stripe pricing page and compare the plans.',
    'fetch top selling men product on myntra',
    'Get top selling products on Myntra for men and order for me.',
    'Order me a trimmer from Amazon.',
    'Get me the cheapest trimmer on Amazon for HSR.',
    'Do agentic search best barber shop in HSR.',
    'Find the best salon near Koramangala and compare prices.',
    'Find me a nice salon for curly hair in HSR.',
    'Find me the best hostel in Hampi.',
    'Find me something nice to eat on Swiggy for HSR and order it.',
    'find me a cheap flight to goa from bangalore in december',
    'find me nice cafe near 27th main HSR',
    'find me active investors in AI space that invested this month',
    'Show my unread emails from today.',
    'check my latest emails',
    'track the jayanths email and tell',
    'Has Jayanth replied yet?',
    'Schedule a meeting with Arya tomorrow at 3 PM.',
    "What's on my calendar tomorrow?",
    "dude check is meera.me domain available and what's the cost",
    "check another domain that works and is cheap",
    "tell me difference between 5.6 Sol & 6 Sol",
    "GPT Sol dude",
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
    'Tell me about AI economics and how big the bubble is.',
    'Kumarila Bhatta - tell me more about his philosophy.',
  ];

  for (const request of requests) {
    assert.equal(isAgentCandidate(request), false, request);
  }
});

test('recognizes contextual agent continuations', () => {
  for (const request of [
    'reply this Nirwan guy that applications are closed',
    'reschedule it to next Tuesday',
    'buy that personal one',
    'something healthy and homely',
    'check the net and tell',
  ]) assert.equal(isContextualAgentCandidate(request), true, request);
  assert.equal(isContextualAgentCandidate('Tell me about Buddhist philosophy'), false);
});

test('surfaces an authentication failure so the caller can refresh once', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  };

  try {
    await assert.rejects(
      requestAgentRoute({
        supabaseUrl: 'https://example.supabase.co',
        anonKey: 'anon',
        accessToken: 'expired',
        message: 'Find me a hostel in Hampi',
        sessionId: 'session',
        userMessageId: crypto.randomUUID(),
        assistantMessageId: crypto.randomUUID(),
      }),
      (error: unknown) => getAgentRouteErrorStatus(error) === 401,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retries a transient agent endpoint failure', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ error: 'Temporary failure' }), { status: 503 });
    return new Response(JSON.stringify({ executionMode: 'agentic', taskId: 'task-1' }), { status: 200 });
  };

  try {
    const result = await requestAgentRoute({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon',
      accessToken: 'valid',
      message: 'Find me a hostel in Hampi',
      sessionId: 'session',
      userMessageId: crypto.randomUUID(),
      assistantMessageId: crypto.randomUUID(),
    });
    assert.equal(result.executionMode, 'agentic');
    assert.equal(result.taskId, 'task-1');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('turns route failures into durable user-facing messages', () => {
  assert.equal(
    getAgentRouteUserMessage(new AgentRouteError('Agent routing failed: 429', 429)),
    "I reached today's agent-task limit. Please try again later.",
  );
  assert.equal(
    getAgentRouteUserMessage(new AgentRouteError('Agent routing failed', 503)),
    'I could not reach the agent service. Please retry.',
  );
});
