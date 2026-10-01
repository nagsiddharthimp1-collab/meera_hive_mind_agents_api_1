export type AgentStatus = {
  status: 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'partial' | 'failed' | 'cancelled';
  current_step?: string | null;
  result_text?: string | null;
  estimated_cost_usd?: number;
};

export class AgentRouteError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AgentRouteError';
    this.status = status;
  }
}

export function getAgentRouteErrorStatus(error: unknown): number | undefined {
  return error instanceof AgentRouteError ? error.status : undefined;
}

export function getAgentRouteUserMessage(error: unknown): string {
  const status = getAgentRouteErrorStatus(error);
  if (status === 401) return 'Your session expired. Please sign in again, then retry.';
  if (status === 409) return 'I am already handling another task. Let it finish or stop it, then retry.';
  if (status === 429) return 'I reached today\'s agent-task limit. Please try again later.';
  return 'I could not reach the agent service. Please retry.';
}

// A cheap local gate keeps ordinary conversation on the existing personal/work route.
// The agent model makes the final decision for candidate requests.
export function isAgentCandidate(message: string): boolean {
  const value = message.toLowerCase().replace(/\s+/g, ' ').trim();
  const explicitAgent = /\b(?:do|run|start|use|perform|handle|try)\s+(?:an?\s+)?agentic\s+(?:search|research|task|workflow|run)\b|\bagentic\s+(?:search|research|task|workflow|run)\b/i.test(value);
  const delegated = /\b(investigate|research|dig into|look into|compare sources|fact.check|verify sources|compare .{0,80}(quotes|vendors|plans|sources|options)|find and (summari[sz]e|compare|report)|search (my|our|the) (messages|conversations)|work through (the|this) steps)\b/i.test(value);
  // Natural delegation should reach the backend classifier even when the
  // requested noun is new. The backend remains the final authority on whether
  // this is an agent task or an ordinary answer.
  const naturalDelegation = /\b(?:find|get|search|show|recommend|shortlist|pick|choose|compare|book|reserve|order|buy)\s+(?:me|my|us|our|the|a|an|some(?:thing)?)\b/i.test(value);
  const dining = /\b(find|plan|compare|shortlist|recommend|book|reserve|pick)\b.*\b(restaurants?|cafes?|places? to eat|dinner|lunch|brunch|breakfast|table for (?:two|three|four|[2-9]))\b/i.test(value);
  const flight = /\b(find|search|compare|plan|book|pick|choose|recommend)\b.*\b(flights?|airfare|airlines?|air tickets?)\b|\b(flights?|airfare|air tickets?)\b.*\b(from|to|for|between)\b/i.test(value);
  const food = /\b(order|deliver|delivery|find|compare|plan|pick)\b.*\b(food|swiggy|zomato|instamart|groceries|biryani|pizza|meal|dinner|lunch)\b|\b(swiggy|instamart)\b.*\b(order|find|cart|deliver)\b/i.test(value);
  const investors = /\b(find|research|shortlist|identify|compare|contact|reach out to|draft)\b.*\b(investors?|vc firms?|venture capital|angel investors?|funds?)\b|\b(investors?|vc firms?)\b.*\b(for|in|who|that)\b/i.test(value);
  // This is only a cheap candidate gate. The backend router still makes the
  // final agentic decision, so connector language should be intentionally
  // broad enough that natural requests such as "find my unread mails" reach it.
  const connectorSupportQuestion = /\b(?:can(?:not|'t)|unable|not able|problem|issue|trouble)\b.{0,90}\b(?:send|receive|gmail|mail|e-?mail)\b/i.test(value);
  const connectorCapabilityCopy = /\b(?:write|rewrite|edit|polish|improve|draft)\b.{0,90}\b(?:post|article|bio|description|copy|caption|announcement|website|linkedin)\b/i.test(value);
  const connectorRead = /\b(?:show|list|find|search|read|check|summari[sz]e|triage|get|look (?:at|through))\b.{0,120}\b(?:my\s+)?(?:gmail|inbox|e-?mails?|mails?|calendar|meetings?|schedule|availability|appointments?)\b/i.test(value)
    || /\b(?:track|monitor|follow(?:\s+up\s+on)?)\b.{0,140}\b(?:gmail|inbox|e-?mails?|mails?|replies?|threads?)\b/i.test(value)
    || /\b(?:has|did)\b.{0,100}\b(?:repl(?:y|ied)|respond(?:ed)?)\b/i.test(value)
    || /\b(?:unread|recent|latest|today(?:'s)?)\s+(?:e-?mails?|mails?|meetings?|appointments?)\b/i.test(value)
    || /\bwhat(?:'s| is)\b.{0,80}\b(?:on\s+)?my\s+(?:calendar|schedule|inbox)\b/i.test(value)
    || /\b(?:am i|are we|do i have)\b.{0,60}\b(?:free|available|meeting|appointment)\b/i.test(value);
  const connectorWrite = /\b(?:send|reply|forward|compose|draft|write|prepare)\b.{0,160}\b(?:e-?mail|gmail|mail|message)\b|\b(?:create|add|book|schedule|reschedule|move|update|edit|cancel|delete)\b.{0,140}\b(?:calendar|event|meeting|appointment)\b/i.test(value)
    || /\b(?:e-?mail|gmail|mail)\b.{0,100}\b(?:to|reply|forward)\b/i.test(value);
  const connector = !connectorSupportQuestion && !connectorCapabilityCopy && (connectorRead || connectorWrite);
  // Explicit website interaction belongs to Hermes even when the same request
  // could be approximated with search. This gate only decides whether to ask
  // the backend router; it does not itself grant browser access or actions.
  const explicitBrowser = /\b(?:use (?:the )?browser|browser automation|open|visit|navigate(?: to)?|browse|inspect|go to)\b/i.test(value)
    && (
      /\b(?:https?:\/\/|www\.)\S+/i.test(value)
      || /\b[a-z0-9][a-z0-9-]*(?:\.[a-z]{2,})(?:\/\S*)?\b/i.test(value)
      || /\b(?:website|webpage|site|page|pricing|catalog(?:ue)?|product listing)\b/i.test(value)
    );
  const commerceBrowser = /\b(?:shop|buy|order|purchase|find|get|fetch|search|compare|recommend|shortlist|pick|choose|show|list)\b.{0,160}\b(?:products?|items?|prices?|deals?|offers?|trimmers?|phones?|laptops?|shoes?|clothes?|fashion|electronics?|amazon|flipkart|myntra|meesho|ajio)\b/i.test(value)
    || /\b(?:amazon|flipkart|myntra|meesho|ajio)\b.{0,140}\b(?:product|item|price|deal|buy|order|compare|recommend|shortlist)\b/i.test(value);
  const localService = /\b(?:find|get|search|compare|recommend|shortlist|pick|choose|book)\b.{0,140}\b(?:barbers?|barber\s+shops?|salons?|spas?|clinics?|dentists?|doctors?|vets?|gyms?|mechanics?|plumbers?|electricians?|cleaners?|hostels?|hotels?|resorts?|homestays?|airbnbs?|coworking\s+spaces?)\b/i.test(value);
  return explicitAgent || delegated || naturalDelegation || dining || flight || food || investors || connector || explicitBrowser || commerceBrowser || localService;
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
      const raw = await response.text();
      if (!response.ok) {
        let detail = '';
        try {
          const payload = JSON.parse(raw) as { error?: unknown };
          detail = typeof payload.error === 'string' ? payload.error.trim().slice(0, 160) : '';
        } catch {
          detail = raw.trim().slice(0, 160);
        }
        throw new AgentRouteError(
          `Agent routing failed: ${response.status}${detail ? ` (${detail})` : ''}`,
          response.status,
        );
      }
      return JSON.parse(raw) as { executionMode: 'answer' | 'agentic'; taskId?: string; conversationClass?: string };
    } catch (error) {
      const status = getAgentRouteErrorStatus(error);
      if (attempt === 1 || args.signal?.aborted || (status !== undefined && status < 500)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw new AgentRouteError('Agent routing failed');
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
