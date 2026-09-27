import {
  CodeBlock,
  ImageSkeleton,
  MyCustomA,
  MyCustomBlockquote,
  MyCustomDel,
  MyCustomH1,
  MyCustomH2,
  MyCustomH3,
  MyCustomH4,
  MyCustomH5,
  MyCustomH6,
  MyCustomHr,
  MyCustomImg,
  MyCustomLi,
  MyCustomOl,
  MyCustomParagraph,
  MyCustomSub,
  MyCustomSup,
  MyCustomTable,
  MyCustomTbody,
  MyCustomTd,
  MyCustomTh,
  MyCustomThead,
  MyCustomTr,
  MyCustomUl,
  renderStandardInlineCode,
} from '@/components/MessageRenderDesign/MarkdownComponents';
import { ImageModal } from '@/components/ui/ImageModal';
import { formatTime } from '@/lib/dateUtils';
import { normalizeAssistantMarkdownContent } from '@/lib/markdownText';
import { startGoogleAgentConnection } from '@/lib/auth/startGoogleAgentConnection';
import { supabase } from '@/lib/supabaseClient';
import { truncateFileName } from '@/lib/stringUtils';
import { ChatMessageFromServer, GeneratedImage } from '@/types/chat';
import Image from 'next/image';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaFilePdf, FaStar } from 'react-icons/fa';
import {
  FiCheck,
  FiChevronDown,
  FiChevronUp,
  FiCopy,
  FiDownload,
  FiPaperclip,
  FiRefreshCw,
  FiSearch,
  FiStar,
} from 'react-icons/fi';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/* ---------------- Thinking status text inside the pill ---------------- */

type ThinkingPhase = 'idle' | 'orchestrating' | 'searching' | 'thinking' | 'thoughts' | 'generating_image';

type ThinkingStatusTextProps = {
  phase: ThinkingPhase;
  thoughtText?: string;
  isImageGeneration?: boolean;
};

const isWorkConversation = (conversationClass?: string) =>
  /^work(?:$|[-_\s])/.test(
    String(conversationClass || '')
      .trim()
      .toLowerCase(),
  );

const WorkStatusPanel: React.FC<{ statusLabel?: string }> = ({ statusLabel }) => {
  const normalizedStatus = String(statusLabel || '').trim();
  const isGenericStatus = /^(orchestrating|searching memories|thinking)$/i.test(normalizedStatus);
  const nextThinkingLabel = normalizedStatus && !isGenericStatus ? normalizedStatus : 'Thinking';
  const [thinkingLabel, setThinkingLabel] = useState('Thinking');
  const hasShownLiveStatus = useRef(false);

  useEffect(() => {
    if (nextThinkingLabel === 'Thinking') {
      setThinkingLabel('Thinking');
      return;
    }

    // Let the initial three-step frame be visible before the final line starts
    // describing the live work. Later status changes can update quickly.
    const timeout = window.setTimeout(
      () => {
        setThinkingLabel(nextThinkingLabel);
        hasShownLiveStatus.current = true;
      },
      hasShownLiveStatus.current ? 150 : 900,
    );

    return () => window.clearTimeout(timeout);
  }, [nextThinkingLabel]);

  return (
    <div className="w-full max-w-sm text-primary" role="status" aria-live="polite">
      <p className="mb-2 text-[15px] font-medium">Working</p>
      <div className="space-y-1.5 text-[14px] text-primary/75">
        {[
          'Orchestrating',
          'Searching memories',
          thinkingLabel,
        ].map((label, index) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                index === 2 && thinkingLabel !== 'Thinking' ? 'animate-pulse bg-primary/65' : 'border border-primary/45'
              }`}
              aria-hidden="true"
            />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const AgentTaskPanel: React.FC<{ taskId: string; initialStep?: string }> = ({ taskId, initialStep }) => {
  const [status, setStatus] = useState('running');
  const [step, setStep] = useState(initialStep || 'Starting');
  const [result, setResult] = useState('');
  const [cost, setCost] = useState<number | null>(null);
  const [approval, setApproval] = useState<{ id: string; action_type: string; payload: Record<string, string>; expires_at: string } | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
      let active = true;
      const read = async () => {
        const { data: response, error } = await supabase.functions.invoke('agentic', {
          body: { operation: 'status', taskId },
        });
        const data = response?.task as { status: string; current_step?: string | null; result_text?: string | null; estimated_cost_usd?: number } | undefined;
        if (error && active) setActionError('Could not refresh this task.');
        if (!active || !data) return;
      setActionError('');
      setStatus(data.status);
      setStep(data.current_step || (data.status === 'queued' ? 'Starting' : 'Working'));
      setResult(data.result_text || '');
      const nextCost = Number(data.estimated_cost_usd);
      if (Number.isFinite(nextCost)) setCost(nextCost);
      if (data.status === 'awaiting_approval') {
        const { data: pending } = await supabase.from('agent_approvals')
          .select('id,action_type,payload,expires_at').eq('task_id', taskId).eq('status', 'pending')
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (active) setApproval(pending as typeof approval);
        if (pending && Date.parse(pending.expires_at) <= Date.now()) {
          void supabase.functions.invoke('agentic', { body: { operation: 'expire', taskId } });
        }
      } else if (active) {
        setApproval(null);
      }
      if (['completed', 'partial', 'failed', 'cancelled'].includes(data.status)) window.clearInterval(timer);
    };
    const timer = window.setInterval(() => void read(), 1800);
    void read();
    void supabase.functions.invoke('agentic', { body: { operation: 'connection_status' } })
      .then(({ data }) => { if (active) { setConnected(data?.connected === true); setConnectedEmail(data?.email || ''); } });
    return () => { active = false; window.clearInterval(timer); };
  }, [taskId]);

  const running = status === 'queued' || status === 'running';
  const stop = async () => {
    const { error } = await supabase.functions.invoke('agentic', { body: { operation: 'cancel', taskId } });
    if (!error) setStatus('cancelled');
  };
  const decide = async (operation: 'approve' | 'reject') => {
    if (!approval) return;
    setActionError('');
    const { data, error } = await supabase.functions.invoke('agentic', { body: { operation, approvalId: approval.id } });
    if (error || data?.error) {
      setActionError(data?.error || error?.message || 'Could not complete the action.');
      return;
    }
    setStatus(operation === 'approve' ? 'completed' : 'cancelled');
    setApproval(null);
  };
  const connect = async () => {
    try { await startGoogleAgentConnection(); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Could not connect Google.'); }
  };
  const disconnect = async () => {
    const { error } = await supabase.functions.invoke('agentic', { body: { operation: 'disconnect_google' } });
    if (error) setActionError(error.message);
    else { setConnected(false); setConnectedEmail(''); }
  };
  if (status !== 'awaiting_approval') {
    return (
      <div className="text-[14px] text-primary/75" role="status" aria-live="polite">
        {running ? <span>{step}</span> : <ReactMarkdown>{result || 'This task ended.'}</ReactMarkdown>}
        {running && <button type="button" onClick={() => void stop()} className="ml-3 underline underline-offset-2">Stop</button>}
        {actionError && <p className="mt-1 text-red-600">{actionError}</p>}
      </div>
    );
  }
  return (
    <div className="w-full max-w-sm text-primary" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-4">
          <p className="text-[15px] font-medium">{running ? 'Working on it' : status === 'awaiting_approval' ? 'Needs your approval' : status === 'completed' ? 'Done' : status === 'partial' ? 'Partly done' : status === 'cancelled' ? 'Stopped' : 'Task stopped'}</p>
        {running && <button type="button" onClick={() => void stop()} className="text-sm underline underline-offset-2">Stop</button>}
      </div>
      {status === 'awaiting_approval' && approval && Date.parse(approval.expires_at) > Date.now() ? (
        <div className="mt-2 rounded-lg border border-primary/20 p-3 text-sm">
          <p className="font-medium">Review {approval.action_type === 'propose_email' ? 'email' : 'calendar event'}</p>
          {approval.action_type === 'propose_email' ? (
            <div className="mt-2 space-y-1 break-words">
              <p>To: {approval.payload.to}</p><p>Subject: {approval.payload.subject}</p>
              <p className="whitespace-pre-wrap">{approval.payload.body}</p>
            </div>
          ) : (
            <div className="mt-2 space-y-1 break-words">
              <p>{approval.payload.summary}</p><p>{approval.payload.start} to {approval.payload.end}</p>
              <p>{approval.payload.timezone}</p><p className="whitespace-pre-wrap">{approval.payload.description}</p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            {connected ? <button type="button" onClick={() => void decide('approve')} className="rounded-md bg-primary px-3 py-1.5 text-background">Approve</button>
              : <button type="button" onClick={() => void connect()} className="rounded-md bg-primary px-3 py-1.5 text-background">Connect Google</button>}
            <button type="button" onClick={() => void decide('reject')} className="underline underline-offset-2">Cancel action</button>
          </div>
        </div>
      ) : <p className="mt-1 text-[14px] text-primary/75">{running ? step : result || 'This task ended.'}</p>}
      {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}
      {!running && status !== 'awaiting_approval' && cost !== null && <p className="mt-2 text-xs text-primary/60">Estimated model and search cost: ${cost.toFixed(4)}</p>}
        {connected && <p className="mt-2 text-xs text-primary/60">Google connected as {connectedEmail}. <button type="button" onClick={() => void disconnect()} className="underline underline-offset-2">Disconnect</button></p>}
        <p className="mt-2 text-xs text-primary/50">DeepSeek V4 Flash powers this task through OpenRouter. Relevant chat context and search queries may be sent to the model and search provider.</p>
      </div>
  );
};

const ThinkingStatusText: React.FC<ThinkingStatusTextProps> = ({ phase, thoughtText, isImageGeneration = false }) => {
  const text = useMemo(() => {
    if (phase === 'orchestrating') return 'Orchestrating';
    if (phase === 'generating_image') return 'Generating image';
    if (phase === 'searching') return isImageGeneration ? 'Generating image' : 'Searching memories';
    if (phase === 'thinking') return isImageGeneration ? 'Generating image' : 'Thinking';

    if (phase === 'thoughts' && thoughtText) {
      const firstLine =
        thoughtText
          .split('\n')
          .map((line) =>
            line
              .replace(/\*\*/g, '')
              .replace(/^[-*]\s*/, '')
              .trim(),
          )
          .find(Boolean) || '';

      return firstLine;
    }

    return '';
  }, [
    isImageGeneration,
    phase,
    thoughtText,
  ]);

  if (!text) return null;

  return (
    <span className="inline-flex items-center justify-center text-primary text-[15px] leading-none whitespace-nowrap">
      <span>{text}</span>
      <span className="flex items-center ml-1 gap-1">
        <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
        <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
        <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" />
      </span>
    </span>
  );
};

/* ---------------- Helpers for attachment classification ---------------- */

function isImageAttachment(att: { type?: string | null }) {
  const t = (att.type || '').toLowerCase();
  return t === 'image' || t.startsWith('image/');
}

function isPdfAttachment(att: { type?: string | null; name?: string | null }) {
  const t = (att.type || '').toLowerCase();
  if (t === 'pdf' || t === 'application/pdf' || t === 'document') return true;
  const n = (att.name || '').toLowerCase();
  return n.endsWith('.pdf');
}

/* ---------------- Main component ---------------- */

export const RenderedMessageItem: React.FC<{
  message: ChatMessageFromServer;
  isStreaming: boolean;
  onRetry?: (message: ChatMessageFromServer) => void;
  onToggleStar?: (message: ChatMessageFromServer) => void;
  isStarred?: boolean;
  isLastFailedMessage?: boolean;
  showTypingIndicator?: boolean;
  thoughtText?: string;
  hasMinHeight?: boolean;
  dynamicMinHeight?: number;
}> = React.memo(
  ({
    message,
    isStreaming,
    onRetry,
    onToggleStar,
    isStarred = false,
    isLastFailedMessage,
    showTypingIndicator,
    thoughtText,
    hasMinHeight,
    dynamicMinHeight,
  }) => {
    const [isCopied, setIsCopied] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [showExpandButton, setShowExpandButton] = useState(false);
    const [imageModalOpen, setImageModalOpen] = useState(false);
    const [currentImageUrl, setCurrentImageUrl] = useState('');
    const [phase, setPhase] = useState<ThinkingPhase>('idle');

    const contentRef = useRef<HTMLDivElement>(null);

    const isUser = message.content_type === 'user';
    const bgColor = isUser ? 'bg-primary' : 'bg-card';
    const textColor = isUser ? 'text-background' : 'text-primary';

    // Inline generated images (from chat response, not just attachments)
    const inlineGeneratedImages: GeneratedImage[] = useMemo(
      () =>
        (message.generatedImages || []).map((img) => ({
          ...img,
          dataUrl: img.dataUrl || `data:${img.mimeType || 'image/png'};base64,${img.data}`,
        })),
      [message.generatedImages],
    );

    const hasTextContent = !!message.content || (message.content_type === 'assistant' && !!message.failed);
    const displayContent = useMemo(
      () =>
        message.content_type === 'assistant'
          ? normalizeAssistantMarkdownContent(message.content || '')
          : message.content || '',
      [message.content, message.content_type],
    );

    const hasServerAttachments = !!message.attachments && message.attachments.length > 0;

    const hasAnyImages =
      inlineGeneratedImages.length > 0 || (message.attachments || []).some((att) => isImageAttachment(att));

    const hasAttachments = hasServerAttachments || inlineGeneratedImages.length > 0;
    const hasMainContent = hasTextContent || hasAttachments;
    const showWorkStatus =
      !isUser &&
      (showTypingIndicator || isStreaming) &&
      !message.isGeneratingImage &&
      !message.agentTaskId &&
      isWorkConversation(message.conversationClass);
    // The task speaks through this assistant message; progress is plain text in
    // the same bubble and disappears once Meera's answer or question arrives.
    const showAgentStatus = !isUser && Boolean(message.agentTaskId) && !hasTextContent;

    /* Phase progression:
       - text turns: Orchestrating -> Searching memories -> Thinking
       - image turns: Orchestrating -> Generating image
    */
    useEffect(() => {
      if (showTypingIndicator && !isUser) {
        setPhase('orchestrating');

        const timeouts: NodeJS.Timeout[] = [];

        timeouts.push(
          setTimeout(() => {
            setPhase((prev) =>
              prev === 'orchestrating' ? (message.isGeneratingImage ? 'generating_image' : 'searching') : prev,
            );
          }, 3500),
        );

        if (!message.isGeneratingImage) {
          timeouts.push(
            setTimeout(() => {
              setPhase((prev) => (prev === 'searching' ? 'thinking' : prev));
            }, 11000),
          );
        }

        return () => {
          timeouts.forEach(clearTimeout);
        };
      } else {
        if (!thoughtText) {
          setPhase('idle');
        }
      }
    }, [
      showTypingIndicator,
      isUser,
      thoughtText,
      message.isGeneratingImage,
    ]);

    /* When model thoughts arrive, show them */
    useEffect(() => {
      if (!isUser && thoughtText && thoughtText.trim()) {
        setPhase('thoughts');
      }
    }, [thoughtText, isUser]);

    /* Overflow handling for user bubble */
    useEffect(() => {
      const element = contentRef.current;
      if (isUser && element && !isExpanded) {
        const checkOverflow = () => {
          const isClamped = element.scrollHeight > element.clientHeight;
          if (showExpandButton !== isClamped) {
            setShowExpandButton(isClamped);
          }
        };
        const resizeObserver = new ResizeObserver(checkOverflow);
        resizeObserver.observe(element);
        checkOverflow();

        return () => resizeObserver.disconnect();
      }
    }, [
      isUser,
      isExpanded,
      showExpandButton,
    ]);

    if (message.content_type === 'system') {
      return (
        <div className="text-center my-2">
          <p className="text-xs text-primary/60 italic px-4 py-1 bg-primary/5 rounded-full inline-block">
            {message.content}
          </p>
        </div>
      );
    }

    const handleCopyToClipboard = () => {
      if (!displayContent) return;
      navigator.clipboard
        .writeText(displayContent)
        .then(() => {
          setIsCopied(true);
          setTimeout(() => setIsCopied(false), 2000);
        })
        .catch((err) => {
          console.error('Failed to copy text: ', err);
        });
    };

    const handleRetry = () => {
      if (onRetry) {
        onRetry(message);
      }
    };

    const handleToggleStar = () => {
      if (onToggleStar) onToggleStar(message);
    };

    const showThinkingRow =
      !showWorkStatus && !showAgentStatus && !isUser && (showTypingIndicator || (phase === 'thoughts' && !!thoughtText));

    const onlyThinking = (showThinkingRow || showWorkStatus || showAgentStatus) && !hasMainContent;

    const bubbleBase =
      `px-4 py-4 shadow-sm relative overflow-hidden ${bgColor} ${textColor} ` +
      `after:content-[''] after:absolute after:w-0 after:h-0 after:border-solid after:top-0 ` +
      (isUser
        ? `rounded-l-lg rounded-br-lg after:right-0 after:border-t-[6px] after:border-l-[6px] after:border-l-transparent after:border-t-primary`
        : `rounded-r-lg rounded-bl-lg after:left-0 after:border-t-[6px] after:border-r-[6px] after:border-r-transparent after:border-t-card`);

    const bubbleClasses = onlyThinking ? `${bubbleBase} flex items-center justify-center` : bubbleBase;

    return (
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} w-full min-w-0 mb-3 group`}>
        <div
          style={hasMinHeight && !isUser ? { minHeight: `${dynamicMinHeight || 500}px` } : undefined}
          className={`min-w-0 flex flex-col md:pr-1 ${hasAnyImages ? 'w-[80%] md:w-[50%]' : 'max-w-[99%] md:max-w-[99%]'}`}
        >
          <div className={bubbleClasses}>
            {isUser && message.message_type === 'deep_web_search' && (
              <div
                className={`mb-2 inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border border-background/25 bg-background/10 px-2 text-[11px] font-medium ${textColor}`}
                title="Researched using current web sources"
              >
                <FiSearch size={12} className="shrink-0" aria-hidden="true" />
                <span className="truncate">Deep web search</span>
              </div>
            )}
            {/* Main content (only when there is content) */}
            {hasTextContent && (
              <>
                {message.content_type === 'user' ? (
                  <div
                    ref={contentRef}
                    className={`font-sans text-[15px] ${textColor} ${
                      !isExpanded ? 'max-h-[34vh] overflow-hidden' : ''
                    } whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}
                  >
                    {message.content}
                  </div>
                ) : message.content_type === 'assistant' ? (
                  message.failed && message.failedMessage ? (
                    <div className="text-red-500 font-medium text-[15px]">{message.failedMessage}</div>
                  ) : (
                    <div className="min-w-0 break-words [overflow-wrap:anywhere]">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: MyCustomParagraph,
                          h1: MyCustomH1,
                          h2: MyCustomH2,
                          h3: MyCustomH3,
                          h4: MyCustomH4,
                          h5: MyCustomH5,
                          h6: MyCustomH6,
                          blockquote: MyCustomBlockquote,
                          ul: MyCustomUl,
                          ol: MyCustomOl,
                          li: MyCustomLi,
                          table: MyCustomTable,
                          thead: MyCustomThead,
                          tbody: MyCustomTbody,
                          tr: MyCustomTr,
                          th: MyCustomTh,
                          td: MyCustomTd,
                          hr: MyCustomHr,
                          a: MyCustomA,
                          img: MyCustomImg,
                          del: MyCustomDel,
                          sub: MyCustomSub,
                          sup: MyCustomSup,
                          code(props) {
                            const {
                              inline,
                              className,
                              children: markdownChildren,
                              node,
                              ...restProps
                            } = props as {
                              inline?: boolean;
                              className?: string;
                              children?: React.ReactNode;
                              node?: unknown;
                            };

                            if (inline === true) {
                              return renderStandardInlineCode({
                                className,
                                children: markdownChildren,
                                node,
                              });
                            } else {
                              const match = /language-([a-z0-9+#-]+)/i.exec(className || '');
                              const lang = match ? match[1] : '';
                              const isMultiLine = String(markdownChildren || '').includes('\n');

                              if (lang || isMultiLine) {
                                return (
                                  <CodeBlock
                                    language={lang}
                                    code={String(markdownChildren || '').replace(/\n$/, '')}
                                    {...restProps}
                                  />
                                );
                              } else {
                                return renderStandardInlineCode({
                                  className,
                                  children: markdownChildren,
                                  node,
                                });
                              }
                            }
                          },
                        }}
                      >
                        {displayContent}
                      </ReactMarkdown>
                    </div>
                  )
                ) : (
                  <MyCustomParagraph>{displayContent}</MyCustomParagraph>
                )}
              </>
            )}

            {/* Attachments + generated images */}
            {(hasAttachments || inlineGeneratedImages.length > 0) && (
              <div className={hasTextContent ? 'mt-3' : ''}>
                {(() => {
                  const attachments = message.attachments ?? [];

                  const imageAttachments = attachments.filter((att) => isImageAttachment(att));
                  const documentAttachments = attachments.filter((att) => !isImageAttachment(att));

                  return (
                    <>
                      {/* GENERATED IMAGES (base64/dataUrl) */}
                      {inlineGeneratedImages.length > 0 && (
                        <div
                          className={`grid gap-2 mb-3 ${
                            inlineGeneratedImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                          }`}
                        >
                          {inlineGeneratedImages.map((img, index) => (
                            <div key={`gen-${index}`} className="relative">
                              <div
                                onClick={() => {
                                  setCurrentImageUrl(img.dataUrl || '');
                                  setImageModalOpen(true);
                                }}
                                className="block rounded-lg overflow-hidden border border-primary/20 shadow-sm text-center cursor-pointer bg-background"
                              >
                                <Image
                                  src={img.dataUrl || ''}
                                  alt="Generated image"
                                  width={200}
                                  height={200}
                                  className="w-full h-auto max-h-[90vh] object-contain rounded-md"
                                  loading="lazy"
                                  sizes="(max-width: 768px) 100vw, 200px"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* IMAGE ATTACHMENTS FROM SERVER */}
                      {imageAttachments.length > 0 && (
                        <div
                          className={`grid gap-2 mb-3 ${imageAttachments.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
                        >
                          {imageAttachments.map((att, index) => (
                            <div key={`image-${index}`} className="relative">
                              {att.url ? (
                                <div
                                  onClick={() => {
                                    setCurrentImageUrl(att.url || '');
                                    setImageModalOpen(true);
                                  }}
                                  className="block rounded-lg overflow-hidden border border-primary/20 shadow-sm text-center cursor-pointer bg-background"
                                >
                                  <Image
                                    src={att.url}
                                    alt={att.name || 'Attached image'}
                                    width={200}
                                    height={200}
                                    className="w-full h-auto max-h-[40vh] object-contain rounded-md"
                                    loading="lazy"
                                    sizes="(max-width: 768px) 100vw, 200px"
                                  />
                                </div>
                              ) : (
                                <div className="flex items-center justify-center h-24 rounded-lg border border-dashed border-red-400/50 bg-red-50/50">
                                  <div className="text-center">
                                    <FiPaperclip size={24} className="text-red-500 mx-auto mb-1" />
                                    <p className="text-xs text-red-500">Error loading image</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* DOCUMENTS / OTHER FILES */}
                      {documentAttachments.length > 0 && (
                        <div className="space-y-2">
                          {documentAttachments.map((att, index) => (
                            <div key={`doc-${index}`} className="relative">
                              {isPdfAttachment(att) && att.url ? (
                                <a
                                  href={att.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center p-2.5 rounded-lg border border-primary/20 bg-gray-100 hover:bg-gray-200 transition-colors"
                                >
                                  <FaFilePdf size={28} className="text-red-500 mr-2.5 flex-shrink-0" />
                                  <div className="flex-1 overflow-hidden">
                                    <p className="text-sm text-primary font-medium truncate" title={att.name}>
                                      {truncateFileName(att.name || 'document.pdf', 25)}
                                    </p>
                                    {att.size && <p className="text-xs text-primary/60">PDF Document</p>}
                                  </div>
                                </a>
                              ) : att.url ? (
                                <a
                                  href={att.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center p-2.5 rounded-lg border border-primary/20 bg-gray-100 hover:bg-gray-200 transition-colors"
                                >
                                  <FiPaperclip size={24} className="text-primary/70 mr-2.5 flex-shrink-0" />
                                  <p className="text-sm text-primary font-medium truncate" title={att.name}>
                                    {truncateFileName(att.name || 'attachment', 25)}
                                  </p>
                                </a>
                              ) : (
                                <div className="flex items-center p-2.5 rounded-lg border border-dashed border-red-400/50 bg-red-50/50">
                                  <FiPaperclip size={24} className="text-red-500 mr-2.5 flex-shrink-0" />
                                  <div className="flex-1 overflow-hidden">
                                    <p className="text-sm text-red-700 font-medium truncate" title={att.name}>
                                      {truncateFileName(att.name || 'Attachment error', 25)}
                                    </p>
                                    <p className="text-xs text-red-500">
                                      {att.type === 'error' ? 'Error loading attachment' : 'Cannot display attachment'}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Orchestrating / searching / thinking / generating image / thoughts row */}
            {showAgentStatus && message.agentTaskId && (
              <AgentTaskPanel taskId={message.agentTaskId} initialStep={message.workStatusLabel} />
            )}
            {showWorkStatus && (
              <div className={`${onlyThinking ? '' : 'mt-1'} flex w-full justify-center`}>
                <WorkStatusPanel statusLabel={message.workStatusLabel} />
              </div>
            )}

            {showThinkingRow && (
              <div className={`${onlyThinking ? '' : 'mt-1'} flex w-full items-center justify-center`}>
                <ThinkingStatusText
                  phase={phase}
                  thoughtText={thoughtText}
                  isImageGeneration={Boolean(message.isGeneratingImage)}
                />
              </div>
            )}

            {/* Legacy image generation skeleton fallback */}
            {message.isGeneratingImage && !showTypingIndicator && !hasMainContent && (
              <div className="mt-3">
                <ImageSkeleton />
              </div>
            )}

            {isStreaming && message.content && !message.isGeneratingImage && (
              <div className="flex items-center space-x-1 mt-2">
                <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
                <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
                <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" />
              </div>
            )}

            {/* Footer */}
            {!showTypingIndicator && (
              <div className="mt-1.5 flex items-center justify-between pt-1">
                <div className="flex items-center space-x-1 pr-1">
                  {!isUser && message.content && (
                    <button
                      onClick={handleCopyToClipboard}
                      className="p-0.5 rounded text-xs hover:bg-black/10 dark:hover:bg-white/10 transition-colors focus:outline-none cursor-pointer"
                      title={isCopied ? 'Copied!' : 'Copy text'}
                    >
                      {isCopied ? (
                        <FiCheck size={14} className="text-primary" />
                      ) : (
                        <FiCopy size={14} className="text-primary/60 hover:text-primary/80" />
                      )}
                    </button>
                  )}
                  {!isUser && message.content && onToggleStar && (
                    <button
                      onClick={handleToggleStar}
                      className="p-0.5 rounded text-xs hover:bg-black/10 dark:hover:bg-white/10 transition-colors focus:outline-none cursor-pointer"
                      title={isStarred ? 'Unstar message' : 'Star message'}
                    >
                      {isStarred ? (
                        <FaStar size={13} className="text-primary" />
                      ) : (
                        <FiStar size={14} className="text-primary/60 hover:text-primary/80" />
                      )}
                    </button>
                  )}
                  {!isUser &&
                    message.attachments &&
                    message.attachments.some((att) => isImageAttachment(att) || isPdfAttachment(att)) && (
                      <a
                        href={
                          message.attachments.find((att) => isImageAttachment(att) || isPdfAttachment(att))?.url || '#'
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-0.5 rounded text-xs hover:bg-black/10 dark:hover:bg-white/10 transition-colors focus:outline-none cursor-pointer"
                        title="Download attachment"
                      >
                        <FiDownload size={14} className="text-primary/60 hover:text-primary/80" />
                      </a>
                    )}
                  {isUser && message.failed && isLastFailedMessage && (
                    <button
                      onClick={handleRetry}
                      className="p-0.5 rounded text-xs hover:bg-black/10 dark:hover:bg-white/10 transition-colors focus:outline-none cursor-pointer"
                      title="Retry sending"
                    >
                      <FiRefreshCw size={14} className="text-background/60 hover:text-background/90" />
                    </button>
                  )}
                  {isUser && showExpandButton && !isExpanded && (
                    <button
                      onClick={() => setIsExpanded(true)}
                      className="p-0.5 rounded text-xs text-background/60 hover:text-background/90 transition-colors focus:outline-none cursor-pointer "
                      title="Show more"
                    >
                      <FiChevronDown size={16} />
                    </button>
                  )}
                  {isUser && isExpanded && (
                    <button
                      onClick={() => setIsExpanded(false)}
                      className="p-0.5 rounded text-xs text-background/60 hover:text-background/90 transition-colors focus:outline-none cursor-pointer"
                      title="Show less"
                    >
                      <FiChevronUp size={16} />
                    </button>
                  )}
                </div>

                <p className={`text-xs whitespace-nowrap ${isUser ? 'text-background/60' : 'text-primary/60'}`}>
                  {(() => {
                    const timestamp = message.timestamp;
                    if (!timestamp) return '';
                    if (message.content_type === 'assistant' && isStreaming) {
                      return '';
                    }

                    return formatTime(timestamp);
                  })()}
                </p>
              </div>
            )}
          </div>
        </div>

        {imageModalOpen && (
          <ImageModal isOpen={imageModalOpen} onClose={() => setImageModalOpen(false)} imageUrl={currentImageUrl} />
        )}
      </div>
    );
  },
);

RenderedMessageItem.displayName = 'RenderedMessageItem';
