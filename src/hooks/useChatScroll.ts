'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export function useChatScroll(scrollRef: RefObject<HTMLDivElement>, userId: string | null | undefined, enabled: boolean) {
  const [showLatest, setShowLatest] = useState(false);
  const following = useRef(true);
  const restored = useRef(false);
  const key = userId ? `meera:chat-position:v1:${userId}` : null;
  const scrollToBottom = useCallback((_smooth = true, force = false) => {
    if (!force && !following.current) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      if (!restored.current && !_smooth) {
        restored.current = true;
        try {
          const saved = key ? JSON.parse(sessionStorage.getItem(key) || 'null') : null;
          const anchor = saved?.id ? document.getElementById(saved.id) : null;
          if (anchor && el.contains(anchor) && Number.isFinite(saved.offset)) {
            following.current = false;
            el.scrollTop += anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - saved.offset;
            setShowLatest(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
            return;
          }
        } catch { /* Missing history or storage falls back to the latest message. */ }
      }
      following.current = true;
      // A single immediate movement avoids competing smooth-scroll animations.
      el.scrollTop = el.scrollHeight;
      setShowLatest(false);
    });
  }, [key, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;
    let frame = 0;
    const onScroll = () => {
      const away = el.scrollHeight - el.scrollTop - el.clientHeight > 100;
      following.current = !away;
      setShowLatest(away);
    };
    const save = () => {
      if (!key || !restored.current) return;
      try {
        if (following.current) { sessionStorage.removeItem(key); return; }
        const top = el.getBoundingClientRect().top;
        const anchor = Array.from(el.querySelectorAll<HTMLElement>('.message-item-wrapper'))
          .find(item => item.getBoundingClientRect().bottom > top);
        if (anchor) sessionStorage.setItem(key, JSON.stringify({ id: anchor.id, offset: anchor.getBoundingClientRect().top - top }));
      } catch { /* Best effort. */ }
    };
    const onHidden = () => { if (document.visibilityState === 'hidden') save(); };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (following.current) el.scrollTop = el.scrollHeight;
        setShowLatest(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
      });
    });
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      save();
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [enabled, key, scrollRef]);
  return { showLatest, scrollToBottom };
}
