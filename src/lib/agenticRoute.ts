export type AgentStatus = {
  status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'partial' | 'failed' | 'cancelled';
  current_step?: string | null;
  result_text?: string | null;
  estimated_cost_usd?: number;
};

// A cheap local gate keeps ordinary conversation on the existing personal/work route.
// The agent model makes the final decision for candidate requests.
export function isAgentCandidate(message: string): boolean {
  const value = message.toLowerCase();
  const delegated = /\b(investigate|research|dig into|look into|compare sources|fact.check|verify sources|compare .{0,80}(quotes|vendors|plans|sources|options)|find and (summari[sz]e|compare|report)|search (my|our|the) (messages|conversations)|work through (the|this) steps)\b/i.test(value);
  const dining = /\b(find|plan|compare|shortlist|recommend|book|reserve|pick)\b.*\b(restaurants?|cafes?|places? to eat|dinner|lunch|brunch|breakfast|table for (?:two|three|four|[2-9]))\b/i.test(value);
  const flight = /\b(find|search|compare|plan|book|pick|choose|recommend)\b.*\b(flights?|airfare|airlines?|air tickets?)\b|\b(flights?|airfare|air tickets?)\b.*\b(from|to|for|between)\b/i.test(value);
  const food = /\b(order|deliver|delivery|find|compare|plan|pick)\b.*\b(food|swiggy|zomato|instamart|groceries|biryani|pizza|meal|dinner|lunch)\b|\b(swiggy|instamart)\b.*\b(order|find|cart|deliver)\b/i.test(value);
  const investors = /\b(find|research|shortlist|identify|compare|contact|reach out to|draft)\b.*\b(investors?|vc firms?|venture capital|angel investors?|funds?)\b|\b(investors?|vc firms?)\b.*\b(for|in|who|that)\b/i.test(value);
  // This is only a cheap candidate gate. The backend router still makes the
  // final agentic decision, so connector language should be intentionally
  // broad enough that natural requests such as "find my unread mails" reach it.
  const connector = /\b(gmail|inbox|e-?mails?|mails?|calendar|meetings?|schedule|availability|appointments?)\b/i.test(value)
    || /\b(?:am i|are we|do i have)\b.{0,60}\bfree\b/i.test(value);
  // Explicit website interaction belongs to Hermes even when the same request
  // could be approximated with search. This gate only decides whether to ask
  // the backend router; it does not itself grant browser access or actions.
  const explicitBrowser = /\b(?:use (?:the )?browser|browser automation|open|visit|navigate(?: to)?|browse|inspect|go to)\b/i.test(value)
    && (
      /\b(?:https?:\/\/|www\.)\S+/i.test(value)
      || /\b[a-z0-9][a-z0-9-]*(?:\.[a-z]{2,})(?:\/\S*)?\b/i.test(value)
      || /\b(?:website|webpage|site|page|pricing|catalog(?:ue)?|product listing)\b/i.test(value)
    );
  const commerceBrowser = /\b(?:fetch|find|compare|check|show|list)\b.{0,100}\b(?:products?|items?|prices?|fares?|tickets?|plans?)\b.{0,60}\b(?:on|from|at)\b\s+[a-z0-9][a-z0-9 .&'-]{1,40}$/i.test(value);
  return delegated || dining || flight || food || investors || connector || explicitBrowser || commerceBrowser;
}

export async function requestAgentRoute(args: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  message: string;
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  signal?: AbortSignal;
}): Promise<{ executionMode: 'answer' | 'agentic'; taskId?: string; conversationClass?: string }> {
  const body = JSON.stringify({ operation: 'route', message: args.message, sessionId: args.sessionId, userMessageId: args.userMessageId, assistantMessageId: args.assistantMessageId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${args.supabaseUrl}/functions/v1/agentic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: args.anonKey, Authorization: `Bearer ${args.accessToken}` },
        body,
        signal: args.signal,
      });
      if (!response.ok) throw new Error(`Agent routing failed: ${response.status}`);
      return response.json();
    } catch (error) {
      if (attempt === 1 || args.signal?.aborted || (error instanceof Error && /Agent routing failed: (4\d\d)/.test(error.message))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw new Error('Agent routing failed');
}

export async function waitForAgent(args: {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  taskId: string;
  signal?: AbortSignal;
  onStatus: (status: AgentStatus) => void;
}): Promise<AgentStatus> {
  const deadline = Date.now() + 300_000;
  let lastStep = '';
  let lastStatus: AgentStatus | null = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${args.supabaseUrl}/functions/v1/agentic?taskId=${encodeURIComponent(args.taskId)}`, {
      headers: { apikey: args.anonKey, Authorization: `Bearer ${args.accessToken}` },
      signal: args.signal,
    });
    if (!response.ok) throw new Error(`Agent status failed: ${response.status}`);
    const payload = await response.json() as { task: AgentStatus };
    const status = payload.task;
    lastStatus = status;
    const step = `${status.status}:${status.current_step || ''}`;
    if (step !== lastStep) {
      args.onStatus(status);
      lastStep = step;
    }
    if (['awaiting_approval', 'completed', 'partial', 'failed', 'cancelled'].includes(status.status)) return status;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1400);
      args.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(args.signal?.reason || new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }
  if (lastStatus) return lastStatus;
  throw new Error('Agent status was unavailable. Reopen this conversation to see the result.');
}
