import 'server-only';
import type { NetworkSnapshot } from '@/app/labs/network';
import { createClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';

export const getLabsNetwork = unstable_cache(
  async (): Promise<NetworkSnapshot | null> => {
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    try {
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.rpc('labs_registered_minds');
      if (
        error ||
        !data ||
        !Number.isSafeInteger(data.registeredMinds) ||
        data.registeredMinds < 0 ||
        typeof data.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(data.updatedAt))
      )
        return null;
      return { registeredMinds: data.registeredMinds, updatedAt: data.updatedAt };
    } catch {
      return null;
    }
  },
  ['labs-registered-minds-v1'],
  { revalidate: 300 },
);
