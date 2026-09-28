'use client';

import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

type FunnelStageKey = 'signups' | 'payment_page_opened' | 'paid' | 'active';

type FunnelResponse = {
  generated_at: string;
  window: {
    from: string;
    to: string;
  };
  summary: {
    signups: number;
    payment_page_opened: number;
    paid: number;
    active: number;
    conv_signup_to_payment_opened: number;
    conv_payment_opened_to_paid: number;
    conv_paid_to_active: number;
    conv_signup_to_active: number;
  };
  notes: string[];
};

type FunnelUserRow = {
  user_id: string;
  email: string | null;
  name: string | null;
  signup_at: string | null;
  source_channel: string;
  campaign: string | null;
  country: string | null;
  payment_opened: boolean;
  paid: boolean;
  active: boolean;
  payment_status: string | null;
  plan_type: 'monthly' | 'lifetime' | null;
  amount: number | null;
  last_payment_at: string | null;
  message_count: number;
  last_active_at: string | null;
};

type FunnelUsersResponse = {
  generated_at: string;
  window: {
    from: string;
    to: string;
    from_iso: string;
    to_exclusive_iso: string;
  };
  stage: {
    key: FunnelStageKey;
    label: string;
    user_count: number;
    users_returned: number;
    truncated: boolean;
    truncate_limit: number;
  };
  summary: FunnelResponse['summary'];
  source_breakdown: Array<{
    source: string;
    count: number;
  }>;
  users: FunnelUserRow[];
  notes: string[];
};

type AccessProfile = {
  email: string;
  role: string;
  permissions: string[];
};

type ConversationResponse = {
  access_mode: 'full' | 'redacted';
  user: { id: string; email: string | null; name: string | null; created_at: string | null };
  messages: Array<{
    message_id: string;
    content_type: string;
    content: string;
    timestamp: string;
    session_id: string | null;
    model: string | null;
    message_type: string | null;
    is_call: boolean | null;
  }>;
  truncated: boolean;
};

type AccessMember = {
  email: string;
  role: 'owner' | 'product_growth' | 'analyst' | 'support';
  enabled: boolean;
  permissions: string[];
};

type RangeKey = '1h' | '1d' | '1w' | '1m' | '1y';

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; daysBack: number }> = [
  { key: '1h', label: '1 Hour', daysBack: 0 },
  { key: '1d', label: '1 Day', daysBack: 1 },
  { key: '1w', label: '1 Week', daysBack: 7 },
  { key: '1m', label: '1 Month', daysBack: 30 },
  { key: '1y', label: '1 Year', daysBack: 365 },
];

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatInt(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAmount(value: number | null): string {
  if (value === null) return '—';
  return formatInt(value);
}

function stageFlag(isTrue: boolean): string {
  return isTrue ? 'Yes' : 'No';
}

export default function AnalyticsPage() {
  const [from, setFrom] = useState<string>(dateDaysAgo(30));
  const [to, setTo] = useState<string>(todayDateString());
  const [selectedRange, setSelectedRange] = useState<RangeKey>('1m');
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState<boolean>(false);
  const [accessToken, setAccessToken] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [accessProfile, setAccessProfile] = useState<AccessProfile | null>(null);
  const [accessLoading, setAccessLoading] = useState<boolean>(true);
  const [accessError, setAccessError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [data, setData] = useState<FunnelResponse | null>(null);
  const [selectedStage, setSelectedStage] = useState<FunnelStageKey | null>(null);
  const [stageLoading, setStageLoading] = useState<boolean>(false);
  const [stageError, setStageError] = useState<string>('');
  const [stageData, setStageData] = useState<FunnelUsersResponse | null>(null);
  const [stageSearch, setStageSearch] = useState<string>('');
  const [conversationUser, setConversationUser] = useState<FunnelUserRow | null>(null);
  const [conversationReason, setConversationReason] = useState<string>('Product and growth review');
  const [conversationData, setConversationData] = useState<ConversationResponse | null>(null);
  const [conversationLoading, setConversationLoading] = useState<boolean>(false);
  const [conversationError, setConversationError] = useState<string>('');
  const [accessMembers, setAccessMembers] = useState<AccessMember[]>([]);
  const [memberEmail, setMemberEmail] = useState<string>('');
  const [memberRole, setMemberRole] = useState<AccessMember['role']>('product_growth');
  const [memberSaving, setMemberSaving] = useState<boolean>(false);
  const [memberStatus, setMemberStatus] = useState<string>('');
  const rangeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadSession = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!mounted) return;
      const token = sessionData.session?.access_token ?? '';
      const userEmail = sessionData.session?.user?.email ?? '';
      setAccessToken(token);
      setEmail(userEmail);
    };

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setAccessToken(session?.access_token ?? '');
      setEmail(session?.user?.email ?? '');
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setAccessProfile(null);
      setAccessLoading(false);
      return;
    }

    let canceled = false;
    const loadAccess = async () => {
      setAccessLoading(true);
      setAccessError('');
      const response = await fetch('/api/analytics/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => null)) as (AccessProfile & { error?: string }) | null;
      if (canceled) return;
      if (!response.ok || !body) {
        setAccessProfile(null);
        setAccessError(body?.error ?? 'Analytics access is not enabled for this account.');
      } else {
        setAccessProfile(body);
      }
      setAccessLoading(false);
    };

    void loadAccess();
    return () => {
      canceled = true;
    };
  }, [accessToken]);

  const isAuthorizedViewer = accessProfile?.permissions.includes('analytics.view') === true;
  const canViewConversations = accessProfile?.permissions.includes('conversations.view_metadata') === true;
  const canManageAccess = accessProfile?.permissions.includes('access.manage') === true;

  const selectedRangeOption = useMemo(
    () => RANGE_OPTIONS.find((option) => option.key === selectedRange) ?? RANGE_OPTIONS[3],
    [selectedRange],
  );

  useEffect(() => {
    if (!isRangeMenuOpen) return;

    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rangeMenuRef.current?.contains(target)) return;
      setIsRangeMenuOpen(false);
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsRangeMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [isRangeMenuOpen]);

  const applyRange = (nextRange: RangeKey) => {
    const option = RANGE_OPTIONS.find((item) => item.key === nextRange);
    if (!option) return;

    const nextTo = todayDateString();
    const nextFrom = option.daysBack === 0 ? nextTo : dateDaysAgo(option.daysBack);

    setSelectedRange(nextRange);
    setFrom(nextFrom);
    setTo(nextTo);
    setIsRangeMenuOpen(false);
  };

  useEffect(() => {
    if (!accessToken || !isAuthorizedViewer) {
      setLoading(false);
      return;
    }

    let canceled = false;
    const controller = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams({ from, to });
        const response = await fetch(`/api/analytics/funnel?${params.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Request failed (${response.status})`);
        }

        const payload = (await response.json()) as FunnelResponse;
        if (!canceled) {
          setData(payload);
        }
      } catch (err) {
        if (!canceled) {
          setError(err instanceof Error ? err.message : String(err));
          setData(null);
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    void fetchData();

    return () => {
      canceled = true;
      controller.abort();
    };
  }, [accessToken, from, isAuthorizedViewer, to]);

  useEffect(() => {
    if (!selectedStage || !accessToken || !isAuthorizedViewer) {
      setStageLoading(false);
      setStageError('');
      setStageData(null);
      return;
    }

    let canceled = false;
    const controller = new AbortController();

    const fetchStageUsers = async () => {
      setStageLoading(true);
      setStageError('');

      try {
        const params = new URLSearchParams({ from, to, stage: selectedStage });
        const response = await fetch(`/api/analytics/funnel-users?${params.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Request failed (${response.status})`);
        }

        const payload = (await response.json()) as FunnelUsersResponse;
        if (!canceled) {
          setStageData(payload);
        }
      } catch (err) {
        if (!canceled) {
          setStageError(err instanceof Error ? err.message : String(err));
          setStageData(null);
        }
      } finally {
        if (!canceled) {
          setStageLoading(false);
        }
      }
    };

    void fetchStageUsers();

    return () => {
      canceled = true;
      controller.abort();
    };
  }, [accessToken, from, isAuthorizedViewer, selectedStage, to]);

  const filteredStageUsers = useMemo(() => {
    if (!stageData) return [] as FunnelUserRow[];
    const query = stageSearch.trim().toLowerCase();
    if (!query) return stageData.users;

    return stageData.users.filter((user) => {
      const searchable = [
        user.user_id,
        user.email ?? '',
        user.name ?? '',
        user.source_channel,
        user.campaign ?? '',
        user.country ?? '',
        user.payment_status ?? '',
        user.plan_type ?? '',
        String(user.message_count),
        user.last_active_at ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [stageData, stageSearch]);

  useEffect(() => {
    if (!accessToken || !canManageAccess) return;
    let canceled = false;
    const loadMembers = async () => {
      const response = await fetch('/api/analytics/access', {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => null)) as { members?: AccessMember[] } | null;
      if (!canceled && response.ok) setAccessMembers(body?.members ?? []);
    };
    void loadMembers();
    return () => {
      canceled = true;
    };
  }, [accessToken, canManageAccess]);

  const openConversations = (user: FunnelUserRow) => {
    setConversationUser(user);
    setConversationData(null);
    setConversationError('');
  };

  const loadConversations = async () => {
    if (!conversationUser || !accessToken) return;
    setConversationLoading(true);
    setConversationError('');
    try {
      const params = new URLSearchParams({ userId: conversationUser.user_id, reason: conversationReason.trim() });
      const response = await fetch(`/api/analytics/conversations?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const body = (await response.json().catch(() => null)) as (ConversationResponse & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error ?? 'Unable to load conversations.');
      setConversationData(body);
    } catch (err) {
      setConversationData(null);
      setConversationError(err instanceof Error ? err.message : String(err));
    } finally {
      setConversationLoading(false);
    }
  };

  const updateMemberAccess = async (targetEmail: string, targetRole: AccessMember['role'], enabled: boolean) => {
    if (!accessToken) return;
    setMemberSaving(true);
    setMemberStatus('');
    try {
      const response = await fetch('/api/analytics/access', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, role: targetRole, enabled }),
      });
      const body = (await response.json().catch(() => null)) as (AccessMember & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error ?? 'Unable to update access.');
      setAccessMembers((current) => [...current.filter((item) => item.email !== body.email), body].sort((a, b) => a.email.localeCompare(b.email)));
      if (targetEmail === memberEmail) setMemberEmail('');
      setMemberStatus(`${body.enabled ? 'Access saved' : 'Access disabled'} for ${body.email}.`);
    } catch (err) {
      setMemberStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setMemberSaving(false);
    }
  };

  if (!accessToken) {
    return (
      <main className="min-h-[100dvh] bg-background text-primary px-6 py-10">
        <div className="max-w-3xl mx-auto bg-card rounded-3xl p-8 border border-primary/10">
          <h1 className="text-3xl font-semibold tracking-tight">Meera Analytics</h1>
          <p className="mt-3 text-primary/70">Please sign in to view analytics.</p>
          <Link
            href="/sign-in"
            className="inline-flex mt-6 rounded-xl bg-primary text-background px-4 py-2 font-medium"
          >
            Go to Sign In
          </Link>
        </div>
      </main>
    );
  }

  if (accessLoading) {
    return (
      <main className="min-h-[100dvh] bg-background text-primary px-6 py-10">
        <div className="max-w-3xl mx-auto bg-card rounded-3xl p-8 border border-primary/10">
          <h1 className="text-3xl font-semibold tracking-tight">Meera Analytics</h1>
          <p className="mt-3 text-primary/70">Checking your analytics permissions…</p>
        </div>
      </main>
    );
  }

  if (!isAuthorizedViewer) {
    return (
      <main className="min-h-[100dvh] bg-background text-primary px-6 py-10">
        <div className="max-w-3xl mx-auto bg-card rounded-3xl p-8 border border-primary/10">
          <h1 className="text-3xl font-semibold tracking-tight">Meera Analytics</h1>
          <p className="mt-3 text-primary/70">{accessError || `Access is not enabled for ${email}.`}</p>
        </div>
      </main>
    );
  }

  const signups = data?.summary.signups ?? 0;
  const paymentOpened = data?.summary.payment_page_opened ?? 0;
  const paid = data?.summary.paid ?? 0;
  const active = data?.summary.active ?? 0;

  const stageCards: Array<{ key: FunnelStageKey; label: string; value: number }> = [
    { key: 'signups', label: 'Signups', value: signups },
    { key: 'payment_page_opened', label: 'Payment Opened', value: paymentOpened },
    { key: 'paid', label: 'Paid', value: paid },
    { key: 'active', label: 'WAU', value: active },
  ];

  const maxStep = Math.max(signups, paymentOpened, paid, active, 1);

  const funnelSteps: Array<{
    key: FunnelStageKey;
    label: string;
    value: number;
    conversionLabel: string;
    conversionValue: number | null;
  }> = [
    {
      key: 'signups',
      label: 'Signups',
      value: signups,
      conversionLabel: 'Base',
      conversionValue: 1,
    },
    {
      key: 'payment_page_opened',
      label: 'Payment Page Opened',
      value: paymentOpened,
      conversionLabel: 'Signup → Opened',
      conversionValue: data?.summary.conv_signup_to_payment_opened ?? 0,
    },
    {
      key: 'paid',
      label: 'Paid',
      value: paid,
      conversionLabel: 'Opened → Paid',
      conversionValue: data?.summary.conv_payment_opened_to_paid ?? 0,
    },
    {
      key: 'active',
      label: 'WAU',
      value: active,
      conversionLabel: 'Selected Window',
      conversionValue: null,
    },
  ];

  const topSourceBreakdown = stageData?.source_breakdown.slice(0, 8) ?? [];

  return (
    <main className="min-h-[100dvh] bg-background text-primary px-5 py-8 sm:px-8 sm:py-10">
      <div className="max-w-6xl mx-auto">
        <div className="bg-card border border-primary/10 rounded-3xl p-5 sm:p-7">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-primary/60">himeera.com/analytics</p>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-2">
                Signups → Payment Opened → Paid → WAU
              </h1>
              <p className="mt-2 text-sm text-primary/70">
                Cohort funnel with weekly active users for the selected window.
              </p>
            </div>

            <div className="flex flex-col items-start md:items-end gap-2">
              <div className="relative" ref={rangeMenuRef}>
                <button
                  type="button"
                  className="min-w-[150px] rounded-2xl border border-white/15 bg-[#090d15] px-4 py-2.5 text-left text-sm text-white shadow-[0_1px_0_rgba(255,255,255,0.05)_inset] transition hover:border-white/30"
                  onClick={() => setIsRangeMenuOpen((open) => !open)}
                  aria-haspopup="listbox"
                  aria-expanded={isRangeMenuOpen}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span>{selectedRangeOption.label}</span>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className={`transition ${isRangeMenuOpen ? 'rotate-180' : ''}`}
                    >
                      <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </span>
                </button>

                {isRangeMenuOpen && (
                  <div className="absolute right-0 z-30 mt-2 w-[170px] rounded-2xl border border-white/15 bg-[#060a12] p-1.5 shadow-[0_16px_38px_rgba(0,0,0,0.55)]">
                    {RANGE_OPTIONS.map((option) => {
                      const isSelected = option.key === selectedRange;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition ${
                            isSelected ? 'bg-white/12 text-white' : 'text-white/80 hover:bg-white/8 hover:text-white'
                          }`}
                          onClick={() => applyRange(option.key)}
                        >
                          <span>{option.label}</span>
                          {isSelected && (
                            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path
                                d="M4.5 10.2L8.3 13.7L15.5 6.3"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <p className="text-xs text-primary/60">
                Window: {from} to {to}
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {stageCards.map((card) => {
              const isSelected = selectedStage === card.key;
              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => {
                    setSelectedStage(card.key);
                    setStageSearch('');
                  }}
                  className={`rounded-2xl border bg-background p-4 text-left transition ${
                    isSelected
                      ? 'border-primary/60 shadow-[0_0_0_1px_rgba(15,73,49,0.35)_inset]'
                      : 'border-primary/15 hover:border-primary/30'
                  }`}
                >
                  <p className="text-xs text-primary/70 uppercase tracking-[0.16em]">{card.label}</p>
                  <p className="text-3xl font-semibold mt-2">{formatInt(card.value)}</p>
                  <p className="mt-2 text-xs text-primary/65">
                    {isSelected ? 'Selected for user details' : 'Click to view users and source'}
                  </p>
                </button>
              );
            })}
          </div>

          {canManageAccess && (
            <div className="mt-6 rounded-2xl border border-primary/15 bg-background p-4 sm:p-5">
              <div>
                <h2 className="text-lg font-semibold">Team Access</h2>
                <p className="mt-1 text-sm text-primary/70">
                  Grant named access. Product &amp; Growth can review full chats; Support receives redacted chat access.
                </p>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto]">
                <input
                  type="email"
                  value={memberEmail}
                  onChange={(event) => setMemberEmail(event.target.value)}
                  placeholder="teammate@himeera.com"
                  className="rounded-xl border border-primary/20 bg-white/50 px-3 py-2 text-sm focus:border-primary/45 focus:outline-none"
                />
                <select
                  value={memberRole}
                  onChange={(event) => setMemberRole(event.target.value as AccessMember['role'])}
                  className="rounded-xl border border-primary/20 bg-white/50 px-3 py-2 text-sm focus:border-primary/45 focus:outline-none"
                >
                  <option value="product_growth">Product &amp; Growth</option>
                  <option value="analyst">Analyst</option>
                  <option value="support">Support</option>
                  <option value="owner">Owner</option>
                </select>
                <button
                  type="button"
                  disabled={memberSaving || !memberEmail.trim()}
                  onClick={() => void updateMemberAccess(memberEmail, memberRole, true)}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {memberSaving ? 'Saving…' : 'Grant access'}
                </button>
              </div>
              {memberStatus && <p className="mt-2 text-sm text-primary/70">{memberStatus}</p>}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {accessMembers.map((member) => (
                  <div key={member.email} className="rounded-xl border border-primary/12 bg-white/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{member.email}</p>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-primary/8 px-2 py-1 text-xs">{member.role.replace(/_/g, ' ')}</span>
                        {member.email !== accessProfile?.email && (
                          <button
                            type="button"
                            disabled={memberSaving}
                            onClick={() => void updateMemberAccess(member.email, member.role, !member.enabled)}
                            className="rounded-lg border border-primary/15 px-2 py-1 text-xs disabled:opacity-50"
                          >
                            {member.enabled ? 'Disable' : 'Enable'}
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-primary/60">
                      {member.enabled ? 'Enabled' : 'Disabled'} · {member.permissions.length} permissions
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-primary/15 bg-background p-4 sm:p-5">
            <h2 className="text-lg font-semibold">Funnel Breakdown</h2>
            {loading && <p className="mt-4 text-primary/70">Loading analytics…</p>}
            {error && <p className="mt-4 text-red-700">{error}</p>}

            {!loading && !error && (
              <div className="mt-4 space-y-4">
                {funnelSteps.map((step) => {
                  const widthPct = Math.max(6, Math.round((step.value / maxStep) * 100));
                  const isSelected = selectedStage === step.key;
                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => {
                        setSelectedStage(step.key);
                        setStageSearch('');
                      }}
                      className={`w-full rounded-xl p-2 text-left transition ${
                        isSelected ? 'bg-primary/5' : 'hover:bg-primary/5'
                      }`}
                    >
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div>
                          <p className="font-medium">{step.label}</p>
                          <p className="text-xs text-primary/65">{step.conversionLabel}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{formatInt(step.value)}</p>
                          <p className="text-xs text-primary/65">
                            {step.conversionValue === null ? 'WAU' : formatPct(step.conversionValue)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 h-3 rounded-full bg-primary/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${widthPct}%`, transition: 'width 360ms ease' }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-primary/15 bg-background p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Stage Users Drilldown</h2>
                <p className="mt-1 text-sm text-primary/70">
                  Click any stage above to view users, source attribution, and payment status details.
                </p>
              </div>
              {selectedStage && (
                <button
                  type="button"
                  className="rounded-xl border border-primary/20 px-3 py-1.5 text-sm text-primary/80 hover:border-primary/35"
                  onClick={() => {
                    setSelectedStage(null);
                    setStageData(null);
                    setStageSearch('');
                    setStageError('');
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {!selectedStage && (
              <p className="mt-4 rounded-xl border border-dashed border-primary/20 px-4 py-3 text-sm text-primary/70">
                Select `Signups`, `Payment Opened`, `Paid`, or `WAU` to open the full user list.
              </p>
            )}

            {selectedStage && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded-xl border border-primary/12 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-primary/65">Stage</p>
                    <p className="mt-1 font-semibold">{stageData?.stage.label ?? selectedStage.replace(/_/g, ' ')}</p>
                  </div>
                  <div className="rounded-xl border border-primary/12 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-primary/65">Users</p>
                    <p className="mt-1 font-semibold">
                      {formatInt(stageData?.stage.user_count ?? stageCards.find((item) => item.key === selectedStage)?.value ?? 0)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-primary/12 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-primary/65">Source Channels</p>
                    <p className="mt-1 font-semibold">{formatInt(stageData?.source_breakdown.length ?? 0)}</p>
                  </div>
                </div>

                {stageLoading && <p className="text-primary/70">Loading users for selected stage…</p>}
                {stageError && <p className="text-red-700">{stageError}</p>}

                {!stageLoading && !stageError && stageData && (
                  <>
                    {stageData.stage.truncated && (
                      <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        Showing {formatInt(stageData.stage.users_returned)} of {formatInt(stageData.stage.user_count)} users (limit{' '}
                        {formatInt(stageData.stage.truncate_limit)}).
                      </p>
                    )}

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <input
                        type="search"
                        value={stageSearch}
                        onChange={(event) => setStageSearch(event.target.value)}
                        placeholder="Search by email, source, campaign, country, payment status"
                        className="w-full sm:max-w-md rounded-xl border border-primary/20 bg-white/50 px-3 py-2 text-sm focus:border-primary/45 focus:outline-none"
                      />
                      <p className="text-xs text-primary/65">
                        Showing {formatInt(filteredStageUsers.length)} of {formatInt(stageData.users.length)} loaded users
                      </p>
                    </div>

                    {topSourceBreakdown.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {topSourceBreakdown.map((item) => (
                          <span
                            key={item.source}
                            className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-white/60 px-3 py-1 text-xs"
                          >
                            <span className="font-medium">{item.source}</span>
                            <span className="text-primary/65">{formatInt(item.count)}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="overflow-x-auto rounded-xl border border-primary/12">
                      <table className="min-w-[1320px] w-full text-sm">
                        <thead className="bg-primary/5 text-left">
                          <tr>
                            <th className="px-3 py-2 font-medium">User</th>
                            <th className="px-3 py-2 font-medium">Source</th>
                            <th className="px-3 py-2 font-medium">Campaign</th>
                            <th className="px-3 py-2 font-medium">Country</th>
                            <th className="px-3 py-2 font-medium">Signup At</th>
                            <th className="px-3 py-2 font-medium">Payment Status</th>
                            <th className="px-3 py-2 font-medium">Plan</th>
                            <th className="px-3 py-2 font-medium">Amount</th>
                            <th className="px-3 py-2 font-medium">Opened</th>
                            <th className="px-3 py-2 font-medium">Paid</th>
                            <th className="px-3 py-2 font-medium">WAU</th>
                            <th className="px-3 py-2 font-medium">Messages</th>
                            <th className="px-3 py-2 font-medium">Last Active</th>
                            {canViewConversations && <th className="px-3 py-2 font-medium">Conversations</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredStageUsers.length === 0 && (
                            <tr>
                              <td colSpan={canViewConversations ? 14 : 13} className="px-3 py-8 text-center text-primary/65">
                                No users matched this filter.
                              </td>
                            </tr>
                          )}
                          {filteredStageUsers.map((user) => (
                            <tr key={user.user_id} className="border-t border-primary/8">
                              <td className="px-3 py-2 align-top">
                                <p className="font-medium">{user.name || 'Unknown Name'}</p>
                                <p className="text-xs text-primary/65">{user.email || '—'}</p>
                              </td>
                              <td className="px-3 py-2">{user.source_channel}</td>
                              <td className="px-3 py-2">{user.campaign || '—'}</td>
                              <td className="px-3 py-2">{user.country || '—'}</td>
                              <td className="px-3 py-2">{formatDateTime(user.signup_at)}</td>
                              <td className="px-3 py-2">{user.payment_status || '—'}</td>
                              <td className="px-3 py-2">{user.plan_type || '—'}</td>
                              <td className="px-3 py-2">{formatAmount(user.amount)}</td>
                              <td className="px-3 py-2">{stageFlag(user.payment_opened)}</td>
                              <td className="px-3 py-2">{stageFlag(user.paid)}</td>
                              <td className="px-3 py-2">{stageFlag(user.active)}</td>
                              <td className="px-3 py-2">{formatInt(user.message_count)}</td>
                              <td className="px-3 py-2">{formatDateTime(user.last_active_at)}</td>
                              {canViewConversations && (
                                <td className="px-3 py-2">
                                  <button
                                    type="button"
                                    onClick={() => openConversations(user)}
                                    className="whitespace-nowrap rounded-lg border border-primary/20 px-3 py-1.5 text-xs font-medium hover:border-primary/45"
                                  >
                                    Review chats
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-primary/15 bg-background p-4 sm:p-5">
            <h2 className="text-lg font-semibold">Notes</h2>
            <ul className="mt-3 list-disc pl-5 space-y-1 text-sm text-primary/75">
              {(data?.notes ?? []).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            {data?.generated_at && (
              <p className="mt-3 text-xs text-primary/55">Generated at: {data.generated_at}</p>
            )}
          </div>
        </div>
      </div>

      {conversationUser && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Conversation review for ${conversationUser.email || conversationUser.user_id}`}
            className="flex max-h-[92dvh] w-full max-w-4xl flex-col rounded-t-3xl border border-primary/15 bg-card shadow-2xl sm:rounded-3xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-primary/10 p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-primary/55">Audited conversation review</p>
                <h2 className="mt-1 text-xl font-semibold">{conversationUser.name || 'Unknown Name'}</h2>
                <p className="text-sm text-primary/65">{conversationUser.email || conversationUser.user_id}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setConversationUser(null);
                  setConversationData(null);
                  setConversationError('');
                }}
                className="rounded-xl border border-primary/15 px-3 py-1.5 text-sm"
              >
                Close
              </button>
            </div>

            <div className="border-b border-primary/10 p-5">
              <label className="text-sm font-medium" htmlFor="conversation-review-reason">
                Review reason
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="conversation-review-reason"
                  value={conversationReason}
                  onChange={(event) => setConversationReason(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-primary/20 bg-white/50 px-3 py-2 text-sm focus:border-primary/45 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={conversationLoading || conversationReason.trim().length < 3}
                  onClick={() => void loadConversations()}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {conversationLoading ? 'Loading…' : 'Open audited chat'}
                </button>
              </div>
              <p className="mt-2 text-xs text-primary/55">Every access is logged with your identity, the user, time, and reason.</p>
              {conversationError && <p className="mt-2 text-sm text-red-700">{conversationError}</p>}
            </div>

            <div className="overflow-y-auto p-5">
              {!conversationData && !conversationLoading && (
                <p className="rounded-xl border border-dashed border-primary/20 p-4 text-sm text-primary/65">
                  Enter the business reason and open the chat to begin the audited review.
                </p>
              )}
              {conversationData && (
                <div>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full bg-primary/8 px-3 py-1 text-xs font-medium uppercase tracking-wide">
                      {conversationData.access_mode} access
                    </span>
                    <span className="text-xs text-primary/55">
                      {formatInt(conversationData.messages.length)} messages{conversationData.truncated ? ' · latest 500' : ''}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {conversationData.messages.length === 0 && (
                      <p className="text-sm text-primary/65">No messages found for this user.</p>
                    )}
                    {conversationData.messages.map((message) => (
                      <div
                        key={message.message_id}
                        className={`rounded-2xl border p-4 ${
                          message.content_type === 'user'
                            ? 'ml-auto border-primary/20 bg-primary/5 sm:max-w-[85%]'
                            : 'mr-auto border-primary/10 bg-white/55 sm:max-w-[90%]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-primary/55">
                          <span className="font-medium uppercase tracking-wide">{message.content_type}</span>
                          <span>{formatDateTime(message.timestamp)}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{message.content || '—'}</p>
                        {(message.model || message.session_id) && (
                          <p className="mt-2 text-[11px] text-primary/45">
                            {[message.model, message.session_id].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
