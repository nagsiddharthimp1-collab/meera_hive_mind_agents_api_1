'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

// Drafts belong to an account. Storage failure must never prevent typing.
export function useChatDraft(userId: string | null | undefined) {
  const key = userId ? `meera:chat-draft:v1:${userId}` : null;
  const [value, setValue] = useState('');
  const draft = useRef({ key: null as string | null, value: '' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const current = draft.current;
    if (!current.key) return;
    try {
      if (current.value) localStorage.setItem(current.key, current.value);
      else localStorage.removeItem(current.key);
    } catch { /* Private browsing and full storage still allow chatting. */ }
  }, []);

  useLayoutEffect(() => {
    let restored = '';
    try { if (key) restored = localStorage.getItem(key) || ''; } catch { /* Best effort. */ }
    draft.current = { key, value: restored };
    setValue(restored);
    const onHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [key, flush]);

  const update = useCallback((next: string) => {
    draft.current.value = next;
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    if (!next) flush();
    else timer.current = setTimeout(flush, 250);
  }, [flush]);
  return [value, update] as const;
}
