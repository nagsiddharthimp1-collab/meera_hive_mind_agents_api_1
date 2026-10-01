// src/app/api/services/chat.ts
import { streamMeera } from '@/lib/streamMeera';
import { getAgentRouteErrorStatus, isAgentCandidate, requestAgentRoute, waitForAgent } from '@/lib/agenticRoute';
import { supabase } from '@/lib/supabaseClient';
import { SaveInteractionPayload } from '@/types/chat';
import { api } from '../client';
import { API_ENDPOINTS } from '../config';

/* ---------- Errors ---------- */

export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class ApiError extends Error {
  status: number;
  body: { detail?: string; error?: string };

  constructor(message: string, status: number, body: { detail?: string; error?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/* ---------- Types ---------- */

type ImageAttachment = {
  type: 'image';
  url: string;
  name: string;
  // size is stored in DB, but optional for frontend
  size?: number;
};

type OutgoingAttachment = {
  name: string;
  url?: string;
  publicUrl?: string;
  mimeType?: string;
  type?: 'image' | 'document' | 'file' | string;
  size?: number;
  bucket?: string;
  storagePath?: string;
};

type DbMessageRow = {
  message_id: string;
  user_id: string;
  content_type: string;
  content: string;
  timestamp: string;
  session_id?: string | null;
  is_call?: boolean | null;
  model?: string | null;

  // new columns
  message_type?: string | null;
  image_url?: string | null;
  attachments?: ImageAttachment[] | null;
  system_prompt?: string | null;
};

type StarredMessageRow = {
  message_id: string;
  user_id: string;
  snapshot_content: string | null;
  snapshot_content_type: 'user' | 'assistant' | string | null;
  snapshot_timestamp: string | null;
  user_context: string | null;
  summary: string | null;
  starred_at: string | null;
};

type StarredMessageSnapshotInput = {
  content?: string | null;
  content_type?: 'user' | 'assistant' | 'system';
  timestamp?: string | null;
  user_context?: string | null;
  summary?: string | null;
};

type StarredMessageSnapshot = {
  message_id: string;
  content: string;
  content_type: 'user' | 'assistant';
  timestamp: string;
  user_context: string;
  summary: string;
};

type LLMHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type AssistantMsg = {
  message_id: string;
  content_type: 'assistant';
  content: string;
  timestamp: string;
  attachments: ImageAttachment[];
  is_call: false;
  failed: false;
  finish_reason: null;
};

type MeeraImageResponse = {
  assistantMessageId?: string;
  sessionId?: string;
  webSearchEnabled?: boolean;
  webSearchTriggerReason?: string;
  messageType?: string;
  conversationClass?: string;
  statusEligible?: boolean;
  statusPhase?: string;
  statusLabel?: string;
  reply?: string;
  thoughts?: string;
  images?: { mimeType?: string; data: string; dataUrl?: string }[];
  model?: string;
  attachments?: ImageAttachment[];
};

/* ---------- Constants ---------- */
const CONTEXT_WINDOW = 40;
const CONTEXT_RESET_TRIGGER_MESSAGES = 40;
const CONTEXT_RESET_TAIL_MESSAGES = 6;
const CLIENT_SESSION_NAMESPACE = (process.env.NEXT_PUBLIC_SESSION_NAMESPACE || 'r20260331f1').trim();
const CLIENT_SESSION_PREFIX = `sess_${CLIENT_SESSION_NAMESPACE}_`;
const CLIENT_SESSION_STORAGE_KEY_PREFIX = `meera:chat_session_id:${CLIENT_SESSION_NAMESPACE}:`;
const FINAL_OVERLOAD_FALLBACK_TEXT = 'Too many people are using Meera right now. Please try again later.';
const INTERNAL_EMPTY_REPLY_PLACEHOLDER_TEXT = 'Sorry, I could not generate a reply.';

function isForbiddenAssistantReply(value: string | null | undefined): boolean {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text === INTERNAL_EMPTY_REPLY_PLACEHOLDER_TEXT) return true;
  return false;
}

/* ---------- Env Vars ---------- */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('Public Supabase env vars missing, streaming will fail.');
}

function normalizeSessionId(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLegacySessionId(value: string): boolean {
  return value === 'sess_1';
}

function isCurrentSessionNamespace(value: string): boolean {
  return value.startsWith(CLIENT_SESSION_PREFIX);
}

function getOrCreateClientSessionId(userId: string, preferredSessionId?: string): string {
  const explicitSessionId = normalizeSessionId(preferredSessionId);
  if (explicitSessionId && !isLegacySessionId(explicitSessionId) && isCurrentSessionNamespace(explicitSessionId)) {
    return explicitSessionId;
  }

  const storageKey = `${CLIENT_SESSION_STORAGE_KEY_PREFIX}${userId}`;

  try {
    const existing = normalizeSessionId(globalThis?.localStorage?.getItem(storageKey));
    if (existing && !isLegacySessionId(existing) && isCurrentSessionNamespace(existing)) return existing;
    if (existing && (!isCurrentSessionNamespace(existing) || isLegacySessionId(existing))) {
      globalThis?.localStorage?.removeItem(storageKey);
    }
  } catch {
    // Ignore storage read failures and fall back to ephemeral generation.
  }

  const generated = `${CLIENT_SESSION_PREFIX}${crypto.randomUUID()}`;

  try {
    globalThis?.localStorage?.setItem(storageKey, generated);
  } catch {
    // Ignore storage write failures; the generated session id is still valid for this request.
  }

  return generated;
}

function persistClientSessionId(userId: string, sessionId?: string | null): string | null {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized || isLegacySessionId(normalized) || !isCurrentSessionNamespace(normalized)) return null;
  const storageKey = `${CLIENT_SESSION_STORAGE_KEY_PREFIX}${userId}`;
  try {
    globalThis?.localStorage?.setItem(storageKey, normalized);
  } catch {
    // Ignore storage write failures; caller can still continue with this session id.
  }
  return normalized;
}

/* ---------- Image helpers ---------- */

const IMAGE_TRIGGER_WORDS = [
  'image',
  'photo',
  'picture',
  'img',
  'pic',
];
const IMAGE_FILE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif|heic|heif)(\?|#|$)/i;

function isImagePrompt(text: string): boolean {
  const t = text.toLowerCase();
  const hasImageNoun = IMAGE_TRIGGER_WORDS.some((w) => t.includes(w));
  const hasGenerateVerb = /\b(generate|create|draw|make|render|illustrate|paint|sketch|design)\b/.test(t);
  const hasShowOrSendImage = /\b(show|send|give)\b.*\b(image|picture|photo|pic)\b/.test(t);
  return hasShowOrSendImage || (hasGenerateVerb && hasImageNoun);
}

function hasImageAttachment(attachments: OutgoingAttachment[]): boolean {
  return attachments.some((att) => {
    const mime = String(att.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    if (String(att.type || '').toLowerCase() === 'image') return true;
    const name = String(att.name || '').toLowerCase();
    const url = String(att.url || att.publicUrl || '').toLowerCase();
    return IMAGE_FILE_EXT_RE.test(name) || IMAGE_FILE_EXT_RE.test(url);
  });
}

function isLikelyImageEditPrompt(text: string): boolean {
  const t = text.toLowerCase();
  const hasEditVerb =
    /\b(change|edit|modify|remove|replace|swap|erase|add|crop|blur|sharpen|resize|rotate|flip|brighten|darken|fix|retouch|enhance|improve|adjust|tweak|beautify|stylize|style|transform|restyle|convert|makeover)\b/.test(
      t,
    );
  const hasTarget =
    /\b(background|bg|colour|color|logo|text|font|watermark|person|people|object|sky|shirt|hair|eyes|face|layout|button|banner)\b/.test(
      t,
    );
  if (hasEditVerb && hasTarget) return true;
  if (/\b(change|set)\b.*\b(background|bg)\b.*\b(colou?r)\b/.test(t)) return true;
  if (
    /\b(make|turn|set)\b.*\b(red|green|blue|black|white|gray|grey|purple|pink|orange|yellow|brown|teal|navy|beige|cream)\b/.test(
      t,
    )
  ) {
    return true;
  }
  const hasStyleCue = /\b(look|style|vibe|theme|aesthetic|avatar|character|costume|outfit|filter)\b/.test(t);
  const hasSubjectRef = /\b(him|her|them|me|my|our|it|this|that|face|selfie|portrait)\b/.test(t);
  if (/\b(give|make|turn|transform|restyle|convert|style)\b/.test(t) && hasStyleCue && hasSubjectRef) return true;
  if (/\b(make|turn)\b.*\binto\b/.test(t) && hasSubjectRef) return true;
  return false;
}

function isLikelyAttachmentEditCue(text: string): boolean {
  const t = text.toLowerCase();
  const hasTransformVerb =
    /\b(edit|change|modify|remove|replace|add|improve|enhance|retouch|stylize|upscale|restore|clean|fix|make|turn|set|adjust|tweak|transform|restyle|convert|give)\b/.test(
      t,
    );
  const hasImageRef = /\b(image|photo|picture|pic|portrait|selfie)\b/.test(t);
  const hasStyleCue = /\b(look|style|vibe|theme|aesthetic|avatar|character|costume|outfit|filter)\b/.test(t);
  const hasSubjectRef = /\b(him|her|them|me|my|our|it|this|that|face)\b/.test(t);
  return hasTransformVerb && (hasImageRef || hasStyleCue || hasSubjectRef);
}

function isLikelyAttachmentReadCue(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(read|describe|analy[sz]e|analy[sz]ing|explain|identify|ocr|transcribe|extract|summari[sz]e|caption|what(?:'s| is) in)\b/.test(
    t,
  );
}

function isLikelyAttachmentTextRewriteCue(text: string): boolean {
  const t = text.toLowerCase();
  const hasTextArtifact =
    /\b(reply|response|message|email|mail|dm|inmail|linkedin|outreach|copy|caption|headline|bio|profile|note|draft|line|paragraph|sentence)\b/.test(
      t,
    );
  const hasRewriteCue =
    /\b(rewrite|rephrase|revise|polish|tighten|shorten|draft|write|compose|fix|edit|improve|clean)\b/.test(t) ||
    /\b(crisp|crisper|concise|shorter|clearer|cleaner|better|professional|punchier)\b/.test(t) ||
    /\b(make|make it|make this)\b.*\b(crisp|crisper|concise|shorter|clearer|cleaner|better|professional|punchier)\b/.test(
      t,
    );
  return hasTextArtifact && hasRewriteCue;
}

function isLikelyAttachmentAdviceCue(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(tell me what to do|what should i|what can i|how can i|how do i|how should i)\b/.test(t) ||
    /\b(suggest|recommend|advise|advice|feedback|critique|review)\b/.test(t) ||
    /\b(what|how)\b.*\b(change|improve|fix|clean|polish|adjust|tweak|make better)\b/.test(t) ||
    /\b(make|making)\b.*\b(clean|cleaner|better|polished|professional)\b.*\b(suggest|recommend|advice|what to do)\b/.test(
      t,
    )
  );
}

function normalizeOutgoingAttachments(attachments: OutgoingAttachment[]): OutgoingAttachment[] {
  const out: OutgoingAttachment[] = [];
  for (const att of attachments) {
    const url = String(att.url || att.publicUrl || '').trim();
    const storagePath = String(att.storagePath || '').trim();
    if (!url && !storagePath) continue;
    out.push({
      name: String(att.name || 'attachment'),
      url: url || undefined,
      mimeType: att.mimeType ? String(att.mimeType) : undefined,
      type: att.type ? String(att.type) : undefined,
      size: typeof att.size === 'number' ? att.size : undefined,
      bucket: att.bucket ? String(att.bucket) : undefined,
      storagePath: storagePath || undefined,
    });
  }
  return out;
}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

function imageAttachmentNameForMime(index: number, mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return `generated-${index + 1}.jpg`;
  if (mimeType.includes('webp')) return `generated-${index + 1}.webp`;
  if (mimeType.includes('gif')) return `generated-${index + 1}.gif`;
  return `generated-${index + 1}.png`;
}

function buildImageAttachmentsFromResponse(
  response: Pick<MeeraImageResponse, 'attachments' | 'images'>,
): ImageAttachment[] {
  if (response.attachments && response.attachments.length > 0) {
    return response.attachments;
  }

  const out: ImageAttachment[] = [];
  (response.images ?? []).forEach((img, index) => {
    if (!img?.data && !img?.dataUrl) return;
    const mime = img.mimeType || 'image/png';
    const url = img.dataUrl || base64ToBlobUrl(img.data, mime);
    out.push({
      type: 'image',
      url,
      name: imageAttachmentNameForMime(index, mime),
    });
  });

  return out;
}

function hasAssistantImageMessage(rows: DbMessageRow[]): boolean {
  return rows.some((row) => {
    if (row.content_type !== 'assistant') return false;
    if (row.message_type === 'image') return true;
    if (row.image_url) return true;
    return hasImageAttachment((row.attachments ?? []) as OutgoingAttachment[]);
  });
}

function generateSummary(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Saved Memory';

  const words = normalized.split(' ');
  const title = words.slice(0, 5).join(' ');
  return words.length > 5 ? `${title}...` : title;
}

function mapDbRowToChatMessage(row: DbMessageRow) {
  return {
    message_id: row.message_id,
    content_type: row.content_type === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    timestamp: row.timestamp,
    session_id: row.session_id || undefined,
    is_call: row.is_call ?? false,
    attachments: (row.attachments as ImageAttachment[] | null) ?? [],
    message_type: row.message_type ?? 'text',
    image_url: row.image_url ?? undefined,
    failed: false,
    finish_reason: null,
  };
}

function mapStarredRowToChatMessage(row: StarredMessageRow) {
  const timestamp =
    typeof row.snapshot_timestamp === 'string' && row.snapshot_timestamp
      ? row.snapshot_timestamp
      : typeof row.starred_at === 'string' && row.starred_at
        ? row.starred_at
        : new Date(0).toISOString();

  return {
    message_id: row.message_id,
    content_type: row.snapshot_content_type === 'user' ? 'user' : 'assistant',
    content: row.snapshot_content ?? '',
    timestamp,
    user_context: row.user_context ?? '',
    summary: row.summary ?? generateSummary((row.user_context ?? '').trim() || (row.snapshot_content ?? '').trim()),
    session_id: undefined,
    is_call: false,
    attachments: [],
    message_type: 'text',
    image_url: undefined,
    failed: false,
    finish_reason: null,
  };
}

/* -------------------------------------------------------------------------- */
/*                             CHAT SERVICE                                   */
/* -------------------------------------------------------------------------- */

export const chatService = {
  /* ---------- Load Chat History ---------- */
  async getChatHistory(page: number = 1) {
    const pageSize = 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return { message: 'unauthorized', data: [] };
      const userId = session.user.id;

      const { data, error } = await supabase
        .from('messages')
        .select(
          'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments',
        )
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('getChatHistory error', error);
        return { message: 'error', data: [] };
      }

      const rows = ((data ?? []) as DbMessageRow[]).slice().reverse();
      const mapped = rows.map(mapDbRowToChatMessage);
      if (process.env.NEXT_PUBLIC_AGENTIC_TEXT_ENABLED === 'true') {
        const assistantIds = rows.filter((row) => row.content_type === 'assistant').map((row) => row.message_id);
        if (assistantIds.length) {
          const { data: tasks } = await supabase.from('agent_tasks')
            .select('id,assistant_message_id,status,current_step')
            .eq('user_id', userId).in('assistant_message_id', assistantIds);
          const byId = new Map((tasks ?? []).map((task) => [task.assistant_message_id, task]));
          for (const item of mapped) {
            const task = byId.get(item.message_id);
            if (task) {
              Object.assign(item, { agenticActive: true, agentTaskId: task.id, workStatusLabel: task.current_step || 'Working' });
            }
          }
        }
      }

      return { message: 'ok', data: mapped };
    } catch (e) {
      console.error('getChatHistory outer error', e);
      return { message: 'error', data: [] };
    }
  },

  async getMessageById(messageId: string) {
    try {
      const normalizedId = messageId.trim();
      if (!normalizedId) return { message: 'error', data: null };

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return { message: 'unauthorized', data: null };
      const userId = session.user.id;

      const { data, error } = await supabase
        .from('messages')
        .select(
          'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments',
        )
        .eq('user_id', userId)
        .eq('message_id', normalizedId)
        .maybeSingle();

      if (error) {
        console.error('getMessageById error', error);
        return { message: 'error', data: null };
      }

      return {
        message: 'ok',
        data: data ? mapDbRowToChatMessage(data as DbMessageRow) : null,
      };
    } catch (e) {
      console.error('getMessageById outer error', e);
      return { message: 'error', data: null };
    }
  },

  async getImageHistory(page: number = 1, pageSize: number = 40) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return { message: 'unauthorized', data: [], hasMore: false };
      const userId = session.user.id;

      const { data, error } = await supabase
        .from('messages')
        .select(
          'message_id, content_type, content, timestamp, session_id, is_call, message_type, attachments, image_url',
        )
        .eq('user_id', userId)
        .eq('content_type', 'assistant')
        .or('image_url.not.is.null,attachments.not.is.null')
        .order('timestamp', { ascending: false })
        .range(from, to);

      if (error) {
        console.error('getImageHistory error', error);
        return { message: 'error', data: [], hasMore: false };
      }

      const rows = ((data ?? []) as DbMessageRow[]).slice().reverse();
      const mapped = rows.map((row) => ({
        message_id: row.message_id,
        content_type: 'assistant' as const,
        content: row.content ?? '',
        timestamp: row.timestamp,
        session_id: row.session_id || undefined,
        is_call: row.is_call ?? false,
        attachments:
          (row.attachments as ImageAttachment[] | null) ??
          (row.image_url
            ? [
                {
                  type: 'image' as const,
                  url: row.image_url,
                  name: 'generated-image.png',
                },
              ]
            : []),
        image_url: row.image_url ?? undefined,
        failed: false,
        finish_reason: null,
      }));

      return {
        message: 'ok',
        data: mapped,
        hasMore: rows.length === pageSize,
      };
    } catch (e) {
      console.error('getImageHistory outer error', e);
      return { message: 'error', data: [], hasMore: false };
    }
  },

  async getMessageContextWindow(messageId: string, before: number = 24, after: number = 24, aroundTimestamp?: string) {
    try {
      const messageColumns =
        'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments';
      const normalizedId = messageId.trim();
      const normalizedTimestamp = typeof aroundTimestamp === 'string' ? aroundTimestamp.trim() : '';
      if (!normalizedId && !normalizedTimestamp) return { message: 'error', data: [] };

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return { message: 'unauthorized', data: [] };
      const userId = session.user.id;

      const { data: anchor, error: anchorError } = normalizedId
        ? await supabase
            .from('messages')
            .select(messageColumns)
            .eq('user_id', userId)
            .eq('message_id', normalizedId)
            .maybeSingle()
        : { data: null, error: null };

      if (anchorError) {
        console.error('getMessageContextWindow anchor error', anchorError);
        return { message: 'error', data: [] };
      }

      let anchorTimestamp = '';
      let anchorRow: DbMessageRow | null = null;
      let questionRow: DbMessageRow | null = null;
      let questionMessageId: string | null = null;

      if (anchor) {
        anchorRow = anchor as DbMessageRow;
        anchorTimestamp = anchorRow.timestamp;
      } else if (normalizedTimestamp) {
        const parsedTimestamp = new Date(normalizedTimestamp).getTime();
        if (!Number.isFinite(parsedTimestamp)) {
          return { message: 'not_found', data: [] };
        }
        anchorTimestamp = normalizedTimestamp;
      } else {
        return { message: 'not_found', data: [] };
      }

      if (anchorRow?.content_type === 'assistant' || (!anchorRow && normalizedTimestamp)) {
        const queryPreviousUser = async (sessionId?: string) => {
          let query = supabase
            .from('messages')
            .select(messageColumns)
            .eq('user_id', userId)
            .eq('content_type', 'user')
            .lte('timestamp', anchorTimestamp)
            .order('timestamp', { ascending: false })
            .limit(1);

          if (sessionId) {
            query = query.eq('session_id', sessionId);
          }

          return query.maybeSingle();
        };

        const anchorSessionId =
          typeof anchorRow?.session_id === 'string' && anchorRow.session_id.trim() ? anchorRow.session_id : undefined;

        const inSessionResult = await queryPreviousUser(anchorSessionId);
        if (inSessionResult.error) {
          console.error('getMessageContextWindow question lookup (session) error', inSessionResult.error);
          return { message: 'error', data: [] };
        }

        if (inSessionResult.data) {
          questionRow = inSessionResult.data as DbMessageRow;
        } else {
          const fallbackResult = await queryPreviousUser();
          if (fallbackResult.error) {
            console.error('getMessageContextWindow question lookup (fallback) error', fallbackResult.error);
            return { message: 'error', data: [] };
          }
          if (fallbackResult.data) {
            questionRow = fallbackResult.data as DbMessageRow;
          }
        }

        if (questionRow) {
          questionMessageId = questionRow.message_id;
        }
      }

      const [olderResult, newerResult] = await Promise.all([
        supabase
          .from('messages')
          .select(messageColumns)
          .eq('user_id', userId)
          .lt('timestamp', anchorTimestamp)
          .order('timestamp', { ascending: false })
          .limit(before),
        supabase
          .from('messages')
          .select(messageColumns)
          .eq('user_id', userId)
          .gte('timestamp', anchorTimestamp)
          .order('timestamp', { ascending: true })
          .limit(after + 1),
      ]);

      if (olderResult.error) {
        console.error('getMessageContextWindow older error', olderResult.error);
        return { message: 'error', data: [] };
      }

      if (newerResult.error) {
        console.error('getMessageContextWindow newer error', newerResult.error);
        return { message: 'error', data: [] };
      }

      const olderRows = ((olderResult.data ?? []) as DbMessageRow[]).slice().reverse();
      const newerRows = (newerResult.data ?? []) as DbMessageRow[];

      const orderedMap = new Map<string, DbMessageRow>();
      [
        ...olderRows,
        ...(questionRow ? [questionRow] : []),
        ...(anchorRow ? [anchorRow] : []),
        ...newerRows,
      ].forEach((row) => {
        orderedMap.set(row.message_id, row);
      });

      const mapped = Array.from(orderedMap.values()).map(mapDbRowToChatMessage);

      return {
        message: mapped.length > 0 ? 'ok' : 'not_found',
        data: mapped,
        question_message_id: questionMessageId,
      };
    } catch (e) {
      console.error('getMessageContextWindow outer error', e);
      return { message: 'error', data: [] };
    }
  },

  /* ---------- Starred Messages ---------- */
  async getStarredMessages() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) return { message: 'unauthorized', data: [], ids: [] as string[] };
      const userId = session.user.id;

      const { data, error } = await supabase
        .from('starred_messages')
        .select(
          'message_id,user_id,snapshot_content,snapshot_content_type,snapshot_timestamp,user_context,summary,starred_at',
        )
        .eq('user_id', userId)
        .order('starred_at', { ascending: false });

      if (error) {
        console.error('getStarredMessages error', error);
        return { message: 'error', data: [], ids: [] as string[] };
      }

      const rows = (data ?? []) as StarredMessageRow[];
      const orderedIds = rows.map((row) => row.message_id);
      const orderedMessages = rows.map(mapStarredRowToChatMessage);

      return { message: 'ok', data: orderedMessages, ids: orderedIds };
    } catch (e) {
      console.error('getStarredMessages outer error', e);
      return { message: 'error', data: [], ids: [] as string[] };
    }
  },

  async setMessageStar(messageId: string, shouldStar: boolean, snapshot?: StarredMessageSnapshotInput) {
    try {
      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) return { message: 'error' };

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) throw new SessionExpiredError('Session expired');
      const userId = session.user.id;
      if (shouldStar) {
        const snapshotPayload: StarredMessageSnapshot = {
          message_id: normalizedMessageId,
          content: typeof snapshot?.content === 'string' ? snapshot.content : '',
          content_type: snapshot?.content_type === 'user' ? 'user' : 'assistant',
          timestamp:
            typeof snapshot?.timestamp === 'string' && snapshot.timestamp
              ? snapshot.timestamp
              : new Date().toISOString(),
          user_context:
            typeof snapshot?.user_context === 'string' ? snapshot.user_context.replace(/\s+/g, ' ').trim() : '',
          summary:
            typeof snapshot?.summary === 'string' && snapshot.summary.trim()
              ? snapshot.summary.trim()
              : generateSummary(
                  (typeof snapshot?.user_context === 'string' ? snapshot.user_context : '') ||
                    (typeof snapshot?.content === 'string' ? snapshot.content : ''),
                ),
        };

        const { error } = await supabase.from('starred_messages').upsert(
          [
            {
              user_id: userId,
              message_id: normalizedMessageId,
              snapshot_content: snapshotPayload.content,
              snapshot_content_type: snapshotPayload.content_type,
              snapshot_timestamp: snapshotPayload.timestamp,
              user_context: snapshotPayload.user_context,
              summary: snapshotPayload.summary,
              starred_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          {
            onConflict: 'user_id,message_id',
          },
        );

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('starred_messages')
          .delete()
          .eq('user_id', userId)
          .eq('message_id', normalizedMessageId);

        if (error) throw error;
      }

      return { message: 'ok' };
    } catch (e) {
      console.error('setMessageStar error', e);
      return { message: 'error' };
    }
  },

  /* ---------- sendMessage (unused) ---------- */
  async sendMessage() {
    throw new Error('Use streamMessage instead.');
  },

  /* ---------- Streaming Chat ---------- */
  async streamMessage({
    message,
    attachments = [],
    sessionId,
    providedUserMessageId,
    providedAssistantMessageId,
    onDelta,
    onDone,
    onError,
    onMeta,
    signal,
  }: {
    message: string;
    attachments?: OutgoingAttachment[];
    sessionId?: string;
    providedUserMessageId?: string;
    providedAssistantMessageId?: string;
    onDelta: (delta: string) => void;
    onDone?: (finalMsg: AssistantMsg) => void;
    onError?: (err: unknown) => void;
    onMeta?: (meta: {
      messageType?: string;
      conversationClass?: string;
      model?: string;
      webSearchEnabled?: boolean;
      webSearchTriggerReason?: string;
      statusEligible?: boolean;
      statusPhase?: string;
      statusLabel?: string;
      agenticActive?: boolean;
      taskId?: string;
    }) => void;
    signal?: AbortSignal;
  }) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) throw new SessionExpiredError('Session expired');
      const userId = session.user.id;
      let accessToken = session.access_token;
      const effectiveSessionId = getOrCreateClientSessionId(userId, sessionId);

      // Deterministic IDs for this interaction (fixes system_prompt + attachment updates)
      const userMessageId = providedUserMessageId || crypto.randomUUID();
      const assistantMessageId = providedAssistantMessageId || crypto.randomUUID();

      /* ---------- Fetch context history ---------- */
      let historyRows: DbMessageRow[] = [];

      try {
        const { data: page1 } = await supabase
          .from('messages')
          .select('content_type, content, timestamp, session_id, message_type, image_url, attachments')
          .eq('user_id', userId)
          .eq('session_id', effectiveSessionId)
          .order('timestamp', { ascending: false })
          .limit(CONTEXT_WINDOW);

        historyRows = (page1 ?? []) as DbMessageRow[];
      } catch (e) {
        console.error('History load failed:', e);
      }

      const sortedHistory = historyRows.slice().reverse();
      const normalizedAttachments = normalizeOutgoingAttachments(attachments);

      let historyForModel: LLMHistoryMessage[] = sortedHistory
        .filter((r) => r.content?.trim())
        .map((r) => ({
          role: r.content_type === 'assistant' ? 'assistant' : 'user',
          content: r.content,
        }));

      historyForModel.push({ role: 'user', content: message });
      if (historyForModel.length >= CONTEXT_RESET_TRIGGER_MESSAGES) {
        historyForModel = historyForModel.slice(-CONTEXT_RESET_TAIL_MESSAGES);
      }

      const hasIncomingImageAttachment = hasImageAttachment(normalizedAttachments);
      const hasLikelyImageGenerateIntent = isImagePrompt(message);
      const hasLikelyImageEditIntent = isLikelyImageEditPrompt(message);
      const hasAttachmentEditCue = isLikelyAttachmentEditCue(message);
      const hasAttachmentReadCue = isLikelyAttachmentReadCue(message);
      const hasAttachmentTextRewriteCue = hasIncomingImageAttachment && isLikelyAttachmentTextRewriteCue(message);
      const hasAttachmentAdviceCue = isLikelyAttachmentAdviceCue(message);
      const hasPreviousAssistantImage = hasAssistantImageMessage(sortedHistory);
      const hasPreviousImageEditIntent =
        hasPreviousAssistantImage &&
        hasLikelyImageEditIntent &&
        !hasAttachmentReadCue &&
        !hasAttachmentTextRewriteCue &&
        !hasAttachmentAdviceCue;
      const isImage =
        !hasAttachmentTextRewriteCue &&
        !hasAttachmentAdviceCue &&
        (hasLikelyImageGenerateIntent ||
          hasPreviousImageEditIntent ||
          (hasIncomingImageAttachment &&
            (hasLikelyImageEditIntent || hasAttachmentEditCue) &&
            !hasAttachmentReadCue &&
            !hasAttachmentTextRewriteCue));

      /* ---------- Save user message WITH message_id ---------- */
      await supabase.from('messages').insert([
        {
          message_id: userMessageId,
          user_id: userId,
          session_id: effectiveSessionId,
          content_type: 'user',
          content: message,
          timestamp: new Date().toISOString(),
          message_type: 'text',
          attachments: normalizedAttachments.length > 0 ? normalizedAttachments : null,
          is_call: false,
        },
      ]);

      /* ---------- Create assistant placeholder WITH message_id ---------- */
      await supabase.from('messages').insert([
        {
          message_id: assistantMessageId,
          user_id: userId,
          session_id: effectiveSessionId,
          content_type: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
          message_type: isImage ? 'image' : 'text',
          is_call: false,
        },
      ]);

      /* ---------------------------------------------------------------------- */
      /*                               IMAGE MODE                               */
      /* ---------------------------------------------------------------------- */

      if (isImage) {
        let finalText = '';
        let liveAttachments: ImageAttachment[] = [];

        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY!,
              Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY!}`,
            },
            body: JSON.stringify({
              message,
              messages: historyForModel,
              attachments: normalizedAttachments,
              userId,
              sessionId: effectiveSessionId,
              stream: false,

              // NEW: send both IDs
              userMessageId,
              assistantMessageId,

              // Back-compat (optional)
              messageId: assistantMessageId,
            }),
            signal,
          });

          if (!res.ok) {
            const rawError = await res.text();
            const error = new Error(rawError || `Image call failed: ${res.status}`);
            (error as Error & { status?: number }).status = res.status;
            throw error;
          }

          const json = (await res.json()) as MeeraImageResponse;
          persistClientSessionId(userId, json.sessionId);

          finalText = json.reply?.trim() || 'Here is your image.';

          liveAttachments = buildImageAttachmentsFromResponse(json);

          onDelta(finalText);
        } catch (err) {
          onError?.(err);
          throw err;
        }

        // Update assistant placeholder content (Edge has already updated system_prompt + attachments)
        const now = new Date().toISOString();
        const { data: updatedRows, error: updateError } = await supabase
          .from('messages')
          .update({
            content: finalText,
            timestamp: now,
          })
          .eq('message_id', assistantMessageId)
          .select(
            'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments',
          );

        if (updateError) console.error('Assistant content update error', updateError);

        const finalRow = (updatedRows as DbMessageRow[] | null)?.[0] ?? null;
        const dbAttachments = (finalRow?.attachments as ImageAttachment[] | null) ?? [];
        const attachmentsToUse = dbAttachments.length > 0 ? dbAttachments : liveAttachments;

        const assistantMsg: AssistantMsg = {
          message_id: finalRow?.message_id ?? assistantMessageId,
          content_type: 'assistant',
          content: finalRow?.content ?? finalText,
          timestamp: finalRow?.timestamp ?? now,
          attachments: attachmentsToUse,
          is_call: false,
          failed: false,
          finish_reason: null,
        };

        onDone?.(assistantMsg);
        return;
      }

      /* ---------------------------------------------------------------------- */
      /*                                 TEXT MODE                              */
      /* ---------------------------------------------------------------------- */

      let agentCandidate = isAgentCandidate(message);
      if (process.env.NEXT_PUBLIC_AGENTIC_TEXT_ENABLED === 'true' && !agentCandidate && !normalizedAttachments.length && message.length <= 240) {
        const { data: pendingQuestion } = await supabase.from('agent_tasks').select('id')
          .eq('user_id', userId).eq('session_id', effectiveSessionId)
          .eq('status', 'partial').eq('error_code', 'needs_input')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60_000).toISOString())
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        agentCandidate = Boolean(pendingQuestion);
      }
      if (process.env.NEXT_PUBLIC_AGENTIC_TEXT_ENABLED === 'true' && !normalizedAttachments.length && agentCandidate) {
        const routeArgs = () => ({
          supabaseUrl: SUPABASE_URL!, anonKey: SUPABASE_ANON_KEY!, accessToken,
          message, sessionId: effectiveSessionId, userMessageId, assistantMessageId, signal,
        });
        let route: Awaited<ReturnType<typeof requestAgentRoute>> | null = null;
        try {
          route = await requestAgentRoute(routeArgs());
        } catch (error) {
          // A token may expire between the optimistic message insert and the
          // route request. Refresh once. Candidate tasks must not fall through
          // to normal chat because that can fabricate a connector result.
          if (getAgentRouteErrorStatus(error) === 401 && !signal?.aborted) {
            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
            if (!refreshError && refreshed.session?.access_token) {
              accessToken = refreshed.session.access_token;
              try {
                route = await requestAgentRoute(routeArgs());
              } catch (retryError) {
                console.error('Agent route retry failed', retryError);
                throw retryError;
              }
            } else {
              console.error('Agent route session refresh failed', refreshError || error);
              throw refreshError || error;
            }
          } else {
            if (!signal?.aborted) console.error('Agent route failed', error);
            throw error;
          }
        }
        if (route?.executionMode === 'agentic' && route.taskId) {
          onMeta?.({ conversationClass: route.conversationClass, agenticActive: true, taskId: route.taskId, statusLabel: 'Planning the steps', model: 'meera-agent' });
          let result: Awaited<ReturnType<typeof waitForAgent>>;
          try {
            result = await waitForAgent({
              supabaseUrl: SUPABASE_URL!, anonKey: SUPABASE_ANON_KEY!, accessToken,
              taskId: route.taskId, signal,
              onStatus: (status) => onMeta?.({
                conversationClass: route.conversationClass,
                agenticActive: true,
                taskId: route.taskId,
                statusLabel: status.current_step || (status.status === 'queued' ? 'Starting' : 'Working'),
              }),
            });
          } catch (error) {
            if (signal?.aborted) throw error;
            // The in-bubble AgentTaskPanel continues polling the durable task.
            // Do not replace it with a blank/error response just because this
            // foreground poll temporarily lost its connection.
            console.warn('Agent status polling interrupted; task panel will reconnect', error);
            onDone?.({
              message_id: assistantMessageId, content_type: 'assistant', content: '',
              timestamp: new Date().toISOString(), attachments: [], is_call: false,
              failed: false, finish_reason: null,
            });
            return;
          }
          // Keep approval tasks in their empty task bubble so AgentTaskPanel
          // remains mounted and can render the in-chat approval card.
          const pending = ['queued', 'running', 'awaiting_approval'].includes(result.status);
          const content = pending ? '' : String(result.result_text || '').trim() || 'I could not finish this task. Please try again.';
          // Keep the assistant message empty while the task is running so its
          // in-bubble task watcher can show Stop and replace progress on finish.
          if (content) onDelta(content);
          onDone?.({
            message_id: assistantMessageId, content_type: 'assistant', content,
            timestamp: new Date().toISOString(), attachments: [], is_call: false,
            failed: false, finish_reason: null,
          });
          return;
        }
      }

      let finalText = '';
      let streamError: unknown = null;
      let streamResponseAttachments: ImageAttachment[] = [];

      try {
        await streamMeera({
          supabaseUrl: SUPABASE_URL!,
          supabaseAnonKey: SUPABASE_ANON_KEY!,
          accessToken,
          message,
          messages: historyForModel,
          attachments: normalizedAttachments,
          userId,
          sessionId: effectiveSessionId,
          userMessageId,
          assistantMessageId,
          onMeta: (meta) => {
            persistClientSessionId(userId, meta?.sessionId);
            onMeta?.(meta);
          },
          signal,
          idleTimeoutMs: 30000,
          onAnswerDelta: (d) => {
            finalText += d;
            onDelta(d);
          },
          onDone: (finalMsg) => {
            if (finalMsg?.attachments?.length || finalMsg?.images?.length) {
              streamResponseAttachments = buildImageAttachmentsFromResponse({
                attachments: (finalMsg.attachments ?? []) as ImageAttachment[],
                images: finalMsg.images,
              });
            }
          },
        });
      } catch (err) {
        streamError = err;
        console.warn('streamMessage: streaming path failed, retrying non-stream fallback', err);
      }

      if (streamError) {
        const fallbackRes = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY!}`,
          },
          body: JSON.stringify({
            message,
            messages: historyForModel,
            attachments: normalizedAttachments,
            userId,
            sessionId: effectiveSessionId,
            stream: false,
            userMessageId,
            assistantMessageId,
            messageId: assistantMessageId,
          }),
          signal,
        });

        if (!fallbackRes.ok) {
          const rawError = await fallbackRes.text();
          const fallbackError = new Error(rawError || `Chat fallback failed: ${fallbackRes.status}`);
          (fallbackError as Error & { status?: number }).status = fallbackRes.status;
          throw fallbackError;
        }

        const fallbackJson = (await fallbackRes.json()) as MeeraImageResponse;
        persistClientSessionId(userId, fallbackJson.sessionId);
        onMeta?.({
          messageType: fallbackJson.messageType,
          conversationClass: fallbackJson.conversationClass,
          model: fallbackJson.model,
          webSearchEnabled: fallbackJson.webSearchEnabled,
          webSearchTriggerReason: fallbackJson.webSearchTriggerReason,
          statusEligible: fallbackJson.statusEligible,
          statusPhase: fallbackJson.statusPhase,
          statusLabel: fallbackJson.statusLabel,
        });
        streamResponseAttachments = buildImageAttachmentsFromResponse(fallbackJson);
        const fallbackReplyRaw = String(fallbackJson?.reply || '').trim();
        const fallbackReply = isForbiddenAssistantReply(fallbackReplyRaw)
          ? FINAL_OVERLOAD_FALLBACK_TEXT
          : fallbackReplyRaw;

        if (fallbackReply) {
          if (!finalText.trim()) {
            finalText = fallbackReply;
            onDelta(fallbackReply);
          } else if (fallbackReply.startsWith(finalText)) {
            const delta = fallbackReply.slice(finalText.length);
            if (delta) onDelta(delta);
            finalText = fallbackReply;
          } else {
            const stitchedDelta = `\n\n${fallbackReply}`;
            onDelta(stitchedDelta);
            finalText += stitchedDelta;
          }
        }
      }

      let resolvedFinalText = finalText.trim();
      const now = new Date().toISOString();
      let row: DbMessageRow | undefined;
      const assistantRowSelect =
        'message_id, user_id, content_type, content, timestamp, session_id, is_call, model, message_type, image_url, attachments';
      const readAssistantRow = async (): Promise<DbMessageRow | undefined> => {
        const { data, error } = await supabase
          .from('messages')
          .select(assistantRowSelect)
          .eq('message_id', assistantMessageId)
          .limit(1);

        if (error) {
          console.error('Assistant final row fetch error', error);
          return undefined;
        }
        return (data as DbMessageRow[] | null)?.[0] ?? undefined;
      };

      // Backend is the single writer for final assistant content.
      // Poll briefly so we don't race and overwrite finalized backend replies with partial deltas.
      const readDelaysMs = [
        0,
        120,
        250,
        500,
        900,
        1400,
        2200,
      ];
      for (const delayMs of readDelaysMs) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        const candidate = await readAssistantRow();
        if (!candidate) continue;
        row = candidate;
        if (
          typeof candidate.content === 'string' &&
          candidate.content.trim() &&
          !isForbiddenAssistantReply(candidate.content)
        ) {
          resolvedFinalText = candidate.content.trim();
          break;
        }
      }

      if (!resolvedFinalText) {
        resolvedFinalText = FINAL_OVERLOAD_FALLBACK_TEXT;
      }

      const rowContent = typeof row?.content === 'string' ? row.content.trim() : '';
      const finalContent = rowContent && !isForbiddenAssistantReply(rowContent) ? rowContent : resolvedFinalText;
      const rowAttachments = (row?.attachments as ImageAttachment[] | null) ?? [];

      const assistantMsg: AssistantMsg = {
        message_id: row?.message_id ?? assistantMessageId,
        content_type: 'assistant',
        content: finalContent,
        timestamp: row?.timestamp ?? now,
        attachments: rowAttachments.length > 0 ? rowAttachments : streamResponseAttachments,
        is_call: false,
        failed: false,
        finish_reason: null,
      };

      onDone?.(assistantMsg);
    } catch (err) {
      onError?.(err);
      throw err;
    }
  },
};

/* ---------- Save Interaction ---------- */

export const saveInteraction = (payload: SaveInteractionPayload) => {
  return api.post(API_ENDPOINTS.CALL.SAVE_INTERACTION, payload);
};
