// Shared, deterministic metric definitions. All dashboard calendar boundaries are UTC.
export type Row = Record<string, unknown>;
export const DAY = 86_400_000;
export const ENGAGED_NEW_MESSAGES = 10;
export const day = (value: unknown) => String(value ?? '').slice(0, 10);
export const timestamp = (value: unknown) => Date.parse(String(value ?? ''));
export const numeric = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
export const ratio = (a: number, b: number) => (b ? a / b : null);
export type DashboardInput = {
  users: Row[];
  messages: Row[] | null;
  payments: Row[] | null;
  events: Row[] | null;
  attributions: Row[] | null;
  links: Row[] | null;
  warnings: string[];
};
export type DashboardUser = {
  id: string;
  name: string | null;
  email: string | null;
  signup: string;
  source: string;
  messages: number | null;
  activeDays: number | null;
  lastActive: string | null;
  paid: boolean | null;
  revenue: number | null;
  isNew: boolean;
  opened: boolean | null;
};
export type Metric = { value: number | null; previous: number | null };

export function aggregateDashboard(input: DashboardInput, from: string, to: string) {
  const start = timestamp(from),
    end = timestamp(to) + DAY;
  const previousStart = start - (end - start);
  const users = input.users.filter((u) => timestamp(u.created_at) < end);
  const byIdentity = new Map<string, Row>();
  for (const u of users) {
    byIdentity.set(String(u.id), u);
    if (u.auth_id) byIdentity.set(String(u.auth_id), u);
  }
  const inWindow = (value: unknown, a = start, b = end) => timestamp(value) >= a && timestamp(value) < b;
  const sourceByUser = new Map<string, string>();
  const links = new Map((input.links ?? []).map((l) => [String(l.id), String(l.utm_source || 'Unknown')]));
  for (const a of [...(input.attributions ?? [])].sort(
    (a, b) => timestamp(a.attributed_at) - timestamp(b.attributed_at),
  )) {
    const u = byIdentity.get(String(a.auth_user_id));
    if (u && !sourceByUser.has(String(u.id)) && timestamp(a.attributed_at) < end)
      sourceByUser.set(String(u.id), links.get(String(a.link_id)) || 'Unknown');
  }
  const userMessages = (input.messages ?? []).filter(
    (m) => m.content_type === 'user' && byIdentity.has(String(m.user_id)),
  );
  const validPayments = (input.payments ?? []).filter((p) => byIdentity.has(String(p.user_id)));
  const paymentTime = (p: Row) => p.payment_date || p.created_at;
  const successful = validPayments.filter(
    (p) =>
      [
        'paid',
        'active',
        'success',
      ].includes(String(p.payment_status).toLowerCase()) && numeric(p.amount) > 0,
  );
  const opened = (input.events ?? []).filter(
    (e) => e.event_name === 'payment_page_opened' && byIdentity.has(String(e.user_id)),
  );
  const canonical = (id: unknown) => String(byIdentity.get(String(id))?.id ?? '');
  const activity = (a: number, b: number) => {
    const map = new Map<string, { count: number; days: Set<string>; last: string }>();
    for (const m of userMessages) {
      if (!inWindow(m.timestamp, a, b)) continue;
      const id = canonical(m.user_id),
        date = String(m.timestamp);
      const entry = map.get(id) ?? { count: 0, days: new Set<string>(), last: date };
      entry.count += numeric(m.count) || 1;
      entry.days.add(day(date));
      if (timestamp(date) > timestamp(entry.last)) entry.last = date;
      map.set(id, entry);
    }
    return map;
  };
  const currentActivity = activity(start, end),
    previousActivity = activity(previousStart, start);
  const currentPayments = successful.filter((p) => inWindow(paymentTime(p))),
    previousPayments = successful.filter((p) => inWindow(paymentTime(p), previousStart, start));
  const currentOpened = new Set(opened.filter((e) => inWindow(e.created_at)).map((e) => canonical(e.user_id)));
  const paidEver = new Set(successful.filter((p) => timestamp(paymentTime(p)) < end).map((p) => canonical(p.user_id)));
  const newUsers = users.filter((u) => inWindow(u.created_at));
  const previousUsers = users.filter((u) => inWindow(u.created_at, previousStart, start));
  const details: DashboardUser[] = users.map((u) => {
    const id = String(u.id),
      a = currentActivity.get(id);
    return {
      id,
      name: u.name ? String(u.name) : null,
      email: u.email ? String(u.email) : null,
      signup: String(u.created_at),
      source: sourceByUser.get(id) ?? 'Unknown',
      messages: input.messages ? (a?.count ?? 0) : null,
      activeDays: input.messages ? (a?.days.size ?? 0) : null,
      lastActive: a?.last ?? null,
      paid: input.payments ? paidEver.has(id) : null,
      revenue: input.payments
        ? currentPayments.filter((p) => canonical(p.user_id) === id).reduce((sum, p) => sum + numeric(p.amount), 0)
        : null,
      isNew: inWindow(u.created_at),
      opened: input.events ? currentOpened.has(id) : null,
    };
  });
  const kpi = (value: number, previous: number, available = true): Metric => ({
    value: available ? value : null,
    previous: available ? previous : null,
  });
  const newActive = newUsers.filter((u) => currentActivity.has(String(u.id))).length;
  const prevNewActive = previousUsers.filter((u) => previousActivity.has(String(u.id))).length;
  const newPaid = new Set(
    currentPayments.map((p) => canonical(p.user_id)).filter((id) => newUsers.some((u) => String(u.id) === id)),
  );
  const previousPaid = new Set(
    previousPayments.map((p) => canonical(p.user_id)).filter((id) => previousUsers.some((u) => String(u.id) === id)),
  );
  const metrics = {
    totalUsers: kpi(users.length, users.filter((u) => timestamp(u.created_at) < start).length),
    paymentOpened: kpi(
      currentOpened.size,
      new Set(opened.filter((e) => inWindow(e.created_at, previousStart, start)).map((e) => canonical(e.user_id))).size,
      !!input.events,
    ),
    newUserMessages: {
      value: input.messages
        ? ratio(
            newUsers.reduce((sum, u) => sum + (currentActivity.get(String(u.id))?.count ?? 0), 0),
            newUsers.length,
          )
        : null,
      previous: input.messages
        ? ratio(
            previousUsers.reduce((sum, u) => sum + (previousActivity.get(String(u.id))?.count ?? 0), 0),
            previousUsers.length,
          )
        : null,
    },
    newUsers: kpi(newUsers.length, previousUsers.length),
    engagedNewUsers: kpi(
      newUsers.filter((u) => (currentActivity.get(String(u.id))?.count ?? 0) >= ENGAGED_NEW_MESSAGES).length,
      previousUsers.filter((u) => (previousActivity.get(String(u.id))?.count ?? 0) >= ENGAGED_NEW_MESSAGES).length,
      !!input.messages,
    ),
    activeUsers: kpi(currentActivity.size, previousActivity.size, !!input.messages),
    returningUsers: kpi(
      details.filter((u) => !u.isNew && (u.messages ?? 0) > 0).length,
      [...previousActivity.keys()].filter((id) => timestamp(byIdentity.get(id)?.created_at) < previousStart).length,
      !!input.messages,
    ),
    paidUsers: kpi(
      new Set(currentPayments.map((p) => canonical(p.user_id))).size,
      new Set(previousPayments.map((p) => canonical(p.user_id))).size,
      !!input.payments,
    ),
    revenue: kpi(
      currentPayments.reduce((sum, p) => sum + numeric(p.amount), 0),
      previousPayments.reduce((sum, p) => sum + numeric(p.amount), 0),
      !!input.payments,
    ),
    messages: kpi(
      [...currentActivity.values()].reduce((s, a) => s + a.count, 0),
      [...previousActivity.values()].reduce((s, a) => s + a.count, 0),
      !!input.messages,
    ),
    activation: {
      value: input.messages ? ratio(newActive, newUsers.length) : null,
      previous: input.messages ? ratio(prevNewActive, previousUsers.length) : null,
    },
    paidConversion: {
      value: input.payments ? ratio(newPaid.size, newUsers.length) : null,
      previous: input.payments ? ratio(previousPaid.size, previousUsers.length) : null,
    },
  };
  // One point per UTC day. Weekly buckets keep long ranges legible without dropping data.
  const bucketDays = end - start > 100 * DAY ? 7 : 1;
  const buckets = new Map<
    string,
    { date: string; signups: number; active: Set<string>; messages: number; revenue: number }
  >();
  const bucketKey = (value: unknown) =>
    new Date(start + Math.floor((timestamp(value) - start) / (bucketDays * DAY)) * bucketDays * DAY)
      .toISOString()
      .slice(0, 10);
  for (let t = start; t < end; t += bucketDays * DAY) {
    const date = day(new Date(t).toISOString());
    buckets.set(date, { date, signups: 0, active: new Set(), messages: 0, revenue: 0 });
  }
  for (const u of newUsers) buckets.get(bucketKey(u.created_at))!.signups++;
  for (const m of userMessages.filter((m) => inWindow(m.timestamp))) {
    const b = buckets.get(bucketKey(m.timestamp))!;
    b.messages += numeric(m.count) || 1;
    b.active.add(canonical(m.user_id));
  }
  for (const p of currentPayments) buckets.get(bucketKey(paymentTime(p)))!.revenue += numeric(p.amount);
  const daily = [...buckets.values()].map((b) => ({
    date: b.date,
    signups: b.signups,
    active: input.messages ? b.active.size : null,
    messages: input.messages ? b.messages : null,
    revenue: input.payments ? b.revenue : null,
  }));
  const channels = [...new Set(details.filter((u) => u.isNew).map((u) => u.source))]
    .map((source) => {
      const cohort = details.filter((u) => u.isNew && u.source === source);
      return {
        source,
        users: cohort.length,
        activated: input.messages ? cohort.filter((u) => (u.messages ?? 0) > 0).length : null,
        returned: input.messages ? cohort.filter((u) => (u.activeDays ?? 0) >= 2).length : null,
        paid: input.payments ? cohort.filter((u) => newPaid.has(u.id)).length : null,
        revenue: input.payments ? cohort.reduce((s, u) => s + (u.revenue ?? 0), 0) : null,
      };
    })
    .sort((a, b) => b.users - a.users);
  const signupDetails = details.filter((u) => u.isNew);
  const funnel = [
    { key: 'new', label: 'Signed up', count: newUsers.length, definition: 'External accounts created in this window.' },
    {
      key: 'activated',
      label: 'First message',
      count: input.messages ? newActive : null,
      definition: 'New signups who sent at least one message in this window.',
    },
    {
      key: 'engaged',
      label: 'Engaged',
      count: input.messages ? signupDetails.filter((u) => (u.messages ?? 0) >= 5).length : null,
      definition: 'New signups who sent at least five messages in this window.',
    },
    {
      key: 'repeat',
      label: 'Came back',
      count: input.messages
        ? signupDetails.filter((u) => (u.messages ?? 0) >= 5 && (u.activeDays ?? 0) >= 2).length
        : null,
      definition: 'Engaged new signups active on at least two distinct UTC days.',
    },
  ];
  const cohorts = new Map<string, Row[]>();
  for (const u of newUsers) {
    const t = timestamp(u.created_at);
    const date = new Date(t);
    const dow = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - ((dow + 6) % 7));
    const key = day(date.toISOString());
    cohorts.set(key, [...(cohorts.get(key) ?? []), u]);
  }
  const activityDays = new Map<string, Set<string>>();
  for (const m of userMessages) {
    const id = canonical(m.user_id);
    const set = activityDays.get(id) ?? new Set();
    set.add(day(m.timestamp));
    activityDays.set(id, set);
  }
  const retention = [...cohorts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, cohort]) => ({
      week,
      users: cohort.length,
      cells: [
        1,
        7,
        14,
        30,
      ].map((n) => {
        const eligible = cohort.filter(
          (u) => timestamp(day(u.created_at)) + (n + 1) * DAY <= Math.min(end, Date.now()),
        );
        const retained = eligible.filter((u) =>
          activityDays.get(String(u.id))?.has(day(new Date(timestamp(day(u.created_at)) + n * DAY).toISOString())),
        ).length;
        return {
          day: n,
          eligible: eligible.length,
          retained,
          rate: input.messages ? ratio(retained, eligible.length) : null,
        };
      }),
    }));
  const segments = [
    { key: 'all', label: 'Registered users', count: details.length },
    { key: 'new', label: 'New signups', count: newUsers.length },
    { key: 'active', label: 'Active', count: input.messages ? currentActivity.size : null },
    {
      key: 'returning',
      label: 'Returning',
      count: input.messages ? details.filter((u) => !u.isNew && (u.messages ?? 0) > 0).length : null,
    },
    { key: 'inactive', label: 'Inactive', count: input.messages ? details.filter((u) => !u.messages).length : null },
    { key: 'paid', label: 'Ever paid', count: input.payments ? paidEver.size : null },
    { key: 'free', label: 'Never paid', count: input.payments ? details.length - paidEver.size : null },
  ];
  const distribution = [
    { label: 'No messages', min: 0, max: 0 },
    { label: '1–4 messages', min: 1, max: 4 },
    { label: '5–19 messages', min: 5, max: 19 },
    { label: '20–99 messages', min: 20, max: 99 },
    { label: '100+ messages', min: 100, max: Infinity },
  ].map((b) => ({
    ...b,
    count: input.messages ? details.filter((u) => u.messages! >= b.min && u.messages! <= b.max).length : null,
    max: Number.isFinite(b.max) ? b.max : null,
  }));
  return {
    generatedAt: new Date().toISOString(),
    from,
    to,
    previousFrom: day(new Date(previousStart).toISOString()),
    previousTo: day(new Date(start - DAY).toISOString()),
    bucketDays,
    metrics,
    daily,
    channels,
    funnel,
    retention,
    segments,
    distribution,
    paymentOpened: input.events ? signupDetails.filter((u) => u.opened).length : null,
    newPaid: input.payments ? newPaid.size : null,
    messagesPerActive: input.messages ? ratio(metrics.messages.value!, currentActivity.size) : null,
    repeatActive: input.messages
      ? ratio(details.filter((u) => (u.activeDays ?? 0) >= 2).length, currentActivity.size)
      : null,
    warnings: input.warnings,
    details,
  };
}

export function matchesSegment(u: DashboardUser, segment: string) {
  switch (segment) {
    case 'new':
      return u.isNew;
    case 'active':
      return u.messages !== null && u.messages > 0;
    case 'activated':
      return u.isNew && u.messages !== null && u.messages > 0;
    case 'engaged':
      return u.isNew && u.messages !== null && u.messages >= 5;
    case 'engaged-new':
      return u.isNew && u.messages !== null && u.messages >= ENGAGED_NEW_MESSAGES;
    case 'repeat':
      return u.isNew && u.messages !== null && u.messages >= 5 && u.activeDays !== null && u.activeDays >= 2;
    case 'returning':
      return !u.isNew && u.messages !== null && u.messages > 0;
    case 'inactive':
      return u.messages === 0;
    case 'paid':
      return u.paid === true;
    case 'opened':
      return u.opened === true;
    case 'free':
      return u.paid === false;
    default:
      return true;
  }
}

export type DashboardData = Omit<ReturnType<typeof aggregateDashboard>, 'details'>;
