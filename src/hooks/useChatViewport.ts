'use client';

import { useLayoutEffect, type RefObject } from 'react';

const MOBILE_VIEWPORT_QUERY = '(max-width: 767px), (pointer: coarse)';

export function isTouchChatViewport(): boolean {
  return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
}

export function getChatViewportHeight(): number {
  return isTouchChatViewport() ? window.visualViewport?.height ?? window.innerHeight : window.innerHeight;
}

// The native keyboard changes the visual viewport, often without a window resize.
// Keep these listeners owned by the chat mount, independent of history requests.
export function useChatViewport(
  shellRef: RefObject<HTMLDivElement>,
  scrollRef: RefObject<HTMLDivElement>,
  onResize: () => void,
) {
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const viewport = window.visualViewport;
    const media = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    let frame = 0;
    let previousHeight = 0;
    let previousMobile: boolean | null = null;

    const update = () => {
      frame = 0;
      // Pinch zoom is not a keyboard resize; let the browser handle zoom normally.
      if (viewport && Math.abs(viewport.scale - 1) > 0.05) return;
      const mobile = media.matches;
      const height = mobile ? viewport?.height ?? window.innerHeight : window.innerHeight;
      if (height <= 0) return;
      const heightChanged = height !== previousHeight || mobile !== previousMobile;
      const scroll = scrollRef.current;
      const scrollTop = scroll?.scrollTop ?? 0;
      const atBottom = !!scroll && scroll.scrollHeight - scrollTop - scroll.clientHeight < 48;

      shell.style.setProperty('--chat-viewport-height', `${height}px`);
      shell.style.setProperty('--chat-viewport-top', `${mobile ? Math.max(0, viewport?.offsetTop ?? 0) : 0}px`);
      shell.dataset.keyboardOpen = String(mobile && window.innerHeight - height > 80);
      document.documentElement.classList.toggle('meera-chat-active', mobile);
      document.body.classList.toggle('meera-chat-active', mobile);

      if (heightChanged) {
        previousHeight = height;
        previousMobile = mobile;
        onResize();
        if (scroll) scroll.scrollTop = atBottom ? scroll.scrollHeight - scroll.clientHeight : scrollTop;
      }
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('pageshow', schedule);
    document.addEventListener('visibilitychange', schedule);
    media.addEventListener('change', schedule);

    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pageshow', schedule);
      document.removeEventListener('visibilitychange', schedule);
      media.removeEventListener('change', schedule);
      document.documentElement.classList.remove('meera-chat-active');
      document.body.classList.remove('meera-chat-active');
    };
  }, [shellRef, scrollRef, onResize]);
}
