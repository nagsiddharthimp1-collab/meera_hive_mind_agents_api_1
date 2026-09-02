import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ALLOWED_EVENT_NAMES = new Set(['payment_page_opened']);

function getBearerToken(request: NextRequest): string {
  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice('bearer '.length).trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      event_name?: string;
      user_id?: string | null;
      metadata?: Record<string, unknown>;
      source?: string;
    };

    const eventName = String(body.event_name ?? '').trim();
    if (!ALLOWED_EVENT_NAMES.has(eventName)) {
      return NextResponse.json({ error: 'Unsupported event_name' }, { status: 400 });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ accepted: false, reason: 'missing_supabase_env' }, { status: 202 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    let resolvedUserId = typeof body.user_id === 'string' ? body.user_id.trim() : '';

    if (!resolvedUserId) {
      const bearerToken = getBearerToken(request);
      if (bearerToken) {
        const { data } = await supabase.auth.getUser(bearerToken);
        const authUserId = data.user?.id ?? '';
        if (authUserId) resolvedUserId = authUserId;
      }
    }

    const payload = {
      event_name: eventName,
      user_id: resolvedUserId || null,
      source: String(body.source ?? 'analytics_route').slice(0, 100),
      metadata: body.metadata ?? {},
      created_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('analytics_events').insert(payload);

    if (error) {
      return NextResponse.json(
        {
          accepted: false,
          reason: 'insert_failed',
          details: error.message,
        },
        { status: 202 },
      );
    }

    return NextResponse.json({ accepted: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        accepted: false,
        reason: 'invalid_payload',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }
}
