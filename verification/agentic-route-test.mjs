import { isAgentCandidate, requestAgentRoute, waitForAgent } from '../src/lib/agenticRoute.ts';

Deno.test('agent candidate gate preserves ordinary chat', () => {
  const cases = [
    ['Research the latest EV policies and compare sources', true],
    ['Find three dinner options in HSR and compare them', true],
    ['Book a table for two in HSR tonight', true],
    ['Plan lunch near HSR with sources', true],
    ['Find flights from Bengaluru to Mumbai next Friday', true],
    ['Compare flights to Delhi tomorrow', true],
    ['Order biryani on Swiggy to HSR', true],
    ['Find investors for Meera in India', true],
    ['Shortlist VC firms for our seed round', true],
    ['Search my conversations for the invoice', true],
    ['Search my emails for the invoice', false],
    ['Schedule a meeting tomorrow', false],
    ['I feel anxious', false],
    ['I had dinner and felt anxious', false],
    ['What is photosynthesis?', false],
  ];
  for (const [request, expected] of cases) {
    if (isAgentCandidate(request) !== expected) throw new Error(`Wrong route for: ${request}`);
  }
});

Deno.test('text clarification returns as an agent answer in the same chat flow', async () => {
  const originalFetch = globalThis.fetch;
  const operations = [];
  globalThis.fetch = async (_url, init) => {
    operations.push(init?.body ? JSON.parse(init.body).operation : 'status');
    return Response.json(init?.body
      ? { executionMode: 'agentic', taskId: 'task-1', conversationClass: 'personal' }
      : { task: { status: 'partial', result_text: 'Which city are you flying from?', current_step: null } });
  };
  try {
    const route = await requestAgentRoute({ supabaseUrl: 'https://example.test', anonKey: 'anon', accessToken: 'token', message: 'Find flights to Delhi', sessionId: 'session', userMessageId: 'user', assistantMessageId: 'assistant' });
    const result = await waitForAgent({ supabaseUrl: 'https://example.test', anonKey: 'anon', accessToken: 'token', taskId: route.taskId, onStatus: () => {} });
    if (result.result_text !== 'Which city are you flying from?' || operations.join(',') !== 'route,status') throw new Error('Clarification was not returned through the existing agent chat flow');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
