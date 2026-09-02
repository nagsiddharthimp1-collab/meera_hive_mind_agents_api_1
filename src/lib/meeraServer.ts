import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function getBearerToken(request: NextRequest): string {
  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice('bearer '.length).trim();
}

export function createSupabaseAdminClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
    },
  });
}

export async function requireAuthenticatedUser(
  request: NextRequest,
): Promise<
  | {
      ok: true;
      supabase: SupabaseClient;
      user: User;
    }
  | {
      ok: false;
      status: number;
      message: string;
    }
> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return {
      ok: false,
      status: 500,
      message: 'Missing server Supabase configuration.',
    };
  }

  const bearerToken = getBearerToken(request);
  if (!bearerToken) {
    return {
      ok: false,
      status: 401,
      message: 'Missing authorization token.',
    };
  }

  const { data, error } = await supabase.auth.getUser(bearerToken);
  if (error || !data.user) {
    return {
      ok: false,
      status: 401,
      message: 'Unauthorized.',
    };
  }

  return {
    ok: true,
    supabase,
    user: data.user,
  };
}

export function isAllowedAdminEmail(email: string | null | undefined): boolean {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return false;

  const explicitAdmins = new Set(
    (process.env.MEERA_ADMIN_EMAILS ?? process.env.ANALYTICS_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (explicitAdmins.has(normalized)) return true;

  const allowedDomain = (process.env.MEERA_ADMIN_EMAIL_DOMAIN ?? process.env.ANALYTICS_ALLOWED_EMAIL_DOMAIN ?? 'himeera.com')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');

  return normalized.endsWith(`@${allowedDomain}`);
}

export function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
