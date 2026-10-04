import { NextRequest, NextResponse } from 'next/server';
import { requireAnalyticsPermission, writeAnalyticsAudit } from '@/lib/analyticsAccess';

const MAX_MESSAGES = 500;

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redacted]')
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, '[phone redacted]')
    .replace(/\b(?:sk|pk|rk|AIza)[-_A-Za-z0-9]{16,}\b/g, '[secret redacted]')
    .replace(/\b\d{12,19}\b/g, '[number redacted]');
}

export async function GET(request: NextRequest) {
  const metadataAuth = await requireAnalyticsPermission(request, 'conversations.view_metadata');
  if (!metadataAuth.ok) return NextResponse.json({ error: metadataAuth.message }, { status: metadataAuth.status });

  const targetUserId = String(request.nextUrl.searchParams.get('userId') ?? '').trim();
  const reason = String(request.nextUrl.searchParams.get('reason') ?? '').trim().slice(0, 240);
  if (!targetUserId) return NextResponse.json({ error: 'Missing userId.' }, { status: 400 });
  if (reason.length < 3) return NextResponse.json({ error: 'A review reason is required.' }, { status: 400 });

  const fullAuth = await requireAnalyticsPermission(request, 'conversations.view_full');
  const canViewFull = fullAuth.ok;
  const contentAuth = canViewFull
    ? fullAuth
    : await requireAnalyticsPermission(request, 'conversations.view_redacted');
  if (!contentAuth.ok) return NextResponse.json({ error: contentAuth.message }, { status: contentAuth.status });

  const { data: user, error: userError } = await contentAuth.supabase
    .from('users')
    .select('id, auth_id, email, name, created_at')
    .eq('id', targetUserId)
    .maybeSingle();

  if (userError || !user?.auth_id) return NextResponse.json({ error: 'User was not found.' }, { status: 404 });

  const { data: rows, error: messagesError } = await contentAuth.supabase
    .from('messages')
    .select('message_id, content_type, content, timestamp, session_id, model, message_type, is_call')
    .eq('user_id', user.auth_id)
    .order('timestamp', { ascending: false, nullsFirst: false })
    .limit(MAX_MESSAGES);

  if (messagesError) return NextResponse.json({ error: 'Unable to load conversations.' }, { status: 500 });

  const audited = await writeAnalyticsAudit(contentAuth, {
    action: canViewFull ? 'conversations.view_full' : 'conversations.view_redacted',
    targetUserId,
    reason,
    metadata: { message_count: rows?.length ?? 0, truncated_at: MAX_MESSAGES },
  });
  if (!audited) return NextResponse.json({ error: 'Conversation access was not returned because auditing failed.' }, { status: 500 });

  const messages = (rows ?? []).map((row) => ({
    ...row,
    content: canViewFull ? row.content : redactSensitiveText(String(row.content ?? '')),
  }));

  return NextResponse.json(
    {
      access_mode: canViewFull ? 'full' : 'redacted',
      user,
      messages,
      truncated: messages.length >= MAX_MESSAGES,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
