-- Applied to MeeraDb using the connected Supabase migration tool.
-- Existing Cashfree records retain INR; Stripe writes USD explicitly.
alter table public.payments add column if not exists currency text not null default 'INR';
