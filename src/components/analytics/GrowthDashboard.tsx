'use client';

import type { DashboardData, DashboardUser, Metric } from '@/lib/analyticsDashboardMetrics';
import type { AiData } from '@/lib/analyticsDashboardServer';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import styles from './GrowthDashboard.module.css';

const integer = (v: number | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(v);
const percent = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const inr = (v: number | null | undefined) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);
const usd = (v: number | null | undefined) => (v == null ? '—' : `$${v.toFixed(v !== 0 && v < 0.01 ? 5 : 2)}`);
const duration = (v: number | null | undefined) =>
  v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`;
const dateLabel = (date: string) =>
  new Date(date.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const palette = [
  '#0e8a71',
  '#7c63cd',
  '#e29b39',
  '#5089cd',
  '#d76f86',
  '#7b8998',
];

function useResource<T>(url: string, token: string, refresh: number) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({
    data: null,
    error: '',
    loading: true,
  });
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, error: '', loading: true });
    void (async () => {
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to load this section.');
        if (!controller.signal.aborted) setState({ data: body, error: '', loading: false });
      } catch (e) {
        if (!controller.signal.aborted)
          setState({
            data: null,
            error: e instanceof Error ? e.message : 'Unable to load this section.',
            loading: false,
          });
      }
    })();
    return () => controller.abort();
  }, [
    url,
    token,
    refresh,
  ]);
  return state;
}

function Section({
  id,
  number,
  title,
  subtitle,
  children,
  action,
}: {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-heading`}>
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>
            {number} / {id.replaceAll('-', ' ')}
          </span>
          <h2 id={`${id}-heading`}>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Panel({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`${styles.panel} ${className}`}>
      <h3>{title}</h3>
      {subtitle && <p className={styles.muted}>{subtitle}</p>}
      {children}
    </article>
  );
}
function Change({ metric, rate = false }: { metric?: Metric; rate?: boolean }) {
  if (metric?.value == null || metric.previous == null)
    return <span className={styles.comparison}>Comparison unavailable</span>;
  const delta = metric.value - metric.previous;
  const text = rate
    ? `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)} pp`
    : metric.previous === 0
      ? metric.value === 0
        ? 'No change'
        : `+${integer(metric.value)} · no prior baseline`
      : `${delta > 0 ? '+' : ''}${((delta / metric.previous) * 100).toFixed(1)}%`;
  return (
    <span className={`${styles.comparison} ${delta > 0 ? styles.positive : delta < 0 ? styles.negative : ''}`}>
      {text} <span>vs previous</span>
    </span>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}
function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert" className={styles.error}>
      <span>{message}</span>
      <button onClick={retry}>Retry</button>
    </div>
  );
}

type Point = { date: string; value: number | null };
function Trend({
  title,
  subtitle,
  points,
  color = palette[0],
  format = integer,
  loading = false,
  error = false,
}: {
  title: string;
  subtitle: string;
  points: Point[];
  color?: string;
  format?: (v: number | null) => string;
  loading?: boolean;
  error?: boolean;
}) {
  const gradient = useId().replaceAll(':', '');
  const [focus, setFocus] = useState<number | null>(null);
  const values = points.filter((p) => p.value !== null);
  const max = Math.max(...values.map((p) => p.value ?? 0), 1);
  const x = (i: number) => 50 + (i * 704) / Math.max(points.length - 1, 1),
    y = (v: number) => 185 - (v / max) * 155;
  const line = points
    .map((p, i) =>
      p.value === null ? '' : `${i === 0 || points[i - 1].value === null ? 'M' : 'L'}${x(i)},${y(p.value)}`,
    )
    .join(' ');
  const selected = focus == null ? null : points[focus];
  return (
    <Panel title={title} subtitle={subtitle}>
      {!values.length ? (
        <Empty>
          {loading
            ? 'Loading chart data…'
            : error
              ? 'Chart data unavailable. Retry the source to reload it.'
              : 'No recorded data for this metric in the selected window.'}
        </Empty>
      ) : (
        <>
          <div className={styles.chart}>
            <svg
              viewBox="0 0 800 225"
              role="img"
              aria-label={`${title}. ${points.length} time buckets. Use the data table below for exact values.`}
            >
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity=".17" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[
                0,
                0.5,
                1,
              ].map((n) => (
                <g key={n}>
                  <line x1="50" x2="754" y1={y(max * n)} y2={y(max * n)} stroke="#e8edf1" strokeDasharray="4 5" />
                  <text x="42" y={y(max * n) + 4} textAnchor="end" fontSize="11" fill="#788797">
                    {format(max * n)}
                  </text>
                </g>
              ))}
              {points.every((p) => p.value !== null) && (
                <path d={`${line} L${x(points.length - 1)},185 L50,185 Z`} fill={`url(#${gradient})`} />
              )}
              <path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {points.length === 1 && <circle cx={x(0)} cy={y(points[0].value ?? 0)} r="4" fill={color} />}
              {[
                0,
                Math.floor((points.length - 1) / 2),
                points.length - 1,
              ]
                .filter((v, i, a) => a.indexOf(v) === i)
                .map((i) => (
                  <text
                    key={i}
                    x={x(i)}
                    y="212"
                    textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                    fontSize="11"
                    fill="#788797"
                  >
                    {dateLabel(points[i].date)}
                  </text>
                ))}
              {focus !== null && selected?.value != null && (
                <g>
                  <line x1={x(focus)} x2={x(focus)} y1="24" y2="185" stroke={color} opacity=".3" />
                  <circle cx={x(focus)} cy={y(selected.value)} r="5" fill={color} stroke="white" strokeWidth="2" />
                </g>
              )}
              {points.map((p, i) => (
                <rect
                  key={p.date}
                  x={x(i) - (points.length === 1 ? 20 : 352 / Math.max(points.length - 1, 1))}
                  y="20"
                  width={Math.max(704 / Math.max(points.length - 1, 1), 8)}
                  height="170"
                  fill="transparent"
                  onMouseEnter={() => setFocus(i)}
                  onMouseLeave={() => setFocus(null)}
                >
                  <title>
                    {dateLabel(p.date)}: {format(p.value)}
                  </title>
                </rect>
              ))}
            </svg>
            <div className={styles.chartReadout} aria-live="polite">
              {selected
                ? `${dateLabel(selected.date)} · ${format(selected.value)}`
                : 'Hover to inspect · exact values in the table below'}
            </div>
          </div>
          <details className={styles.chartTable}>
            <summary>View chart data</summary>
            <div className={styles.tableScroll}>
              <table>
                <caption>{title}</caption>
                <thead>
                  <tr>
                    <th scope="col">Bucket starting (UTC)</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.date}>
                      <th scope="row">{p.date}</th>
                      <td>{format(p.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </Panel>
  );
}

function Bars({
  items,
  total,
  onClick,
}: {
  items: { label: string; count: number | null; key?: string }[];
  total?: number;
  onClick?: (key: string) => void;
}) {
  const max = Math.max(...items.map((i) => i.count ?? 0), 1);
  return (
    <div className={styles.bars}>
      {items.map((item, i) => (
        <div key={item.label} className={styles.barRow}>
          <div className={styles.barLabel}>
            {onClick ? (
              <button disabled={item.count === null} onClick={() => onClick(item.key || item.label)}>
                {item.label} ↗
              </button>
            ) : (
              <span>{item.label}</span>
            )}
            <strong>
              {integer(item.count)}
              {total !== undefined && item.count !== null && (
                <small> · {percent(total ? item.count / total : null)}</small>
              )}
            </strong>
          </div>
          <div className={styles.barTrack}>
            <div style={{ width: `${((item.count ?? 0) / max) * 100}%`, background: palette[i % palette.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function UserExplorer({
  token,
  from,
  to,
  segment,
  source,
  onClose,
}: {
  token: string;
  from: string;
  to: string;
  segment: string;
  source: string;
  onClose: () => void;
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [refresh, setRefresh] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);
  const params = new URLSearchParams({
    from,
    to,
    segment,
    q: query,
    page: String(page),
    ...(source ? { source } : {}),
  });
  const { data, loading, error } = useResource<{ users: DashboardUser[]; total: number }>(
    `/api/analytics/dashboard?${params}`,
    token,
    refresh,
  );
  return (
    <div ref={ref} tabIndex={-1} className={styles.explorer} aria-label="Filtered users">
      <div className={styles.sectionHeading}>
        <div>
          <span className={styles.eyebrow}>User explorer</span>
          <h3>
            {segment === 'engaged-new'
              ? 'Engaged new users · 10+ messages'
              : `${segment.charAt(0).toUpperCase() + segment.slice(1)} users`}
            {source ? ` · ${source}` : ''}
          </h3>
          <p>
            {from} → {to} · UTC
          </p>
        </div>
        <button className={styles.button} onClick={onClose}>
          Close breakdown
        </button>
      </div>
      <input
        className={styles.search}
        aria-label="Search filtered users"
        placeholder="Search name, email, source or user ID…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {loading ? (
        <div role="status" className={styles.loading}>
          Loading users…
        </div>
      ) : error ? (
        <ErrorState message={error} retry={() => setRefresh((n) => n + 1)} />
      ) : (
        <>
          <div className={styles.tableScroll}>
            <table>
              <caption>{integer(data?.total)} users · ranked by messages in this window</caption>
              <thead>
                <tr>
                  {[
                    'User',
                    'Signup',
                    'Source',
                    'Messages',
                    'Active days',
                    'Ever paid',
                    'Last activity',
                  ].map((h) => (
                    <th key={h} scope="col">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.users.map((u) => (
                  <tr key={u.id}>
                    <th scope="row">
                      <span>{u.name || 'User'}</span>
                      <small>{u.email || u.id}</small>
                    </th>
                    <td>{dateLabel(u.signup)}</td>
                    <td>{u.source}</td>
                    <td>{integer(u.messages)}</td>
                    <td>{integer(u.activeDays)}</td>
                    <td>{u.paid === null ? '—' : u.paid ? 'Yes' : 'No'}</td>
                    <td>{u.lastActive ? dateLabel(u.lastActive) : '—'}</td>
                  </tr>
                ))}
                {!data?.users.length && (
                  <tr>
                    <td colSpan={7}>No users match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className={styles.pagination}>
            <span>
              {integer(data?.total)} users · page {page + 1}
            </span>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button disabled={(page + 1) * 25 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function GrowthDashboard({ token, permissions }: { token: string; permissions: string[] }) {
  const [window, setWindow] = useState({ from: daysAgo(29), to: today() });
  const [draft, setDraft] = useState(window),
    [range, setRange] = useState('30'),
    [dateError, setDateError] = useState('');
  const [refresh, setRefresh] = useState(0),
    [segment, setSegment] = useState<{ key: string; source: string } | null>(null);
  const [growthMetric, setGrowthMetric] = useState<'signups' | 'active'>('signups');
  const [aiMetric, setAiMetric] = useState<'requests' | 'tokens' | 'cost'>('requests');
  const [modelFilter, setModelFilter] = useState('all'),
    [statusFilter, setStatusFilter] = useState('all');
  const params = new URLSearchParams(window).toString();
  const product = useResource<DashboardData>(`/api/analytics/dashboard?${params}`, token, refresh);
  const ai = useResource<AiData>(`/api/analytics/dashboard-ai?${params}`, token, refresh);
  const d = product.data,
    a = ai.data;
  const canExplore = permissions.includes('users.list');
  const openUsers = (key: string, source = '') => {
    if (canExplore) setSegment({ key, source });
  };
  const apply = (next: typeof window) => {
    if (
      !next.from ||
      !next.to ||
      next.from > next.to ||
      next.to > today() ||
      Date.parse(next.to) - Date.parse(next.from) > 3659 * 86400000
    ) {
      setDateError('Choose an ordered date range ending today or earlier (maximum 10 years).');
      return;
    }
    setDateError('');
    setWindow(next);
    setDraft(next);
    setSegment(null);
  };
  const preset = async (value: string) => {
    setRange(value);
    if (value === 'custom') return;
    if (value === 'all') {
      try {
        const r = await fetch('/api/analytics/range', { headers: { Authorization: `Bearer ${token}` } });
        const body = await r.json();
        if (!r.ok || !body.from) throw new Error('Lifetime range could not be loaded. Use custom dates.');
        apply({ from: body.from, to: today() });
      } catch (e) {
        setDateError((e as Error).message);
      }
    } else apply({ from: daysAgo(Number(value) - 1), to: today() });
  };
  const recent = useMemo(
    () =>
      (a?.recent ?? []).filter(
        (r) =>
          (modelFilter === 'all' || r.model === modelFilter) &&
          (statusFilter === 'all' || (statusFilter === 'success') === r.ok),
      ),
    [
      a,
      modelFilter,
      statusFilter,
    ],
  );
  const exportCsv = () => {
    if (!d) return;
    const body = [
      'bucket_start_utc,new_users,active_users,user_messages,revenue_inr',
      ...d.daily.map((p) =>
        [
          p.date,
          p.signups,
          p.active ?? '',
          p.messages ?? '',
          p.revenue ?? '',
        ].join(','),
      ),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `meera-growth-${window.from}-${window.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const metrics: {
    label: string;
    key: keyof DashboardData['metrics'];
    format?: typeof integer;
    rate?: boolean;
    definition: string;
    segment?: string;
  }[] = [
    {
      label: 'Registered users',
      key: 'totalUsers',
      definition: 'All real external accounts created before the window ends.',
      segment: 'all',
    },
    {
      label: 'New signups',
      key: 'newUsers',
      definition: 'Real external accounts created in this window.',
      segment: 'new',
    },
    {
      label: 'Engaged new users',
      key: 'engagedNewUsers',
      definition: 'New signups who sent 10+ messages in this window.',
      segment: 'engaged-new',
    },
    {
      label: 'Avg. messages / new user',
      key: 'newUserMessages',
      definition: 'Messages sent in this window by new signups ÷ all new signups, including those with zero messages.',
      segment: 'new',
    },
    {
      label: 'Returning users',
      key: 'returningUsers',
      definition: 'Active users who signed up before this window.',
      segment: 'returning',
    },
    {
      label: 'Payment opened',
      key: 'paymentOpened',
      definition: 'Distinct users who opened the payment page in this window, including new and existing users.',
      segment: 'opened',
    },
    {
      label: 'Paying customers',
      key: 'paidUsers',
      definition: 'Distinct users with a successful positive payment in this window.',
    },
    {
      label: 'Revenue collected',
      key: 'revenue',
      format: inr,
      definition: 'Successful positive payments dated in this window. INR; BYPASS excluded.',
    },
  ];
  return (
    <div className={styles.dashboard}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <label>
            Period
            <select aria-label="Analytics period" value={range} onChange={(e) => void preset(e.target.value)}>
              <option value="1">Today</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="all">Lifetime</option>
              <option value="custom">Custom dates</option>
            </select>
          </label>
          <label>
            From
            <input
              aria-label="Analytics start date"
              type="date"
              max={today()}
              value={draft.from}
              onChange={(e) => {
                setRange('custom');
                setDraft((v) => ({ ...v, from: e.target.value }));
              }}
            />
          </label>
          <label>
            To
            <input
              aria-label="Analytics end date"
              type="date"
              max={today()}
              value={draft.to}
              onChange={(e) => {
                setRange('custom');
                setDraft((v) => ({ ...v, to: e.target.value }));
              }}
            />
          </label>
          <button className={styles.apply} onClick={() => apply(draft)}>
            Apply
          </button>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.button}
            disabled={product.loading || ai.loading}
            onClick={() => setRefresh((n) => n + 1)}
          >
            ↻ Refresh
          </button>
          <button className={styles.button} disabled={!d} onClick={exportCsv}>
            ↓ Export trends
          </button>
        </div>
        <div className={styles.windowNote}>
          {window.from} → {window.to} · UTC
          {d && (
            <>
              {' '}
              · versus {d.previousFrom} → {d.previousTo}
            </>
          )}
          {d && (
            <span>
              Updated{' '}
              {new Date(d.generatedAt).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'UTC',
              })}{' '}
              UTC
            </span>
          )}
        </div>
        {dateError && (
          <p role="alert" className={styles.dateError}>
            {dateError}
          </p>
        )}
      </div>
      <nav className={styles.jumpNav} aria-label="Dashboard sections">
        {[
          ['snapshot', 'Overview'],
          ['users', 'Users'],
          ['growth', 'Growth'],
          ['activation', 'Activation'],
          ['retention', 'Retention'],
          ['engagement', 'Engagement'],
          ['economics', 'Economics'],
          ['ai-activity', 'AI activity'],
        ].map(([id, label]) => (
          <a href={`#${id}`} key={id}>
            {label}
          </a>
        ))}
      </nav>
      {product.error && <ErrorState message={product.error} retry={() => setRefresh((n) => n + 1)} />}
      {d?.warnings.map((w) => (
        <div className={styles.notice} key={w} role="status">
          {w}
        </div>
      ))}
      <Section
        id="snapshot"
        number="01"
        title="The business, at a glance"
        subtitle="Follow acquisition → engagement → monetization. Every comparison uses the preceding window of equal length."
      >
        <div className={styles.kpis} aria-busy={product.loading}>
          {metrics.map((m, i) => (
            <article
              key={m.key}
              className={styles.kpi}
              title={m.definition}
              style={{ '--accent': palette[i % palette.length] } as React.CSSProperties}
            >
              <div className={styles.eyebrow}>
                {i < 2 ? '01 · Acquisition' : i < 5 ? '02 · Engagement' : '03 · Monetization'}
              </div>
              <div className={styles.kpiLabel}>
                {m.label}
                <span title={m.definition} aria-label={m.definition}>
                  ⓘ
                </span>
              </div>
              <button
                disabled={!canExplore || !m.segment || !d || d.metrics[m.key].value === null}
                onClick={() => {
                  if (m.segment) openUsers(m.segment);
                }}
                className={styles.kpiValue}
              >
                {product.loading ? (
                  <span className={styles.skeleton} />
                ) : (
                  (m.format || integer)(d?.metrics[m.key].value)
                )}
                {m.segment && canExplore && d && <small>↗</small>}
              </button>
              <Change metric={d?.metrics[m.key]} rate={m.rate} />
              {m.key === 'engagedNewUsers' && !product.loading && d && (
                <p className={styles.kpiDefinition}>
                  {percent(
                    d.metrics.engagedNewUsers.value !== null && d.metrics.newUsers.value
                      ? d.metrics.engagedNewUsers.value / d.metrics.newUsers.value
                      : null,
                  )}{' '}
                  of new signups
                </p>
              )}
              <p className={styles.kpiDefinition}>{m.definition}</p>
            </article>
          ))}
        </div>
        {d && (
          <div className={styles.insights}>
            <span className={styles.eyebrow}>Where to look next</span>
            <div>
              <p>
                <strong>
                  {integer(
                    d.funnel[0].count !== null && d.funnel[1].count !== null
                      ? d.funnel[0].count - d.funnel[1].count
                      : null,
                  )}{' '}
                  new users haven’t activated.
                </strong>{' '}
                Inspect the signup-to-first-message experience.{' '}
                <button disabled={!canExplore} onClick={() => openUsers('new')}>
                  Review signups ↗
                </button>
              </p>
              <p>
                <strong>{percent(d.repeatActive)} of active users used Meera on multiple days.</strong> Compare this
                with exact-day retention below.
              </p>
              <p>
                <strong>
                  {integer(d.channels.find((c) => c.source === 'Unknown')?.users ?? 0)} signups have no tracked source.
                </strong>{' '}
                Use growth links to connect acquisition to activation and payment.{' '}
                <a href="/analytics/links">Growth links ↗</a>
              </p>
            </div>
          </div>
        )}
      </Section>
      <Section
        id="users"
        number="02"
        title="Who is using Meera?"
        subtitle="Registered users as of the window end; activity describes the selected window. These segments overlap."
      >
        <div className={styles.segmentGrid}>
          {(
            d?.segments ??
            [
              'Registered users',
              'New signups',
              'Active',
              'Returning',
              'Inactive',
              'Ever paid',
              'Never paid',
            ].map((label) => ({ label, key: label, count: null }))
          ).map((s) => (
            <button
              key={s.key}
              className={styles.segment}
              disabled={!d || s.count === null || !canExplore}
              onClick={() => openUsers(s.key)}
            >
              <span>{s.label}</span>
              <strong>{integer(s.count)}</strong>
              <small>
                {d && s.count !== null
                  ? `${percent(d.metrics.totalUsers.value ? s.count / d.metrics.totalUsers.value : null)} of registered users`
                  : 'Awaiting data'}
                {canExplore ? ' ↗' : ''}
              </small>
            </button>
          ))}
        </div>
        <div className={styles.twoCol}>
          <Panel title="Active versus inactive" subtitle="Distinct users with at least one message in this window.">
            {d?.metrics.activeUsers.value != null && d.metrics.totalUsers.value ? (
              <div className={styles.donutLayout}>
                <div
                  className={styles.donut}
                  role="img"
                  aria-label={`${d.metrics.activeUsers.value} active out of ${d.metrics.totalUsers.value} registered users`}
                  style={{
                    background: `conic-gradient(${palette[0]} 0 ${(d.metrics.activeUsers.value / d.metrics.totalUsers.value) * 100}%, #e9edf1 0 100%)`,
                  }}
                >
                  <div>
                    <strong>{percent(d.metrics.activeUsers.value / d.metrics.totalUsers.value)}</strong>
                    <span>active share</span>
                  </div>
                </div>
                <Bars
                  total={d.metrics.totalUsers.value}
                  items={[
                    { label: 'Active', key: 'active', count: d.metrics.activeUsers.value },
                    {
                      label: 'Inactive',
                      key: 'inactive',
                      count: d.metrics.totalUsers.value - d.metrics.activeUsers.value,
                    },
                  ]}
                  onClick={canExplore ? openUsers : undefined}
                />
              </div>
            ) : (
              <Empty>
                {product.loading ? 'Loading user breakdown…' : 'No complete user activity data for this window.'}
              </Empty>
            )}
          </Panel>
          <Panel
            title="Depth of engagement"
            subtitle="Message distribution across all registered users in this window."
          >
            <Bars
              total={d?.metrics.totalUsers.value ?? undefined}
              items={(d?.distribution ?? []).map((b) => ({ label: b.label, count: b.count }))}
            />
            {!d && <Empty>Awaiting message activity.</Empty>}
          </Panel>
        </div>
        {segment && (
          <UserExplorer
            key={`${params}:${segment.key}:${segment.source}`}
            token={token}
            from={window.from}
            to={window.to}
            segment={segment.key}
            source={segment.source}
            onClose={() => setSegment(null)}
          />
        )}
      </Section>
      <Section
        id="growth"
        number="03"
        title="Where growth comes from"
        subtitle="Follow acquisition volume through to activation, repeat use, and payment—not just signups."
        action={
          <select
            className={styles.select}
            aria-label="Growth chart metric"
            value={growthMetric}
            onChange={(e) => setGrowthMetric(e.target.value as typeof growthMetric)}
          >
            <option value="signups">New signups</option>
            <option value="active">Active users</option>
          </select>
        }
      >
        <Trend
          title={growthMetric === 'signups' ? 'New-user growth' : 'Active-user trend'}
          subtitle={`${d?.bucketDays === 7 ? 'Weekly' : 'Daily'} ${growthMetric === 'signups' ? 'signups' : 'distinct active users'} · UTC`}
          loading={product.loading}
          error={!!product.error}
          points={(d?.daily ?? []).map((p) => ({ date: p.date, value: p[growthMetric] }))}
        />
        <Panel
          title="Acquisition quality"
          subtitle="New signups in this window, grouped by their earliest recorded growth-link attribution. Untracked sources remain Unknown."
        >
          <Bars
            total={d?.metrics.newUsers.value ?? undefined}
            items={(d?.channels ?? []).slice(0, 8).map((c) => ({ label: c.source, count: c.users }))}
            onClick={canExplore ? (source) => openUsers('new', source) : undefined}
          />
          <div className={styles.tableScroll}>
            <table>
              <caption>Channel outcomes · the same signup cohort at every stage</caption>
              <thead>
                <tr>
                  {[
                    'Source',
                    'Signups',
                    'Activated',
                    'Returned',
                    'Paid',
                    'Revenue',
                  ].map((h) => (
                    <th scope="col" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d?.channels.map((c) => (
                  <tr key={c.source}>
                    <th scope="row">
                      <button disabled={!canExplore} onClick={() => openUsers('new', c.source)}>
                        {c.source} ↗
                      </button>
                    </th>
                    <td>{integer(c.users)}</td>
                    <td>
                      {integer(c.activated)}{' '}
                      <small>{percent(c.activated !== null ? c.activated / c.users : null)}</small>
                    </td>
                    <td>
                      {integer(c.returned)} <small>{percent(c.returned !== null ? c.returned / c.users : null)}</small>
                    </td>
                    <td>{integer(c.paid)}</td>
                    <td>{inr(c.revenue)}</td>
                  </tr>
                ))}
                {!d?.channels.length && (
                  <tr>
                    <td colSpan={6}>{product.loading ? 'Loading channels…' : 'No new signups in this window.'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </Section>
      <Section
        id="activation"
        number="04"
        title="From signup to a habit"
        subtitle="A nested funnel of the same new-user cohort. Engagement means at least five user messages; a return requires a second active day."
      >
        <Panel title="New-user activation funnel">
          <div className={styles.funnel}>
            {d?.funnel.map((stage, i) => {
              const base = d.funnel[0].count || 0,
                previous = d.funnel[i - 1]?.count;
              return (
                <div key={stage.key} className={styles.funnelStage}>
                  <div>
                    <span className={styles.step}>{i + 1}</span>
                    <button
                      disabled={!canExplore || stage.count === null}
                      onClick={() => openUsers(stage.key)}
                      title={stage.definition}
                    >
                      {stage.label} ↗
                    </button>
                    <strong>{integer(stage.count)}</strong>
                    <span>{percent(stage.count !== null && base ? stage.count / base : null)} of signups</span>
                  </div>
                  <div className={styles.funnelTrack}>
                    <div
                      style={{ width: `${base ? ((stage.count ?? 0) / base) * 100 : 0}%`, background: palette[i] }}
                    />
                  </div>
                  {i > 0 && (
                    <small>
                      {previous != null && stage.count !== null
                        ? `${integer(previous - stage.count)} drop-off · ${percent(previous ? stage.count / previous : null)} from previous step`
                        : 'Data unavailable'}
                    </small>
                  )}
                </div>
              );
            })}
            {!d && <Empty>Activation data will appear when the user and message sources are available.</Empty>}
          </div>
          <div className={styles.inlineMetrics}>
            <div>
              <span>Payment opened by new users</span>
              <strong>{integer(d?.paymentOpened)}</strong>
            </div>
            <div>
              <span>New signups who paid</span>
              <strong>{integer(d?.newPaid)}</strong>
            </div>
            <div>
              <span>Signup → paid conversion</span>
              <strong>{percent(d?.metrics.paidConversion.value)}</strong>
            </div>
          </div>
          <p className={styles.footnote}>
            Payment is a parallel outcome; users can pay before or after becoming engaged. Payment-open events are
            observed client events, not verified purchase intent.
          </p>
        </Panel>
      </Section>
      <Section
        id="retention"
        number="05"
        title="Do users come back?"
        subtitle="Exact-day retention by signup week. Each cell uses only users whose target day has fully elapsed."
      >
        <Panel
          title="Signup cohort retention"
          subtitle="D7 means a user sent a message exactly seven UTC calendar days after signup. It is not rolling or weekly retention."
        >
          <div className={styles.tableScroll}>
            <table className={styles.heatmap}>
              <caption>Retained / eligible users · hover or focus a cell for its denominator</caption>
              <thead>
                <tr>
                  <th scope="col">Signup week</th>
                  <th scope="col">Signups</th>
                  {[
                    1,
                    7,
                    14,
                    30,
                  ].map((n) => (
                    <th key={n} scope="col">
                      Day {n}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d?.retention.map((c) => (
                  <tr key={c.week}>
                    <th scope="row">{dateLabel(c.week)}</th>
                    <td>{integer(c.users)}</td>
                    {c.cells.map((cell) => (
                      <td key={cell.day}>
                        <span
                          tabIndex={0}
                          title={
                            cell.eligible
                              ? `${cell.retained} of ${cell.eligible} eligible users returned on day ${cell.day}`
                              : 'This cohort has not matured yet.'
                          }
                          style={
                            cell.rate === null
                              ? undefined
                              : {
                                  background: `rgba(14,138,113,${0.06 + cell.rate * 0.7})`,
                                  color: cell.rate > 0.55 ? '#fff' : '#164f45',
                                }
                          }
                        >
                          <strong>{cell.rate === null ? '—' : percent(cell.rate)}</strong>
                          <small>{cell.eligible ? `${cell.retained}/${cell.eligible}` : 'Not mature'}</small>
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
                {!d?.retention.length && (
                  <tr>
                    <td colSpan={6}>{product.loading ? 'Loading cohorts…' : 'No signup cohorts in this window.'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className={styles.footnote}>
            A zero is observed non-return. A dash means insufficient maturity or unavailable messages. Cohorts and
            activity are bounded by the selected window end.
          </p>
        </Panel>
      </Section>
      <Section
        id="engagement"
        number="06"
        title="How deeply do users engage?"
        subtitle="User-authored messages measure participation. Assistant replies and system events are excluded."
      >
        <div className={styles.inlineMetrics}>
          <div>
            <span>User messages</span>
            <strong>{integer(d?.metrics.messages.value)}</strong>
            <Change metric={d?.metrics.messages} />
          </div>
          <div>
            <span>Messages / active user</span>
            <strong>{integer(d?.messagesPerActive)}</strong>
            <small>Window totals, not a daily average</small>
          </div>
          <div>
            <span>Multi-day active share</span>
            <strong>{percent(d?.repeatActive)}</strong>
            <small>Active users with two or more active days</small>
          </div>
        </div>
        <Trend
          title="Conversation participation"
          subtitle={`${d?.bucketDays === 7 ? 'Weekly' : 'Daily'} user messages · UTC`}
          loading={product.loading}
          error={!!product.error}
          points={(d?.daily ?? []).map((p) => ({ date: p.date, value: p.messages }))}
          color={palette[1]}
        />
      </Section>
      <Section
        id="economics"
        number="07"
        title="Growth that makes economic sense"
        subtitle="Revenue is reported in INR. Recorded provider spend is reported in USD; no assumed exchange rate or invented margin."
      >
        <div className={styles.twoCol}>
          <Trend
            title="Revenue collected"
            subtitle="Successful positive payments · BYPASS excluded"
            loading={product.loading}
            error={!!product.error}
            points={(d?.daily ?? []).map((p) => ({ date: p.date, value: p.revenue }))}
            format={inr}
            color={palette[2]}
          />
          <Trend
            title="Recorded AI spend"
            subtitle="Only requests with recorded cost metadata are included."
            loading={ai.loading}
            error={!!ai.error}
            points={(a?.daily ?? []).map((p) => ({ date: p.date, value: p.cost }))}
            format={usd}
            color={palette[1]}
          />
        </div>
        <div className={styles.inlineMetrics}>
          <div>
            <span>Recorded provider spend</span>
            <strong>{usd(a?.current.cost)}</strong>
            <small>{percent(a?.current.costCoverage)} request cost coverage</small>
          </div>
          <div>
            <span>Recorded cost / active user</span>
            <strong>
              {usd(
                a?.current.cost != null && d?.metrics.activeUsers.value
                  ? a.current.cost / d.metrics.activeUsers.value
                  : null,
              )}
            </strong>
            <small>USD · partial when cost coverage is below 100%</small>
          </div>
          <div>
            <span>Revenue / paying customer</span>
            <strong>
              {inr(
                d?.metrics.revenue.value != null && d.metrics.paidUsers.value
                  ? d.metrics.revenue.value / d.metrics.paidUsers.value
                  : null,
              )}
            </strong>
            <small>INR · window revenue / window payers</small>
          </div>
        </div>
      </Section>
      <Section
        id="ai-activity"
        number="08"
        title="The activity behind the experience"
        subtitle="Recorded generation telemetry for real external users. Inspect volume, model mix, cost, speed, and failures."
        action={
          <select
            className={styles.select}
            aria-label="AI chart metric"
            value={aiMetric}
            onChange={(e) => setAiMetric(e.target.value as typeof aiMetric)}
          >
            <option value="requests">Requests</option>
            <option value="tokens">Tokens</option>
            <option value="cost">Recorded spend</option>
          </select>
        }
      >
        {ai.error && <ErrorState message={ai.error} retry={() => setRefresh((n) => n + 1)} />}
        {ai.loading && (
          <div role="status" className={styles.loading}>
            Loading AI telemetry independently…
          </div>
        )}
        <div className={styles.inlineMetrics}>
          <div>
            <span>Recorded requests</span>
            <strong>{integer(a?.current.requests)}</strong>
            <Change metric={a ? { value: a.current.requests, previous: a.previous.requests } : undefined} />
          </div>
          <div>
            <span>Tokens consumed</span>
            <strong>{integer(a?.current.tokens)}</strong>
            <Change metric={a ? { value: a.current.tokens, previous: a.previous.tokens } : undefined} />
          </div>
          <div>
            <span>Success rate</span>
            <strong>{percent(a?.current.success)}</strong>
            <small>Successful / all recorded requests</small>
          </div>
          <div>
            <span>P50 / P95 latency</span>
            <strong className={styles.smallValue}>
              {duration(a?.current.p50)} / {duration(a?.current.p95)}
            </strong>
            <small>{percent(a?.current.latencyCoverage)} latency coverage</small>
          </div>
        </div>
        <Trend
          title={
            aiMetric === 'cost'
              ? 'Recorded provider spend'
              : aiMetric === 'tokens'
                ? 'Token consumption'
                : 'Generation volume'
          }
          subtitle="Uses the same window and UTC buckets as the growth charts."
          loading={ai.loading}
          error={!!ai.error}
          points={(a?.daily ?? []).map((p) => ({ date: p.date, value: p[aiMetric] }))}
          format={aiMetric === 'cost' ? usd : integer}
          color={palette[3]}
        />
        <Panel title="Model mix" subtitle="Model-level economics and reliability for the selected window.">
          <Bars items={(a?.models ?? []).slice(0, 8).map((m) => ({ label: m.model, count: m.requests }))} />
          <div className={styles.tableScroll}>
            <table>
              <caption>All recorded models</caption>
              <thead>
                <tr>
                  {[
                    'Model',
                    'Requests',
                    'Tokens',
                    'Recorded spend',
                    'Cost coverage',
                    'Success',
                    'P95',
                  ].map((h) => (
                    <th scope="col" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a?.models.map((m) => (
                  <tr key={m.model}>
                    <th scope="row">{m.model}</th>
                    <td>{integer(m.requests)}</td>
                    <td>{integer(m.tokens)}</td>
                    <td>{usd(m.cost)}</td>
                    <td>{percent(m.costCoverage)}</td>
                    <td>{percent(m.success)}</td>
                    <td>{duration(m.p95)}</td>
                  </tr>
                ))}
                {!a?.models.length && (
                  <tr>
                    <td colSpan={7}>
                      {ai.loading
                        ? 'Loading models…'
                        : ai.error
                          ? 'Model telemetry unavailable.'
                          : 'No recorded requests in this window.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
        <details className={styles.activity}>
          <summary>
            Explore recent activity <span>{integer(a?.recent.length)} most recent requests</span>
          </summary>
          <div className={styles.activityFilters}>
            <select
              className={styles.select}
              aria-label="Filter activity by model"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
            >
              <option value="all">All models</option>
              {a?.models.map((m) => (
                <option key={m.model}>{m.model}</option>
              ))}
            </select>
            <select
              className={styles.select}
              aria-label="Filter activity by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="failure">Failed</option>
            </select>
          </div>
          <div className={styles.tableScroll}>
            <table>
              <caption>Latest 100 recorded requests · filters apply to this recent subset</caption>
              <thead>
                <tr>
                  {[
                    'Time (UTC)',
                    'Model',
                    'Status',
                    'Tokens',
                    'Recorded cost',
                    'Latency',
                  ].map((h) => (
                    <th scope="col" key={h}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date.replace('T', ' ').slice(0, 19)}</td>
                    <th scope="row">{r.model}</th>
                    <td>
                      <span className={r.ok ? styles.successBadge : styles.failureBadge}>
                        {r.ok ? 'Success' : 'Failed'}
                      </span>
                    </td>
                    <td>{integer(r.tokens)}</td>
                    <td>{usd(r.cost)}</td>
                    <td>{duration(r.latency)}</td>
                  </tr>
                ))}
                {!recent.length && (
                  <tr>
                    <td colSpan={6}>No requests match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      </Section>
      <div className={styles.definitions}>
        <h3>Numbers you can trust</h3>
        <p>
          All charts, cohorts, and comparisons use UTC calendar days. Today is incomplete until midnight UTC. Internal,
          deleted, synthetic and test accounts are excluded. Payments exclude configured bypass codes and non-positive
          amounts. “Ever paid” describes observed successful payment history, not current subscription entitlement. No
          conversation content is transferred to this dashboard.
        </p>
        <p>
          Acquisition currently reflects tracked growth links; organic, direct, and other untracked signups remain
          Unknown. Historical activation speed and lifetime value are not inferred from incomplete tracking. Metrics
          refresh on demand; product snapshots may be reused for up to 60 seconds.
        </p>
        <a href="/analytics/data-quality">Review existing data-quality rules ↗</a>
      </div>
    </div>
  );
}
