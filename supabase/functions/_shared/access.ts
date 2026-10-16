export const FREE_CHAT_TOKEN_LIMIT = 100000;
export const CURRENT_MONTHLY_PLAN_PRICE_INR = 129;
export const LEGACY_MONTHLY_PLAN_PRICE_INR = 1;
export const LIFETIME_PLAN_PRICE_INR = 499;
const ACCESS_CACHE_MAX_TTL_SECONDS = 60;
const DEFAULT_PAYWALL_CUTOVER_AT = "2026-05-14T12:27:00.000Z";

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
}

function parseCacheTtlSeconds(value: string | undefined): number {
  const raw = Number(value ?? "");
  if (!Number.isFinite(raw) || raw <= 0) {
    return ACCESS_CACHE_MAX_TTL_SECONDS;
  }
  return Math.min(ACCESS_CACHE_MAX_TTL_SECONDS, Math.round(raw));
}

function parseCutoverAt(value: string | undefined): {
  iso: string;
  ms: number;
} {
  const fallbackMs = Date.parse(DEFAULT_PAYWALL_CUTOVER_AT);
  const raw = typeof value === "string" ? value.trim() : "";
  const parsedMs = raw ? Date.parse(raw) : Number.NaN;
  if (!Number.isNaN(parsedMs)) {
    return { iso: new Date(parsedMs).toISOString(), ms: parsedMs };
  }
  return { iso: new Date(fallbackMs).toISOString(), ms: fallbackMs };
}

const PAYWALL_CUTOVER = parseCutoverAt(Deno.env.get("PAYWALL_CUTOVER_AT"));
export const PAYWALL_V1_ENABLED = parseBooleanEnv(
  Deno.env.get("PAYWALL_V1_ENABLED"),
  true,
);
export const LEGACY_UNPAID_ALLOWED = parseBooleanEnv(
  Deno.env.get("LEGACY_UNPAID_ALLOWED"),
  true,
);
export const ACCESS_CACHE_TTL_SECONDS = parseCacheTtlSeconds(
  Deno.env.get("ACCESS_CACHE_TTL_SECONDS"),
);
export const PAYWALL_CUTOVER_AT = PAYWALL_CUTOVER.iso;

export type AuthContext = {
  authUserId: string | null;
  email: string | null;
  name: string | null;
};

export type PublicUserProfile = {
  id: string;
  createdAt: string | null;
};

export type PaymentRow = {
  payment_id?: string | null;
  payment_status?: string | null;
  plan_type?: string | null;
  payment_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  amount?: number | string | null;
};

export type EffectiveAccess = {
  authUserId: string | null;
  publicUserId: string | null;
  publicUserCreatedAt: string | null;
  isPaidActive: boolean;
  accessType: "free_trial" | "monthly" | "lifetime";
  subscriptionEndDate: string | null;
  totalTokensUsed: number;
  remainingFreeTokens: number;
};

export type ChatAccessDecision =
  | "paid_active"
  | "legacy_unpaid_allowed"
  | "payment_required"
  | "paywall_disabled";

export type ChatAccessPolicy = {
  requiresPaymentForChat: boolean;
  isLegacyUser: boolean;
  paywallEnabled: boolean;
  legacyUnpaidAllowed: boolean;
  cutoverAt: string;
  cacheTtlSeconds: number;
  decision: ChatAccessDecision;
};

type EffectiveAccessCacheEntry = {
  cachedAtMs: number;
  value: EffectiveAccess;
};

const effectiveAccessCache = new Map<string, EffectiveAccessCacheEntry>();
const publicToAuthCache = new Map<string, string>();

export function getStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function extractBearerToken(req: Request): string {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice("bearer ".length).trim();
}

export function normalizePlanType(
  planType?: string | null,
): "monthly" | "lifetime" | null {
  const normalized = String(planType ?? "").trim().toLowerCase();
  if (normalized === "monthly" || normalized === "lifetime") return normalized;
  return null;
}

export function addDaysIso(days: number, startDate: Date): string {
  const d = new Date(startDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function normalizeAmount(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function normalizePaymentStatus(status: unknown): string {
  return String(status ?? "").trim().toLowerCase();
}

function isGrantStatus(status: string): boolean {
  return status === "paid" || status === "active" || status === "success";
}

function isRevokeStatus(status: string): boolean {
  return status === "refunded" ||
    status === "refund" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "revoked" ||
    status === "chargeback" ||
    status === "disputed" ||
    status === "reversed";
}

function toSafeNonNegativeInt(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (parsed >= Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return Math.round(parsed);
}

function resolvePaymentTimestamp(payment: PaymentRow): Date | null {
  const candidates = [
    payment.payment_date,
    payment.created_at,
    payment.updated_at,
  ];

  for (const candidate of candidates) {
    const value = getStringValue(candidate);
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

function inferPlanFromPayment(
  payment: PaymentRow,
): "monthly" | "lifetime" | null {
  const normalizedPlan = normalizePlanType(payment.plan_type ?? null);
  if (normalizedPlan) return normalizedPlan;

  const amount = normalizeAmount(payment.amount);
  if (amount === LIFETIME_PLAN_PRICE_INR) return "lifetime";
  if (
    amount === CURRENT_MONTHLY_PLAN_PRICE_INR ||
    amount === LEGACY_MONTHLY_PLAN_PRICE_INR
  ) {
    return "monthly";
  }

  return null;
}

function derivePaidAccessFromPayments(
  payments: PaymentRow[],
  monthlyPlanDays: number,
): Pick<
  EffectiveAccess,
  "isPaidActive" | "accessType" | "subscriptionEndDate"
> {
  let latestLifetimeGrantMs: number | null = null;
  let latestLifetimeRevokeMs: number | null = null;
  let latestMonthlyGrantMs: number | null = null;
  let latestMonthlyRevokeMs: number | null = null;
  const nowMs = Date.now();

  for (const payment of payments) {
    const plan = inferPlanFromPayment(payment);
    if (!plan) continue;
    const paymentTimestamp = resolvePaymentTimestamp(payment);
    if (!paymentTimestamp) continue;
    const ts = paymentTimestamp.getTime();
    const status = normalizePaymentStatus(payment.payment_status);

    if (plan === "lifetime") {
      if (isGrantStatus(status)) {
        if (latestLifetimeGrantMs === null || ts > latestLifetimeGrantMs) {
          latestLifetimeGrantMs = ts;
        }
      } else if (isRevokeStatus(status)) {
        if (latestLifetimeRevokeMs === null || ts > latestLifetimeRevokeMs) {
          latestLifetimeRevokeMs = ts;
        }
      }
      continue;
    }

    if (isGrantStatus(status)) {
      if (latestMonthlyGrantMs === null || ts > latestMonthlyGrantMs) {
        latestMonthlyGrantMs = ts;
      }
    } else if (isRevokeStatus(status)) {
      if (latestMonthlyRevokeMs === null || ts > latestMonthlyRevokeMs) {
        latestMonthlyRevokeMs = ts;
      }
    }
  }

  const lifetimeActive = latestLifetimeGrantMs !== null &&
    (latestLifetimeRevokeMs === null || latestLifetimeGrantMs > latestLifetimeRevokeMs);
  if (lifetimeActive) {
    return {
      isPaidActive: true,
      accessType: "lifetime",
      subscriptionEndDate: null,
    };
  }

  const monthlyGrantActive = latestMonthlyGrantMs !== null &&
    (latestMonthlyRevokeMs === null || latestMonthlyGrantMs > latestMonthlyRevokeMs);
  if (monthlyGrantActive && latestMonthlyGrantMs !== null) {
    const subscriptionEndDate = addDaysIso(monthlyPlanDays, new Date(latestMonthlyGrantMs));
    const subscriptionEndMs = Date.parse(subscriptionEndDate);
    if (!Number.isNaN(subscriptionEndMs) && subscriptionEndMs > nowMs) {
      return {
        isPaidActive: true,
        accessType: "monthly",
        subscriptionEndDate,
      };
    }
  }

  return {
    isPaidActive: false,
    accessType: "free_trial",
    subscriptionEndDate: null,
  };
}

function buildDefaultEffectiveAccess(authUserId: string | null): EffectiveAccess {
  return {
    authUserId,
    publicUserId: null,
    publicUserCreatedAt: null,
    isPaidActive: false,
    accessType: "free_trial",
    subscriptionEndDate: null,
    totalTokensUsed: 0,
    remainingFreeTokens: FREE_CHAT_TOKEN_LIMIT,
  };
}

function resolveEffectiveAccessCacheKey(authUserId: string): string {
  return authUserId.trim();
}

export function clearEffectiveAccessCache(authUserId?: string | null): void {
  const normalized = getStringValue(authUserId);
  if (!normalized) {
    effectiveAccessCache.clear();
    publicToAuthCache.clear();
    return;
  }

  effectiveAccessCache.delete(resolveEffectiveAccessCacheKey(normalized));
}

export function clearEffectiveAccessCacheByPublicUserId(
  publicUserId?: string | null,
): void {
  const normalizedPublicUserId = getStringValue(publicUserId);
  if (!normalizedPublicUserId) return;
  const authUserId = publicToAuthCache.get(normalizedPublicUserId);
  if (!authUserId) return;
  clearEffectiveAccessCache(authUserId);
}

export function isLegacyUserByCreatedAt(
  createdAt: string | null | undefined,
): boolean {
  const normalizedCreatedAt = getStringValue(createdAt);
  if (!normalizedCreatedAt) return true;

  const createdMs = Date.parse(normalizedCreatedAt);
  if (Number.isNaN(createdMs)) return true;
  return createdMs < PAYWALL_CUTOVER.ms;
}

export function resolveChatAccessPolicy(
  effectiveAccess: Pick<EffectiveAccess, "isPaidActive" | "publicUserCreatedAt">,
): ChatAccessPolicy {
  if (!PAYWALL_V1_ENABLED) {
    return {
      requiresPaymentForChat: false,
      isLegacyUser: isLegacyUserByCreatedAt(effectiveAccess.publicUserCreatedAt),
      paywallEnabled: false,
      legacyUnpaidAllowed: LEGACY_UNPAID_ALLOWED,
      cutoverAt: PAYWALL_CUTOVER_AT,
      cacheTtlSeconds: ACCESS_CACHE_TTL_SECONDS,
      decision: "paywall_disabled",
    };
  }

  if (effectiveAccess.isPaidActive) {
    return {
      requiresPaymentForChat: false,
      isLegacyUser: isLegacyUserByCreatedAt(effectiveAccess.publicUserCreatedAt),
      paywallEnabled: true,
      legacyUnpaidAllowed: LEGACY_UNPAID_ALLOWED,
      cutoverAt: PAYWALL_CUTOVER_AT,
      cacheTtlSeconds: ACCESS_CACHE_TTL_SECONDS,
      decision: "paid_active",
    };
  }

  const isLegacyUser = isLegacyUserByCreatedAt(effectiveAccess.publicUserCreatedAt);
  if (LEGACY_UNPAID_ALLOWED && isLegacyUser) {
    return {
      requiresPaymentForChat: false,
      isLegacyUser: true,
      paywallEnabled: true,
      legacyUnpaidAllowed: true,
      cutoverAt: PAYWALL_CUTOVER_AT,
      cacheTtlSeconds: ACCESS_CACHE_TTL_SECONDS,
      decision: "legacy_unpaid_allowed",
    };
  }

  return {
    requiresPaymentForChat: true,
    isLegacyUser,
    paywallEnabled: true,
    legacyUnpaidAllowed: LEGACY_UNPAID_ALLOWED,
    cutoverAt: PAYWALL_CUTOVER_AT,
    cacheTtlSeconds: ACCESS_CACHE_TTL_SECONDS,
    decision: "payment_required",
  };
}

export async function getAuthContext(
  req: Request,
  supabase: {
    auth: {
      getUser: (token: string) => Promise<{
        data?: {
          user?: {
            id?: string | null;
            email?: string | null;
            user_metadata?: Record<string, unknown> | null;
          } | null;
        };
        error?: { message?: string | null } | null;
      }>;
    };
  } | null,
): Promise<AuthContext> {
  if (!supabase) {
    return { authUserId: null, email: null, name: null };
  }

  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    return { authUserId: null, email: null, name: null };
  }

  const { data, error } = await supabase.auth.getUser(bearerToken);
  const user = data?.user;
  if (error || !user?.id) {
    return { authUserId: null, email: null, name: null };
  }

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const nameFromMetadata = getStringValue(metadata.full_name) ??
    getStringValue(metadata.name);

  return {
    authUserId: user.id,
    email: user.email ?? null,
    name: nameFromMetadata,
  };
}

function normalizePublicUserProfile(
  value: Record<string, unknown> | null | undefined,
): PublicUserProfile | null {
  const id = getStringValue(value?.id);
  if (!id) return null;
  return {
    id,
    createdAt: getStringValue(value?.created_at),
  };
}

async function findPublicUserProfileByAuthId(
  supabase: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          limit: (value: number) => {
            maybeSingle: () => Promise<
              {
                data?: Record<string, unknown> | null;
                error?: { message?: string | null } | null;
              }
            >;
          };
        };
      };
    };
  },
  authUserId: string,
): Promise<PublicUserProfile | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, created_at")
    .eq("auth_id", authUserId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("findPublicUserIdByAuthId failed:", error.message);
    return null;
  }

  return normalizePublicUserProfile(data ?? null);
}

async function findPublicUserProfileById(
  supabase: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          limit: (value: number) => {
            maybeSingle: () => Promise<
              {
                data?: Record<string, unknown> | null;
                error?: { message?: string | null } | null;
              }
            >;
          };
        };
      };
    };
  },
  userId: string,
): Promise<PublicUserProfile | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, created_at")
    .eq("id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("findPublicUserIdById failed:", error.message);
    return null;
  }

  return normalizePublicUserProfile(data ?? null);
}

async function createUserRow(
  supabase: {
    from: (table: string) => {
      insert: (
        payload: Record<string, unknown>,
      ) => Promise<{ error?: { message?: string | null } | null }>;
    };
  },
  userId: string,
  authId: string | null,
  email: string | null,
  name: string | null,
): Promise<PublicUserProfile | null> {
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
    return null;
  }

  return normalizePublicUserProfile({
    id: userId,
    created_at: now,
  });
}

export async function resolvePublicUserProfile(
  supabase: {
    from: (table: string) => {
      select?: (columns: string) => {
        eq: (column: string, value: string) => {
          limit: (value: number) => {
            maybeSingle: () => Promise<
              {
                data?: Record<string, unknown> | null;
                error?: { message?: string | null } | null;
              }
            >;
          };
        };
      };
      insert?: (
        payload: Record<string, unknown>,
      ) => Promise<{ error?: { message?: string | null } | null }>;
    };
  } | null,
  authContext: AuthContext,
): Promise<PublicUserProfile | null> {
  if (!supabase || !authContext.authUserId) return null;

  const foundByAuth = await findPublicUserProfileByAuthId(
    supabase as never,
    authContext.authUserId,
  );
  if (foundByAuth) return foundByAuth;

  const foundById = await findPublicUserProfileById(
    supabase as never,
    authContext.authUserId,
  );
  if (foundById) return foundById;

  const created = await createUserRow(
    supabase as never,
    authContext.authUserId,
    authContext.authUserId,
    authContext.email,
    authContext.name,
  );
  if (created) return created;

  return await findPublicUserProfileById(
    supabase as never,
    authContext.authUserId,
  );
}

export async function resolvePublicUserId(
  supabase: {
    from: (table: string) => unknown;
  } | null,
  authContext: AuthContext,
): Promise<string | null> {
  const profile = await resolvePublicUserProfile(
    supabase as never,
    authContext,
  );
  return profile?.id ?? null;
}

async function getUserPayments(
  supabase: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          order: (
            column: string,
            options: { ascending: boolean; nullsFirst: boolean },
          ) => {
            order: (
              column: string,
              options: { ascending: boolean; nullsFirst: boolean },
            ) => {
              limit: (
                value: number,
              ) => Promise<
                {
                  data?: Record<string, unknown>[] | null;
                  error?: { message?: string | null } | null;
                }
              >;
            };
          };
        };
      };
    };
  },
  publicUserId: string,
): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "payment_id, payment_status, plan_type, payment_date, created_at, updated_at, amount",
    )
    .eq("user_id", publicUserId)
    .order("payment_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(250);

  if (error) {
    throw new Error(error.message ?? "Failed to load payments");
  }

  return Array.isArray(data) ? (data as PaymentRow[]) : [];
}

async function getTotalTokensUsed(
  supabase: {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<
            {
              data?: Record<string, unknown> | null;
              error?: { code?: string | null; message?: string | null } | null;
            }
          >;
        };
      };
    };
  },
  authUserId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("user_token_ledger")
    .select("total_tokens")
    .eq("user_id", authUserId)
    .maybeSingle();

  if (error) {
    if (error.code !== "PGRST116") {
      console.warn("getTotalTokensUsed failed:", error.message);
    }
    return 0;
  }

  return toSafeNonNegativeInt(data?.total_tokens);
}

export async function resolveEffectiveAccess(
  supabase: {
    from: (table: string) => unknown;
  } | null,
  authContext: AuthContext,
  monthlyPlanDays: number,
  options?: {
    forceRefresh?: boolean;
    cacheTtlSeconds?: number;
  },
): Promise<EffectiveAccess> {
  const authUserId = authContext.authUserId;
  if (!supabase || !authUserId) {
    return buildDefaultEffectiveAccess(authUserId);
  }

  const forceRefresh = options?.forceRefresh === true;
  const ttlSeconds = Math.max(
    0,
    Math.min(
      ACCESS_CACHE_MAX_TTL_SECONDS,
      Math.round(options?.cacheTtlSeconds ?? ACCESS_CACHE_TTL_SECONDS),
    ),
  );
  const cacheKey = resolveEffectiveAccessCacheKey(authUserId);

  if (!forceRefresh && ttlSeconds > 0) {
    const cached = effectiveAccessCache.get(cacheKey);
    if (cached) {
      const cacheAgeMs = Date.now() - cached.cachedAtMs;
      if (cacheAgeMs <= ttlSeconds * 1000) {
        return cached.value;
      }
    }
  }

  const publicUserProfile = await resolvePublicUserProfile(
    supabase as never,
    authContext,
  );
  const publicUserId = publicUserProfile?.id ?? null;
  const payments = publicUserId
    ? await getUserPayments(supabase as never, publicUserId)
    : [];
  const paidAccess = derivePaidAccessFromPayments(payments, monthlyPlanDays);
  const totalTokensUsed = await getTotalTokensUsed(
    supabase as never,
    authUserId,
  );

  const resolvedAccess: EffectiveAccess = {
    authUserId,
    publicUserId,
    publicUserCreatedAt: publicUserProfile?.createdAt ?? null,
    ...paidAccess,
    totalTokensUsed,
    remainingFreeTokens: Math.max(0, FREE_CHAT_TOKEN_LIMIT - totalTokensUsed),
  };

  if (ttlSeconds > 0) {
    effectiveAccessCache.set(cacheKey, {
      cachedAtMs: Date.now(),
      value: resolvedAccess,
    });
    if (publicUserId) {
      publicToAuthCache.set(publicUserId, cacheKey);
    }
  }

  return resolvedAccess;
}
