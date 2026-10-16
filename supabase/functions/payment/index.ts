import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clearEffectiveAccessCacheByPublicUserId } from "../_shared/access.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const CASHFREE_APP_ID = Deno.env.get("CASHFREE_APP_ID") ?? Deno.env.get("CASHFREE_CLIENT_ID");
const CASHFREE_SECRET_KEY = Deno.env.get("CASHFREE_SECRET_KEY") ?? Deno.env.get("CASHFREE_CLIENT_SECRET");
const CASHFREE_API_VERSION = Deno.env.get("CASHFREE_API_VERSION") || "2022-09-01";
const CASHFREE_WEBHOOK_SECRET = Deno.env.get("CASHFREE_WEBHOOK_SECRET") ?? CASHFREE_SECRET_KEY;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MONTHLY_PLAN_DAYS = Number(Deno.env.get("MONTHLY_PLAN_DAYS") ?? "30");
const WEBHOOK_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;
const WEBHOOK_DEDUPE_TTL_MS = 60 * 60 * 1000;

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

const processedWebhookEvents = new Map<string, number>();
const BYPASS_COUPON_CODES = new Set(
  String(Deno.env.get("PAYMENT_BYPASS_CODES") ?? "BYPASS")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
);
if (BYPASS_COUPON_CODES.size === 0) {
  BYPASS_COUPON_CODES.add("BYPASS");
}

type PlanType = "monthly" | "lifetime";
type PaymentStatus = "active" | "pending" | "failed";

type CreatePaymentPayload = {
  order_id?: string;
  order_amount?: number;
  amount?: number;
  order_currency?: string;
  currency?: string;
  plan_type?: string;
  coupon_code?: string;
  customer_details?: {
    customer_id?: string;
    customer_email?: string;
    customer_phone?: string;
    customer_name?: string;
  };
  customer_id?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_name?: string;
  return_url?: string;
  metadata?: Record<string, unknown>;
};

type VerifyPaymentPayload = {
  order_id?: string;
  plan_type?: string;
};

type AuthContext = {
  authUserId: string | null;
  email: string | null;
  name: string | null;
};

type WebhookPayload = Record<string, unknown>;

type WebhookOrderDetails = {
  orderId: string;
  paymentStatus: PaymentStatus;
  planType: PlanType | null;
  customerUserId: string | null;
  customerEmail: string | null;
  customerName: string | null;
  paymentDate: string;
};

function jsonResponse(body: unknown, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function toPositiveNumberOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function normalizePlanType(planType?: string | null): PlanType | null {
  const normalized = String(planType ?? "").trim().toLowerCase();
  if (normalized === "monthly" || normalized === "lifetime") return normalized;
  return null;
}

function getAmountFromPlan(planType?: string): number | null {
  const normalized = normalizePlanType(planType);
  if (normalized === "monthly") return 129;
  if (normalized === "lifetime") return 499;
  return null;
}

function buildOrderId(orderId?: string): string {
  if (typeof orderId === "string" && orderId.trim()) return orderId.trim();
  return `ord_${crypto.randomUUID().replaceAll("-", "")}`;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (_e) {
    return null;
  }
}

function normalizeCashfreeStatus(status: unknown): PaymentStatus {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "PAID" || normalized === "SUCCESS") return "active";
  if (normalized === "PENDING" || normalized === "ACTIVE" || normalized === "INCOMPLETE") return "pending";
  return "failed";
}

function dbPaymentStatusFromCashfree(status: PaymentStatus): "paid" | "pending" | "failed" {
  if (status === "active") return "paid";
  if (status === "pending") return "pending";
  return "failed";
}

function addDaysIso(days: number, startDate = new Date()): string {
  const d = new Date(startDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function extractBearerToken(req: Request): string {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice("bearer ".length).trim();
}

function getStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeCouponCode(couponCode: unknown): string | null {
  const normalized = getStringValue(couponCode);
  return normalized ? normalized.toUpperCase() : null;
}

function isBypassCouponCode(couponCode: string | null): boolean {
  if (!couponCode) return false;
  return BYPASS_COUPON_CODES.has(couponCode);
}

function getRecordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getOrderCustomerId(order: Record<string, unknown>): string | null {
  const details = getRecordValue(order.customer_details);
  if (!details) return null;
  return getStringValue(details.customer_id);
}

function getOrderCustomerEmail(order: Record<string, unknown>): string | null {
  const details = getRecordValue(order.customer_details);
  if (!details) return null;
  return getStringValue(details.customer_email);
}

function getOrderCustomerName(order: Record<string, unknown>): string | null {
  const details = getRecordValue(order.customer_details);
  if (!details) return null;
  return getStringValue(details.customer_name);
}

function getPlanTypeFromOrder(order: Record<string, unknown>): PlanType | null {
  const planFromNote = getStringValue(order.order_note);
  if (planFromNote) {
    const normalized = planFromNote.toLowerCase();
    if (normalized.includes("monthly")) return "monthly";
    if (normalized.includes("lifetime")) return "lifetime";
  }

  const tags = getRecordValue(order.order_tags);
  if (tags) {
    const tagPlan = getStringValue(tags.plan_type);
    const normalized = normalizePlanType(tagPlan);
    if (normalized) return normalized;
  }

  return null;
}

function normalizeWebhookTimestamp(timestampHeader: string): number | null {
  const raw = timestampHeader.trim();
  if (!raw) return null;

  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  // Cashfree sends epoch millis; tolerate seconds defensively.
  const epochMs = raw.length <= 10 ? Math.round(numeric * 1000) : Math.round(numeric);
  if (!Number.isFinite(epochMs) || epochMs <= 0) return null;

  return epochMs;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function computeWebhookSignature(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const signatureData = encoder.encode(`${timestamp}${rawBody}`);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, signatureData);
  return toBase64(new Uint8Array(signature));
}

function cleanExpiredWebhookDedupeEntries(nowMs: number): void {
  for (const [key, ts] of processedWebhookEvents.entries()) {
    if (nowMs - ts > WEBHOOK_DEDUPE_TTL_MS) {
      processedWebhookEvents.delete(key);
    }
  }
}

function checkAndRememberWebhookEvent(eventKey: string): boolean {
  const nowMs = Date.now();
  cleanExpiredWebhookDedupeEntries(nowMs);

  const seenAt = processedWebhookEvents.get(eventKey);
  if (seenAt && nowMs - seenAt <= WEBHOOK_DEDUPE_TTL_MS) {
    return true;
  }

  processedWebhookEvents.set(eventKey, nowMs);
  return false;
}

async function verifyWebhookRequestSignature(
  req: Request,
  rawBody: string,
): Promise<{ ok: boolean; reason: string; timestamp: string | null }> {
  if (!CASHFREE_WEBHOOK_SECRET) {
    return { ok: false, reason: "missing_webhook_secret", timestamp: null };
  }

  const signature = getStringValue(
    req.headers.get("x-webhook-signature") ?? req.headers.get("X-Webhook-Signature"),
  );
  const timestamp = getStringValue(
    req.headers.get("x-webhook-timestamp") ?? req.headers.get("X-Webhook-Timestamp"),
  );

  if (!signature || !timestamp) {
    return { ok: false, reason: "missing_signature_headers", timestamp: null };
  }

  const timestampMs = normalizeWebhookTimestamp(timestamp);
  if (!timestampMs) {
    return { ok: false, reason: "invalid_timestamp", timestamp };
  }

  if (Math.abs(Date.now() - timestampMs) > WEBHOOK_SIGNATURE_MAX_AGE_MS) {
    return { ok: false, reason: "stale_timestamp", timestamp };
  }

  const expectedSignature = await computeWebhookSignature(
    CASHFREE_WEBHOOK_SECRET,
    timestamp,
    rawBody,
  );

  if (!timingSafeEqual(expectedSignature, signature)) {
    return { ok: false, reason: "signature_mismatch", timestamp };
  }

  return { ok: true, reason: "ok", timestamp };
}

function extractOrderRecordFromWebhook(payload: WebhookPayload): Record<string, unknown> {
  const data = getRecordValue(payload.data);
  const order = getRecordValue(data?.order) ?? getRecordValue(payload.order);
  return order ?? {};
}

function extractPaymentRecordFromWebhook(payload: WebhookPayload): Record<string, unknown> {
  const data = getRecordValue(payload.data);
  const payment = getRecordValue(data?.payment) ?? getRecordValue(payload.payment);
  return payment ?? {};
}

function extractOrderIdFromWebhook(payload: WebhookPayload, order: Record<string, unknown>): string | null {
  return getStringValue(order.order_id) ??
    getStringValue(payload.order_id) ??
    getStringValue((getRecordValue(payload.data) ?? {}).order_id);
}

function buildWebhookEventKey(payload: WebhookPayload, fallbackOrderId: string | null): string {
  const idempotencyHeader = getStringValue(
    payload.__idempotency_header,
  );
  if (idempotencyHeader) return `idem:${idempotencyHeader}`;

  const eventId = getStringValue(payload.event_id) ??
    getStringValue(payload.eventId) ??
    getStringValue((getRecordValue(payload.data) ?? {}).event_id) ??
    getStringValue(extractPaymentRecordFromWebhook(payload).cf_payment_id) ??
    getStringValue(extractPaymentRecordFromWebhook(payload).payment_id);

  if (eventId) return `event:${eventId}`;

  const eventType = getStringValue(payload.type) ?? getStringValue(payload.event_type) ?? "unknown";
  const orderId = fallbackOrderId ?? "unknown";
  const eventTime = getStringValue(payload.event_time) ?? "unknown";
  return `fallback:${eventType}:${orderId}:${eventTime}`;
}

function deriveWebhookOrderDetails(payload: WebhookPayload): WebhookOrderDetails | null {
  const order = extractOrderRecordFromWebhook(payload);
  const payment = extractPaymentRecordFromWebhook(payload);
  const orderId = extractOrderIdFromWebhook(payload, order);
  if (!orderId) return null;

  const paymentStatus = normalizeCashfreeStatus(
    payment.payment_status ??
      payment.payment_status_text ??
      order.order_status ??
      payload.payment_status ??
      payload.order_status ??
      payload.type,
  );

  const planType = normalizePlanType(
    getStringValue(payment.plan_type) ??
      getStringValue(order.plan_type) ??
      getStringValue((getRecordValue(payload.data) ?? {}).plan_type),
  ) ?? getPlanTypeFromOrder(order);

  const customerUserId = getOrderCustomerId(order) ?? getStringValue(payment.customer_id);
  const customerEmail = getOrderCustomerEmail(order) ?? getStringValue(payment.customer_email);
  const customerName = getOrderCustomerName(order) ?? getStringValue(payment.customer_name);

  const paymentDate =
    getStringValue(payload.event_time) ??
    getStringValue(payment.payment_time) ??
    getStringValue(payment.payment_completion_time) ??
    new Date().toISOString();

  return {
    orderId,
    paymentStatus,
    planType,
    customerUserId,
    customerEmail,
    customerName,
    paymentDate,
  };
}

async function fetchCashfreeOrder(orderId: string): Promise<Record<string, unknown> | null> {
  if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) return null;

  const response = await fetch(`https://api.cashfree.com/pg/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": CASHFREE_APP_ID,
      "x-client-secret": CASHFREE_SECRET_KEY,
      "x-api-version": CASHFREE_API_VERSION,
    },
  });

  if (!response.ok) {
    return null;
  }

  const body = await response.json();
  return getRecordValue(body) ?? null;
}

async function getAuthContext(req: Request): Promise<AuthContext> {
  if (!supabase) {
    return { authUserId: null, email: null, name: null };
  }

  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    return { authUserId: null, email: null, name: null };
  }

  const { data, error } = await supabase.auth.getUser(bearerToken);
  if (error || !data?.user?.id) {
    return { authUserId: null, email: null, name: null };
  }

  const metadata = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const nameFromMetadata = getStringValue(metadata.full_name) ?? getStringValue(metadata.name);

  return {
    authUserId: data.user.id,
    email: data.user.email ?? null,
    name: nameFromMetadata,
  };
}

async function findPublicUserIdByAuthId(authUserId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("auth_id", authUserId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("findPublicUserIdByAuthId failed:", error.message);
    return null;
  }
  return getStringValue(data?.id);
}

async function findPublicUserIdById(userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("findPublicUserIdById failed:", error.message);
    return null;
  }
  return getStringValue(data?.id);
}

async function createUserRow(
  userId: string,
  authId: string | null,
  email: string | null,
  name: string | null,
): Promise<string | null> {
  if (!supabase) return null;

  const now = new Date().toISOString();
  const { error } = await supabase.from("users").insert({
    id: userId,
    auth_id: authId,
    email,
    name,
    created_at: now,
    updated_at: now,
    deleted: false,
  });

  if (error) {
    console.warn("createUserRow failed:", error.message);
  }

  return await findPublicUserIdById(userId);
}

async function resolvePublicUserId(params: {
  authUserId: string | null;
  customerUserId: string | null;
  email: string | null;
  name: string | null;
}): Promise<string | null> {
  const { authUserId, customerUserId, email, name } = params;

  if (customerUserId) {
    const foundById = await findPublicUserIdById(customerUserId);
    if (foundById) return foundById;

    const foundByAuth = await findPublicUserIdByAuthId(customerUserId);
    if (foundByAuth) return foundByAuth;
  }

  if (authUserId) {
    const foundByAuth = await findPublicUserIdByAuthId(authUserId);
    if (foundByAuth) return foundByAuth;

    const foundById = await findPublicUserIdById(authUserId);
    if (foundById) return foundById;

    const created = await createUserRow(authUserId, authUserId, email, name);
    if (created) return created;
  }

  if (customerUserId) {
    return await createUserRow(customerUserId, null, email, name);
  }

  return null;
}

async function persistPaymentSnapshot(params: {
  orderId: string;
  order: Record<string, unknown>;
  paymentStatus: PaymentStatus;
  planType: PlanType | null;
  publicUserId: string;
  paymentDate?: string;
  couponCode?: string | null;
}): Promise<void> {
  if (!supabase) return;

  const amount = toPositiveNumberOrNull(params.order.order_amount);
  const couponCode = getStringValue(params.couponCode) ?? getStringValue(params.order.coupon_code);
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("payments").upsert(
    {
      payment_id: params.orderId,
      user_id: params.publicUserId,
      payment_date: getStringValue(params.paymentDate) ?? nowIso,
      amount: amount === null ? null : Math.round(amount),
      plan_type: params.planType,
      order_id: params.orderId,
      coupon_code: couponCode,
      payment_method: "cashfree",
      payment_status: dbPaymentStatusFromCashfree(params.paymentStatus),
      created_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "payment_id" },
  );

  if (error) {
    throw new Error(`Failed to persist payment snapshot: ${error.message}`);
  }

  clearEffectiveAccessCacheByPublicUserId(params.publicUserId);
}

async function handleVerifyPayment(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        Allow: "POST, OPTIONS",
      },
    });
  }

  if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
    return jsonResponse(
      {
        error: "Missing Cashfree credentials. Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY.",
      },
      corsHeaders,
      500,
    );
  }

  let verifyPayload: VerifyPaymentPayload;
  try {
    verifyPayload = await req.json() as VerifyPaymentPayload;
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON body." }, corsHeaders, 400);
  }

  const orderId = typeof verifyPayload.order_id === "string" ? verifyPayload.order_id.trim() : "";
  if (!orderId) {
    return jsonResponse({ error: "order_id is required." }, corsHeaders, 400);
  }

  const order = await fetchCashfreeOrder(orderId);
  if (!order) {
    return jsonResponse(
      {
        error: "Cashfree verification failed.",
        status: 502,
      },
      corsHeaders,
      502,
    );
  }

  const paymentStatus = normalizeCashfreeStatus(order.order_status);
  const resolvedPlanType = getPlanTypeFromOrder(order) ??
    (Number(order.order_amount) === 499 ? "lifetime" :
      (Number(order.order_amount) === 129 || Number(order.order_amount) === 1) ? "monthly" : null);
  if (!resolvedPlanType) {
    return jsonResponse({ error: "Order does not identify a supported access plan." }, corsHeaders, 422);
  }
  const authContext = await getAuthContext(req);
  const customerUserId = getOrderCustomerId(order);
  const publicUserId = await resolvePublicUserId({
    authUserId: authContext.authUserId,
    customerUserId,
    email: authContext.email,
    name: authContext.name,
  });

  if (paymentStatus === "active" && !publicUserId) {
    return jsonResponse(
      {
        error: "Verified payment could not be linked to a user profile.",
      },
      corsHeaders,
      422,
    );
  }

  if (publicUserId) {
    try {
      await persistPaymentSnapshot({
        orderId,
        order,
        paymentStatus,
        planType: resolvedPlanType,
        publicUserId,
      });
    } catch (persistError) {
      return jsonResponse(
        {
          error: "Payment verified but failed to persist subscription state.",
          details: persistError instanceof Error ? persistError.message : String(persistError),
        },
        corsHeaders,
        500,
      );
    }
  }

  const subscriptionEndDate = paymentStatus === "active" && resolvedPlanType === "monthly"
    ? addDaysIso(MONTHLY_PLAN_DAYS)
    : null;

  return jsonResponse(
    {
      success: true,
      message: "Order status verified successfully.",
      data: {
        order_id: String(order.order_id ?? orderId),
        payment_status: paymentStatus,
        cashfree_order_status: order.order_status ?? null,
        plan_type: resolvedPlanType,
        subscription_end_date: subscriptionEndDate,
      },
      subscription: {
        status: paymentStatus,
        subscription_end_date: subscriptionEndDate,
        plan_type: resolvedPlanType,
      },
    },
    corsHeaders,
    200,
  );
}

async function handleWebhook(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        Allow: "POST, OPTIONS",
      },
    });
  }

  if (!CASHFREE_WEBHOOK_SECRET) {
    return jsonResponse(
      {
        error: "Missing Cashfree webhook secret. Set CASHFREE_WEBHOOK_SECRET or CASHFREE_SECRET_KEY.",
      },
      corsHeaders,
      500,
    );
  }

  const rawBody = await req.text();
  const signatureCheck = await verifyWebhookRequestSignature(req, rawBody);
  if (!signatureCheck.ok) {
    return jsonResponse(
      {
        error: "Invalid webhook signature.",
        reason: signatureCheck.reason,
      },
      corsHeaders,
      400,
    );
  }

  const parsed = safeJsonParse(rawBody);
  const payload = getRecordValue(parsed);
  if (!payload) {
    return jsonResponse({ error: "Invalid webhook payload." }, corsHeaders, 400);
  }

  const idempotencyHeader = getStringValue(
    req.headers.get("x-idempotency-header") ??
      req.headers.get("x-idempotency-key") ??
      req.headers.get("X-Idempotency-Header") ??
      req.headers.get("X-Idempotency-Key"),
  );
  const payloadWithHeaders = {
    ...payload,
    __idempotency_header: idempotencyHeader,
  } as WebhookPayload;

  const webhookDetails = deriveWebhookOrderDetails(payloadWithHeaders);
  if (!webhookDetails) {
    // Support test webhooks and non-order events without failing retries.
    return jsonResponse(
      {
        success: true,
        ignored: true,
        reason: "missing_order_id",
      },
      corsHeaders,
      200,
    );
  }

  const eventKey = buildWebhookEventKey(payloadWithHeaders, webhookDetails.orderId);
  if (checkAndRememberWebhookEvent(eventKey)) {
    return jsonResponse(
      {
        success: true,
        duplicate: true,
        event_key: eventKey,
      },
      corsHeaders,
      200,
    );
  }

  const authoritativeOrder = await fetchCashfreeOrder(webhookDetails.orderId);
  const order = authoritativeOrder ?? extractOrderRecordFromWebhook(payloadWithHeaders);
  const paymentStatus = authoritativeOrder
    ? normalizeCashfreeStatus(authoritativeOrder.order_status)
    : webhookDetails.paymentStatus;
  const planType = normalizePlanType(getStringValue(order.plan_type)) ??
    getPlanTypeFromOrder(order) ??
    webhookDetails.planType;

  const customerUserId = getOrderCustomerId(order) ?? webhookDetails.customerUserId;
  const customerEmail = getOrderCustomerEmail(order) ?? webhookDetails.customerEmail;
  const customerName = getOrderCustomerName(order) ?? webhookDetails.customerName;

  const publicUserId = await resolvePublicUserId({
    authUserId: null,
    customerUserId,
    email: customerEmail,
    name: customerName,
  });

  if (paymentStatus === "active" && !publicUserId) {
    return jsonResponse(
      {
        error: "Verified webhook could not be linked to a user profile.",
      },
      corsHeaders,
      422,
    );
  }

  if (publicUserId) {
    try {
      await persistPaymentSnapshot({
        orderId: webhookDetails.orderId,
        order,
        paymentStatus,
        planType,
        publicUserId,
        paymentDate: webhookDetails.paymentDate,
      });
    } catch (persistError) {
      return jsonResponse(
        {
          error: "Webhook verified but failed to persist subscription state.",
          details: persistError instanceof Error ? persistError.message : String(persistError),
        },
        corsHeaders,
        500,
      );
    }
  }

  return jsonResponse(
    {
      success: true,
      message: "Webhook processed.",
      order_id: webhookDetails.orderId,
      payment_status: paymentStatus,
      plan_type: planType,
      linked_user: publicUserId,
      event_key: eventKey,
    },
    corsHeaders,
    200,
  );
}

async function handleCreatePayment(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        Allow: "POST, OPTIONS",
      },
    });
  }

  if (!CASHFREE_APP_ID || !CASHFREE_SECRET_KEY) {
    return jsonResponse(
      {
        error: "Missing Cashfree credentials. Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY.",
      },
      corsHeaders,
      500,
    );
  }

  let payload: CreatePaymentPayload;
  try {
    const { order_amount, customer_details, ...restPayload } = await req.json() as CreatePaymentPayload;
    payload = { ...restPayload, order_amount, customer_details };
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON body." }, corsHeaders, 400);
  }

  const normalizedCouponCode = normalizeCouponCode(payload.coupon_code);
  const bypassCouponApplied = isBypassCouponCode(normalizedCouponCode);
  const resolvedPlanType = normalizePlanType(payload.plan_type);

  if (resolvedPlanType !== "lifetime") {
    return jsonResponse({ error: "Only lifetime access is available for new purchases." }, corsHeaders, 400);
  }
  const requestedAmount = payload.order_amount ?? payload.amount;
  if (!bypassCouponApplied && requestedAmount !== undefined && Number(requestedAmount) !== 499) {
    return jsonResponse({ error: "Lifetime access costs INR 499." }, corsHeaders, 400);
  }
  const requestedCurrency = String(payload.order_currency ?? payload.currency ?? "INR").toUpperCase();
  if (requestedCurrency !== "INR") {
    return jsonResponse({ error: "Cashfree checkout accepts INR only." }, corsHeaders, 400);
  }
  const derivedAmount = bypassCouponApplied ? 0 : 499;
  if (!bypassCouponApplied && !derivedAmount) {
    return jsonResponse(
      {
        error:
          "Missing order amount. Provide order_amount/amount in POST body or a supported plan_type.",
      },
      corsHeaders,
      400,
    );
  }

  if (bypassCouponApplied && !resolvedPlanType) {
    return jsonResponse(
      {
        error: "Valid plan_type is required when using bypass coupon.",
      },
      corsHeaders,
      400,
    );
  }

  const orderId = buildOrderId(payload.order_id);
  const orderCurrency = "INR";
  const details = payload.customer_details ?? {};
  const customerId = String(details.customer_id ?? payload.customer_id ?? `cust_${Date.now()}`);
  const customerEmail = String(details.customer_email ?? payload.customer_email ?? "guest@example.com");
  const customerPhone = String(details.customer_phone ?? payload.customer_phone ?? "9999999999");
  const customerName = details.customer_name ?? payload.customer_name;
  const authContext = await getAuthContext(req);
  const publicUserId = await resolvePublicUserId({
    authUserId: authContext.authUserId,
    customerUserId: customerId,
    email: authContext.email,
    name: authContext.name,
  });

  if (bypassCouponApplied) {
    if (!publicUserId || !resolvedPlanType) {
      return jsonResponse(
        {
          error: "Bypass payment could not be linked to a user profile.",
        },
        corsHeaders,
        422,
      );
    }

    try {
      await persistPaymentSnapshot({
        orderId,
        order: {
          order_amount: 0,
          order_note: `Plan: ${String(resolvedPlanType)}`,
          coupon_code: normalizedCouponCode,
        },
        paymentStatus: "active",
        planType: resolvedPlanType,
        publicUserId,
        paymentDate: new Date().toISOString(),
        couponCode: normalizedCouponCode,
      });
    } catch (persistError) {
      return jsonResponse(
        {
          error: "Bypass payment applied but failed to persist subscription state.",
          details: persistError instanceof Error ? persistError.message : String(persistError),
        },
        corsHeaders,
        500,
      );
    }

    const subscriptionEndDate = resolvedPlanType === "monthly"
      ? addDaysIso(MONTHLY_PLAN_DAYS)
      : null;

    return jsonResponse({
      message: "Bypass coupon applied successfully.",
      payment_status: "paid",
      data: {
        order_id: orderId,
        payment_session_id: null,
        payment_status: "paid",
        coupon_code: normalizedCouponCode,
      },
      subscription_end_date: subscriptionEndDate,
    }, corsHeaders);
  }

  const orderTags = payload.metadata && typeof payload.metadata === "object"
    ? { ...(payload.metadata as Record<string, unknown>) }
    : {};
  if (normalizedCouponCode) {
    orderTags.coupon_code = normalizedCouponCode;
  }

  const cashfreePayload: Record<string, unknown> = {
    order_id: orderId,
    order_amount: derivedAmount,
    order_currency: orderCurrency,
    customer_details: {
      customer_id: customerId,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      ...(customerName ? { customer_name: String(customerName) } : {}),
    },
    ...(payload.return_url
      ? {
          order_meta: {
            return_url: String(payload.return_url),
          },
        }
      : {}),
    ...(payload.plan_type ? { order_note: `Plan: ${String(payload.plan_type)}` } : {}),
    ...(Object.keys(orderTags).length > 0 ? { order_tags: orderTags } : {}),
  };

  try {
    const response = await fetch("https://api.cashfree.com/pg/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET_KEY,
        "x-api-version": CASHFREE_API_VERSION,
      },
      body: JSON.stringify(cashfreePayload),
    });

    if (response.status !== 200) {
      const errorBody = await response.text();
      console.error(errorBody);
      return jsonResponse(
        {
          error: errorBody || "Cashfree order creation failed.",
          status: response.status,
        },
        corsHeaders,
        response.status,
      );
    }

    const bodyText = await response.text();
    const data = bodyText ? safeJsonParse(bodyText) : {};
    const dataObj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const paymentStatus = normalizeCashfreeStatus(dataObj.order_status);

    if (publicUserId) {
      try {
        await persistPaymentSnapshot({
          orderId: String(dataObj.order_id ?? orderId),
          order: {
            order_amount: derivedAmount,
            order_note: payload.plan_type ? `Plan: ${String(payload.plan_type)}` : null,
            coupon_code: normalizedCouponCode,
          },
          paymentStatus,
          planType: resolvedPlanType,
          publicUserId,
          couponCode: normalizedCouponCode,
        });
      } catch (persistError) {
        console.warn("Unable to persist pending payment snapshot:", persistError);
      }
    }

    return jsonResponse({
      message: "Order created successfully.",
      data: {
        order_id: dataObj.order_id ?? orderId,
        payment_session_id: dataObj.payment_session_id ?? null,
        payment_status: dataObj.order_status ?? "PENDING",
      },
    }, corsHeaders);
  } catch (error) {
    return jsonResponse(
      {
        error: "Payment function failed while creating Cashfree order.",
        details: error instanceof Error ? error.message : String(error),
      },
      corsHeaders,
      500,
    );
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const { pathname } = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (pathname.endsWith("/verify")) {
    return await handleVerifyPayment(req, corsHeaders);
  }

  if (pathname.endsWith("/webhook")) {
    return await handleWebhook(req, corsHeaders);
  }

  return await handleCreatePayment(req, corsHeaders);
});
