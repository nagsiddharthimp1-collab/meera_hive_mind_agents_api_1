import { supabase } from '@/lib/supabaseClient';

const STORAGE_KEY = 'meera:google-agent-connect';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
];

export async function startGoogleAgentConnection(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sign in before connecting Google.');
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    ownerId: user.id,
    startedAt: Date.now(),
    returnTo: `${window.location.pathname}${window.location.search}`,
  }));
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: SCOPES.join(' '),
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
  if (error) {
    sessionStorage.removeItem(STORAGE_KEY);
    throw error;
  }
}

export async function finishGoogleAgentConnection(): Promise<string | null> {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(STORAGE_KEY);
  const pending = JSON.parse(raw) as { ownerId: string; startedAt: number; returnTo?: string };
  if (Date.now() - pending.startedAt > 10 * 60_000) throw new Error('Google connection expired. Please try again.');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || session.user.id !== pending.ownerId) throw new Error('Connect the same Google account used for Meera.');
  const { data, error } = await supabase.functions.invoke('agentic', {
    body: {
      operation: 'connect_google',
      providerToken: session.provider_token,
      providerRefreshToken: session.provider_refresh_token,
    },
  });
  if (error || !data?.connected) throw new Error(data?.error || error?.message || 'Could not connect Google.');
  return pending.returnTo?.startsWith('/') && !pending.returnTo.startsWith('//')
    ? pending.returnTo
    : '/';
}
