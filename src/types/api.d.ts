import { GoogleGenAI } from '@google/genai';

export interface MeeraCallResponse {
  message: string;
  token: string;
  room_name: string;
}

export interface StartCallRequest {
  is_call: boolean;
  session_id?: string;
  model?: string;
  device_info?: Record<string, unknown>;
  location_info?: Record<string, unknown>;
  network_info?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  message: string;
  status: number;
  code: string;
  data?: unknown;
}

export interface PaymentCustomerDetails {
  customer_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
}

export interface CreatePaymentRequest {
  plan_type: 'monthly' | 'lifetime';
  amount?: number;
  order_currency?: string;
  customer_details?: Partial<PaymentCustomerDetails>;
  coupon_code?: string;
}

export interface VerifyPaymentRequest {
  order_id: string;
  plan_type?: 'monthly' | 'lifetime';
  referral_id?: string;
}

export interface CreatePaymentResponse {
  message: string;
  data: {
    order_id: string;
    payment_session_id: string | null;
    payment_status?: string;
  };
}

export interface VerifyPaymentResponse {
  message: string;
  data: {
    payment_status: string;
    subscription_end_date: string;
  };
}

export interface SubscriptionStatusResponse {
  subscription_end_date: string | null;
  talktime_left: number;
  tokens_left: number;
  message: string;
  plan_type?: string;
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

export interface DeductTalktimeRequest {
  call_duration: number;
}

export interface DeductTalktimeResponse {
  message: string;
}

export interface TrackingModalRequest {
  referral_id?: string;
}

export interface LiveClientOptions {
  apiKey: string;
  client?: GoogleGenAI;
}

export interface MeeraConfigResponse {
  system_prompt: string;
  model_name: string;
  max_tokens: number;
  temperature: number;
  thinking: boolean;
  google_search: boolean;
  chat_history: {
    content: string;
    content_type: 'user' | 'assistant';
  }[];
}
