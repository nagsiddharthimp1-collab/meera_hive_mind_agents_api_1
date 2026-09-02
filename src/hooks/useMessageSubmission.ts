'use client';

import { chatService } from '@/app/api/services/chat';
import { useToast } from '@/components/ui/ToastProvider';
import { usePricingModal } from '@/contexts/PricingModalContext';
import { SUBSCRIPTION_QUERY_KEY } from '@/hooks/useSubscriptionStatus';
import { createLocalTimestamp } from '@/lib/dateUtils';
import { supabase } from '@/lib/supabaseClient';
import { ChatAttachmentInputState, ChatMessageFromServer } from '@/types/chat';
import { useQueryClient } from '@tanstack/react-query';
import React, { MutableRefObject, useCallback, useRef } from 'react';

interface UseMessageSubmissionProps {
  message: string;
  currentAttachments: ChatAttachmentInputState[];
  chatMessages: ChatMessageFromServer[];
  isSearchActive: boolean; // still passed from Conversation, but not used here
  isSending: boolean;
  setIsSending: (isSending: boolean) => void;
  setCurrentThoughtText: (text: string) => void;
  lastOptimisticMessageIdRef: MutableRefObject<string | null>;
  setChatMessages: React.Dispatch<React.SetStateAction<ChatMessageFromServer[]>>;
  setIsAssistantTyping: (isTyping: boolean) => void;
  clearAllInput: () => void;
  scrollToBottom: (smooth?: boolean, force?: boolean) => void;
  onMessageSent?: () => void;
}

const ATTACHMENTS_BUCKET = 'attachments';

type UploadedMeta = {
  storagePath: string;
  publicUrl: string;
  name: string;
  mimeType: string;
  size: number;
  type: 'image' | 'document';
};

type OutgoingAttachment = {
  name: string;
  url: string;
  mimeType: string;
  size: number;
  type: 'image' | 'document';
  bucket: string;
  storagePath: string;
};

function hasAssistantImageAttachment(message: ChatMessageFromServer): boolean {
  return (message.attachments ?? []).some((attachment) => {
    const type = String(attachment.type || '').toLowerCase();
    const url = String(attachment.url || '').trim();
    return Boolean(url && (type === 'image' || type.startsWith('image/')));
  });
}

function hasExistingAssistantImage(messages: ChatMessageFromServer[]): boolean {
  return messages.some((message) => {
    if (message.content_type !== 'assistant') return false;
    if (hasAssistantImageAttachment(message)) return true;
    return Array.isArray(message.generatedImages) && message.generatedImages.length > 0;
  });
}

function hasIncomingImageAttachment(attachments: ChatAttachmentInputState[]): boolean {
  return attachments.some((attachment) => {
    if (attachment.type === 'image') return true;
    return attachment.file?.type?.startsWith('image/') ?? false;
  });
}

function isLikelyImageGeneratePrompt(text: string): boolean {
  const normalized = text.toLowerCase();
  const hasImageNoun =
    /\b(image|picture|photo|pic|illustration|drawing|artwork|render|wallpaper|poster|logo|avatar|thumbnail|mockup|icon)\b/.test(
      normalized,
    );
  const hasGenerateVerb = /\b(generate|create|draw|make|render|illustrate|paint|sketch|design)\b/.test(normalized);
  const hasShowOrSendImage = /\b(show|send|give)\b.*\b(image|picture|photo|pic)\b/.test(normalized);
  return hasShowOrSendImage || (hasGenerateVerb && hasImageNoun);
}

function isLikelyImageEditPrompt(text: string): boolean {
  const normalized = text.toLowerCase();
  const hasEditVerb =
    /\b(change|edit|modify|remove|replace|swap|erase|add|crop|blur|sharpen|resize|rotate|flip|brighten|darken|fix|retouch|enhance|improve|adjust|tweak|beautify|stylize|style|transform|restyle|convert|makeover)\b/.test(
      normalized,
    );
  const hasTarget =
    /\b(background|bg|colour|color|logo|text|font|watermark|person|people|object|sky|shirt|hair|eyes|face|layout|button|banner)\b/.test(
      normalized,
    );
  if (hasEditVerb && hasTarget) return true;
  if (/\b(change|set)\b.*\b(background|bg)\b.*\b(colou?r)\b/.test(normalized)) return true;
  return false;
}

function isLikelyAttachmentEditCue(text: string): boolean {
  const normalized = text.toLowerCase();
  const hasTransformVerb =
    /\b(edit|change|modify|remove|replace|add|improve|enhance|retouch|stylize|upscale|restore|clean|fix|make|turn|set|adjust|tweak|transform|restyle|convert|give)\b/.test(
      normalized,
    );
  const hasImageRef = /\b(image|photo|picture|pic|portrait|selfie)\b/.test(normalized);
  const hasStyleCue = /\b(look|style|vibe|theme|aesthetic|avatar|character|costume|outfit|filter)\b/.test(normalized);
  const hasSubjectRef = /\b(him|her|them|me|my|our|it|this|that|face)\b/.test(normalized);
  return hasTransformVerb && (hasImageRef || hasStyleCue || hasSubjectRef);
}

function isLikelyAttachmentReadCue(text: string): boolean {
  return /\b(read|describe|analy[sz]e|explain|identify|ocr|transcribe|extract|summari[sz]e|caption|what(?:'s| is) in)\b/.test(
    text.toLowerCase(),
  );
}

function isLikelyAttachmentTextRewriteCue(text: string): boolean {
  const normalized = text.toLowerCase();
  const hasTextArtifact =
    /\b(reply|response|message|email|mail|dm|inmail|linkedin|outreach|copy|caption|headline|bio|profile|note|draft|line|paragraph|sentence)\b/.test(
      normalized,
    );
  const hasRewriteCue =
    /\b(rewrite|rephrase|revise|polish|tighten|shorten|draft|write|compose|fix|edit|improve|clean)\b/.test(
      normalized,
    ) || /\b(crisp|crisper|concise|shorter|clearer|cleaner|better|professional|punchier)\b/.test(normalized);
  return hasTextArtifact && hasRewriteCue;
}

function isLikelyAttachmentAdviceCue(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(tell me what to do|what should i|what can i|how can i|how do i|how should i)\b/.test(normalized) ||
    /\b(suggest|recommend|advise|advice|feedback|critique|review)\b/.test(normalized) ||
    /\b(what|how)\b.*\b(change|improve|fix|clean|polish|adjust|tweak|make better)\b/.test(normalized)
  );
}

function isLikelyImageTurnForLoadingStatus(
  messageText: string,
  attachments: ChatAttachmentInputState[],
  messages: ChatMessageFromServer[],
): boolean {
  const hasImageAttachment = hasIncomingImageAttachment(attachments);
  const hasGenerateIntent = isLikelyImageGeneratePrompt(messageText);
  const hasEditIntent = isLikelyImageEditPrompt(messageText);
  const hasAttachmentEditIntent = isLikelyAttachmentEditCue(messageText);
  const hasAttachmentReadIntent = hasImageAttachment && isLikelyAttachmentReadCue(messageText);
  const hasAttachmentRewriteIntent = hasImageAttachment && isLikelyAttachmentTextRewriteCue(messageText);
  const hasAttachmentAdviceIntent = hasImageAttachment && isLikelyAttachmentAdviceCue(messageText);
  const hasPreviousAssistantImage = hasExistingAssistantImage(messages);
  const hasPreviousImageEditIntent =
    hasPreviousAssistantImage &&
    hasEditIntent &&
    !hasAttachmentReadIntent &&
    !hasAttachmentRewriteIntent &&
    !hasAttachmentAdviceIntent;

  return (
    !hasAttachmentRewriteIntent &&
    !hasAttachmentAdviceIntent &&
    (hasGenerateIntent ||
      hasPreviousImageEditIntent ||
      (hasImageAttachment &&
        (hasEditIntent || hasAttachmentEditIntent) &&
        !hasAttachmentReadIntent &&
        !hasAttachmentRewriteIntent))
  );
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  if ('status' in error && typeof error.status === 'number') return error.status;
  return null;
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return null;
}

async function uploadAttachmentToStorage(file: File, type: 'image' | 'document'): Promise<UploadedMeta> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() || '' : '';
  const randomSuffix = Math.random().toString(36).slice(2);
  const path = `${Date.now()}-${randomSuffix}${ext ? '.' + ext : ''}`;

  const { error: uploadError } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (uploadError) {
    console.error('Supabase upload error', uploadError);
    throw uploadError;
  }

  const { data } = supabase.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(path);
  const publicUrl = data?.publicUrl || '';

  if (!publicUrl) {
    throw new Error('Failed to obtain public URL from Supabase');
  }

  return {
    storagePath: path,
    publicUrl,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    type,
  };
}

export const useMessageSubmission = ({
  message,
  currentAttachments,
  chatMessages,
  // isSearchActive, // not needed here
  isSending,
  setIsSending,
  setCurrentThoughtText,
  lastOptimisticMessageIdRef,
  setChatMessages,
  setIsAssistantTyping,
  clearAllInput,
  scrollToBottom,
  onMessageSent,
}: UseMessageSubmissionProps) => {
  const { showToast } = useToast();
  const { openModal } = usePricingModal();
  const queryClient = useQueryClient();

  const messageRelationshipMapRef = useRef<Map<string, string>>(new Map());
  const mostRecentAssistantMessageIdRef = useRef<string | null>(null);

  const refreshSubscriptionAccess = useCallback(async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_QUERY_KEY });
      await queryClient.refetchQueries({ queryKey: SUBSCRIPTION_QUERY_KEY, type: 'active' });
    } catch (error) {
      console.warn('Unable to refresh free chat access state:', error);
    }
  }, [queryClient]);

  const createOptimisticMessage = useCallback(
    (optimisticId: string, messageText: string, attachments: ChatAttachmentInputState[]): ChatMessageFromServer => {
      const lastMessage = chatMessages[chatMessages.length - 1];
      let newTimestamp = new Date();

      if (lastMessage && new Date(lastMessage.timestamp) >= newTimestamp) {
        newTimestamp = new Date(new Date(lastMessage.timestamp).getTime() + 6);
      }

      return {
        message_id: optimisticId,
        content: messageText,
        content_type: 'user',
        timestamp: createLocalTimestamp(newTimestamp),
        attachments: attachments.map((att) => ({
          name: att.file.name,
          type: att.file.type === 'application/pdf' ? 'document' : att.type === 'image' ? 'image' : 'file',
          url: att.publicUrl || att.previewUrl || '',
          size: att.file.size,
          file: att.file,
        })),
        try_number: 1,
      };
    },
    [chatMessages],
  );

  const clearMessageRelationshipMap = useCallback(() => {
    messageRelationshipMapRef.current.clear();
    mostRecentAssistantMessageIdRef.current = null;
  }, []);

  /**
   * IMPORTANT: Do not replace the entire chat array after streaming ends. Only patch the existing assistant placeholder
   * with the latest server attachments. This prevents scroll jumps.
   */
  const refreshLatestMessagesFromServer = useCallback(
    async (assistantIdToPatch?: string) => {
      try {
        if (!assistantIdToPatch) return;

        const res = await chatService.getMessageById(assistantIdToPatch);
        const latestServerAssistant = res?.data as ChatMessageFromServer | null;

        if (!latestServerAssistant || latestServerAssistant.content_type !== 'assistant') return;

        setChatMessages((prev) =>
          prev.map((m) =>
            m.message_id === assistantIdToPatch
              ? {
                  ...m,
                  attachments: latestServerAssistant.attachments?.length
                    ? latestServerAssistant.attachments
                    : (m.attachments ?? []),
                  finish_reason: latestServerAssistant.finish_reason ?? m.finish_reason ?? null,
                }
              : m,
          ),
        );
      } catch (err) {
        console.error('Failed to refresh assistant attachments:', err);
      }
    },
    [setChatMessages],
  );

  const executeSubmission = useCallback(
    async (
      messageText: string,
      attachments: ChatAttachmentInputState[] = [],
      tryNumber: number = 1,
      optimisticIdToUpdate?: string,
      isFromManualRetry: boolean = false,
    ) => {
      if (isSending) {
        showToast('Please wait for the current response to finish.', {
          type: 'info',
          position: 'conversation',
        });
        return;
      }

      const trimmedMessage = messageText.trim();
      const hasText = trimmedMessage.length > 0;
      const hasAttachments = attachments.length > 0;

      if (!hasText && !hasAttachments) {
        showToast('Type a message or add an attachment.', {
          type: 'info',
          position: 'conversation',
        });
        return;
      }

      // STEP 1: upload attachments
      let uploaded: UploadedMeta[] = [];
      if (hasAttachments) {
        try {
          uploaded = await Promise.all(attachments.map((att) => uploadAttachmentToStorage(att.file, att.type)));
        } catch (uploadErr) {
          console.error('Upload failed', uploadErr);
          showToast('Failed to upload file(s). Please try again.', {
            type: 'error',
            position: 'conversation',
          });
          return;
        }
      }

      const attachmentsWithStorage: ChatAttachmentInputState[] = attachments.map((att, index) => {
        const meta = uploaded[index];
        if (!meta) return att;
        return {
          ...att,
          storagePath: meta.storagePath,
          publicUrl: meta.publicUrl,
        };
      });

      const optimisticId = optimisticIdToUpdate || `optimistic-${Date.now()}`;
      const isImageGenerationTurn = isLikelyImageTurnForLoadingStatus(
        trimmedMessage,
        attachmentsWithStorage,
        chatMessages,
      );

      // STEP 2: optimistic user + assistant placeholder
      if (!optimisticIdToUpdate) {
        const userMessage = createOptimisticMessage(optimisticId, trimmedMessage, attachmentsWithStorage);

        const assistantMessageId = `assistant-${Date.now()}`;
        const emptyAssistantMessage: ChatMessageFromServer = {
          message_id: assistantMessageId,
          content: '',
          content_type: 'assistant',
          timestamp: createLocalTimestamp(),
          attachments: [],
          isGeneratingImage: isImageGenerationTurn,
          try_number: tryNumber,
          failed: false,
          finish_reason: null,
        };

        messageRelationshipMapRef.current.set(optimisticId, assistantMessageId);
        mostRecentAssistantMessageIdRef.current = assistantMessageId;

        setChatMessages((prev) => [...prev, userMessage, emptyAssistantMessage]);

        clearAllInput();
        onMessageSent?.();

        // Only scroll on user's own send
        setTimeout(() => scrollToBottom(true, true), 150);
      } else {
        setChatMessages((prev) =>
          prev.map((msg) => (msg.message_id === optimisticId ? { ...msg, failed: false, try_number: tryNumber } : msg)),
        );
      }

      setIsSending(true);
      setCurrentThoughtText('');
      lastOptimisticMessageIdRef.current = optimisticId;
      setIsAssistantTyping(true);

      // STEP 3: build payload
      const outgoingAttachments: OutgoingAttachment[] = uploaded.map((meta) => ({
        name: meta.name,
        url: meta.publicUrl,
        mimeType: meta.mimeType,
        size: meta.size,
        type: meta.type,
        bucket: ATTACHMENTS_BUCKET,
        storagePath: meta.storagePath,
      }));

      const assistantId = messageRelationshipMapRef.current.get(optimisticId);

      try {
        let fullAssistantText = '';

        await chatService.streamMessage({
          message: trimmedMessage,
          attachments: outgoingAttachments,
          userMessageId: optimisticId,
          assistantMessageId: assistantId,
          onMeta: (meta) => {
            const messageType = String(meta?.messageType || '')
              .trim()
              .toLowerCase();
            if (!messageType) return;
            setChatMessages((prev) =>
              prev.map((msg) =>
                msg.message_id === optimisticId
                  ? {
                      ...msg,
                      message_type: messageType,
                    }
                  : msg,
              ),
            );
          },
          onDelta: (delta) => {
            fullAssistantText += delta;
            if (!assistantId) return;

            setChatMessages((prev) =>
              prev.map((msg) =>
                msg.message_id === assistantId
                  ? {
                      ...msg,
                      content: (msg.content || '') + delta,
                      failed: false,
                      try_number: tryNumber,
                    }
                  : msg,
              ),
            );
          },
          onDone: async (finalMsg) => {
            const finalMsgContent = String(finalMsg?.content || '').trim();
            if (assistantId) {
              setChatMessages((prev) =>
                prev.map((msg) =>
                  msg.message_id === assistantId
                    ? {
                        ...msg,
                        content:
                          finalMsgContent ||
                          msg.content ||
                          fullAssistantText ||
                          'Sorry, I could not generate a response. Please try again.',
                        failed: false,
                        isGeneratingImage: false,
                        try_number: tryNumber,
                        attachments:
                          finalMsg?.attachments && finalMsg.attachments.length > 0
                            ? finalMsg.attachments
                            : (msg.attachments ?? []),
                      }
                    : msg,
                ),
              );
            }

            // Patch only attachments, do not replace entire chat array
            await refreshLatestMessagesFromServer(assistantId);
            await refreshSubscriptionAccess();
          },
          onError: (err) => {
            throw err;
          },
        });

        return;
      } catch (error) {
        console.error('Error sending message:', error);
        const status = getErrorStatus(error);
        const code = getErrorCode(error);

        if (status === 402 && code === 'FREE_CHAT_TURN_LIMIT_REACHED') {
          setChatMessages((prev) =>
            prev.filter((msg) => msg.message_id !== optimisticId && (!assistantId || msg.message_id !== assistantId)),
          );
          showToast('Your free conversations are complete. Upgrade to continue.', {
            type: 'info',
            position: 'conversation',
          });
          openModal('free_chat_turn_limit_reached', false);
          await refreshSubscriptionAccess();
          return;
        }

        if (status === 402) {
          showToast('Payment required to continue chatting. Redirecting to checkout…', {
            type: 'info',
            position: 'conversation',
          });
          if (typeof window !== 'undefined') {
            window.location.href = '/payment';
          }
          return;
        }

        showToast('Failed to respond, try again', {
          type: 'error',
          position: 'conversation',
        });

        setChatMessages((prev) =>
          prev.map((msg) => {
            if (msg.message_id === optimisticId) return { ...msg, failed: true };
            if (assistantId && msg.message_id === assistantId) {
              return {
                ...msg,
                failed: true,
                isGeneratingImage: false,
                failedMessage: 'Failed to respond, try again',
              };
            }
            return msg;
          }),
        );
      } finally {
        setIsSending(false);
        setIsAssistantTyping(false);
        lastOptimisticMessageIdRef.current = null;

        if (isFromManualRetry) {
          setTimeout(() => scrollToBottom(true, true), 150);
        }
      }
    },
    [
      isSending,
      chatMessages,
      createOptimisticMessage,
      setChatMessages,
      clearAllInput,
      scrollToBottom,
      setIsSending,
      setCurrentThoughtText,
      lastOptimisticMessageIdRef,
      setIsAssistantTyping,
      showToast,
      onMessageSent,
      refreshLatestMessagesFromServer,
      openModal,
      refreshSubscriptionAccess,
    ],
  );

  const handleRetryMessage = useCallback(
    (failedMessage: ChatMessageFromServer) => {
      const messageContent = failedMessage.content;
      const messageAttachments = failedMessage.attachments || [];
      const currentTryNumber = failedMessage.try_number || 0;
      const nextTryNumber = currentTryNumber + 1;
      const failedMessageId = failedMessage.message_id;

      const retryAttachments: ChatAttachmentInputState[] = messageAttachments
        .filter((att) => att.file)
        .map((att) => {
          const file = att.file as File;
          const blob = file.slice(0, file.size, file.type);
          const newFile = new File([blob], file.name, { type: file.type });
          const isPdf = file.type === 'application/pdf';

          return {
            file: newFile,
            previewUrl: att.url,
            type: isPdf ? 'document' : 'image',
          };
        });

      if (messageContent || retryAttachments.length > 0) {
        executeSubmission(messageContent, retryAttachments, nextTryNumber, failedMessageId, true);
      }
    },
    [executeSubmission],
  );

  const handleSubmit = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      executeSubmission(message, currentAttachments);
    },
    [executeSubmission, message, currentAttachments],
  );

  const getMostRecentAssistantMessageId = useCallback(() => {
    return mostRecentAssistantMessageIdRef.current;
  }, []);

  return {
    handleSubmit,
    executeSubmission,
    handleRetryMessage,
    getMostRecentAssistantMessageId,
    clearMessageRelationshipMap,
  };
};
