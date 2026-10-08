'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// Visibility observes layout; only an explicit navigation request moves the chat.
export function useChatScrollControls(ref: RefObject<HTMLDivElement>, active: boolean) {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const navigating = useRef(false);
  const frame = useRef(0);
  const navigationFrame = useRef(0);
  const navigationStarted = useRef(0);
  const lastMovement = useRef(0);
  const previousTop = useRef(0);

  const updateVisibility = useCallback(() => {
    const el = ref.current;
    if (!el || !active) return;
    const gap = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
    setShowScrollToBottom(visible => !navigating.current && (visible ? gap > 48 : gap > 100));
  }, [active, ref]);

  const scrollToBottom = useCallback((smooth = true, force = false) => {
    const el = ref.current;
    if (!el || !force) return;
    cancelAnimationFrame(navigationFrame.current);
    navigating.current = true;
    setShowScrollToBottom(false);
    navigationStarted.current = lastMovement.current = performance.now();
    previousTop.current = el.scrollTop;
    navigationFrame.current = requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
      const settle = (now: number) => {
        if (!navigating.current) return;
        if (Math.abs(el.scrollTop - previousTop.current) > 0.5) lastMovement.current = now;
        previousTop.current = el.scrollTop;
        // Wait for native smooth scrolling to settle, including late layout changes.
        if ((now - navigationStarted.current > 180 && now - lastMovement.current > 120) || now - navigationStarted.current > 2000) {
          navigating.current = false;
          updateVisibility();
          return;
        }
        navigationFrame.current = requestAnimationFrame(settle);
      };
      navigationFrame.current = requestAnimationFrame(settle);
    });
  }, [ref, updateVisibility]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !active) {
      setShowScrollToBottom(false);
      return;
    }
    const schedule = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(updateVisibility);
    };
    const interrupt = () => {
      if (navigating.current) {
        navigating.current = false;
        cancelAnimationFrame(navigationFrame.current);
        el.scrollTo({ top: el.scrollTop, behavior: 'instant' });
      }
      schedule();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('textarea, input, [contenteditable="true"]')) return;
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interrupt();
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    el.addEventListener('scroll', schedule, { passive: true });
    el.addEventListener('wheel', interrupt, { passive: true });
    el.addEventListener('touchmove', interrupt, { passive: true });
    el.addEventListener('keydown', keydown);
    schedule();
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', schedule);
      el.removeEventListener('wheel', interrupt);
      el.removeEventListener('touchmove', interrupt);
      el.removeEventListener('keydown', keydown);
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(navigationFrame.current);
      navigating.current = false;
    };
  }, [active, ref, updateVisibility]);

  return { showScrollToBottom, scrollToBottom };
}
