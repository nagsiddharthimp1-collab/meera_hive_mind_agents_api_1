export interface SubscriptionData {
  subscription_end_date: string | null;
  talktime_left: number;
  tokens_left: number;
  message?: string;
  plan_type: 'paid' | 'free_trial';
  is_paid_active?: boolean;
  access_type?: 'free_trial' | 'monthly' | 'lifetime';
  requires_payment_for_chat?: boolean;
  is_legacy_user?: boolean;
  paywall_enabled?: boolean;
  paywall_cutover_at?: string;
  cache_ttl_seconds?: number;
  free_chat_turn_gate_enabled?: boolean;
  free_chat_turn_limit?: number;
  free_chat_turns_used?: number;
  free_chat_turns_remaining?: number;
  free_chat_limit_reached?: boolean;
}
