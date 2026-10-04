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

const DEFAULT_ALLOWED_DOMAIN = 'himeera.com';

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
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [data, setData] = useState<FunnelResponse | null>(null);
  const [selectedStage, setSelectedStage] = useState<FunnelStageKey | null>(null);
  const [stageLoading, setStageLoading] = useState<boolean>(false);
  const [stageError, setStageError] = useState<string>('');
  const [stageData, setStageData] = useState<FunnelUsersResponse | null>(null);
  const [stageSearch, setStageSearch] = useState<string>('');
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

  const isAuthorizedViewer = useMemo(() => {
    const normalized = email.trim().toLowerCase();
    return normalized.endsWith(`@${DEFAULT_ALLOWED_DOMAIN}`);
  }, [email]);

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

  if (!isAuthorizedViewer) {
    return (
      <main className="min-h-[100dvh] bg-background text-primary px-6 py-10">
        <div className="max-w-3xl mx-auto bg-card rounded-3xl p-8 border border-primary/10">
          <h1 className="text-3xl font-semibold tracking-tight">Meera Analytics</h1>
          <p className="mt-3 text-primary/70">Access is limited to internal `@himeera.com` accounts.</p>
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
                          </tr>
                        </thead>
                        <tbody>
                          {filteredStageUsers.length === 0 && (
                            <tr>
                              <td colSpan={13} className="px-3 py-8 text-center text-primary/65">
                                No users matched this filter.
                              </td>
                            </tr>
                          )}
                          {filteredStageUsers.map((user) => (
                            <tr key={user.user_id} className="border-t border-primary/8">
                              <td className="px-3 py-2 align-top">
                                <p className="font-medium">{user.name || 'Unknown Name'}</p>
                                <p className="text-xs text-primary/65">{user.email || user.user_id}</p>
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
    </main>
  );
}
