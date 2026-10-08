'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// Keep the latest arrow hidden during navigation without following replies.
export function useChatScrollControls(scrollRef: RefObject<HTMLDivElement>, enabled: boolean) {
  const [showLatest, setShowLatest] = useState(false);
  const movingToLatest = useRef(false);
  const scrollFrame = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishMove = useRef<() => void>(() => {});

  const updateVisibility = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const gap = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
    setShowLatest(previous => movingToLatest.current ? false : gap > 100 ? true : gap < 48 ? false : previous);
  }, [scrollRef]);

  const cancelNavigation = useCallback(() => {
    movingToLatest.current = false;
    cancelAnimationFrame(scrollFrame.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    updateVisibility();
  }, [updateVisibility]);

  const scrollToBottom = useCallback((smooth = true, force = false) => {
    const scroll = scrollRef.current;
    if (!scroll || !force) return;
    movingToLatest.current = true;
    setShowLatest(false);
    cancelAnimationFrame(scrollFrame.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    scrollFrame.current = requestAnimationFrame(() => {
      const animate = smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scroll.scrollTo({ top: scroll.scrollHeight, behavior: animate ? 'smooth' : 'auto' });
      if (animate) settleTimer.current = setTimeout(() => finishMove.current(), 1600);
      else finishMove.current();
    });
  }, [scrollRef]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !enabled) return;
    let resizeFrame = 0;

    const finish = () => {
      if (!movingToLatest.current) return;
      if (settleTimer.current) clearTimeout(settleTimer.current);
      movingToLatest.current = false;
      updateVisibility();
    };
    finishMove.current = finish;

    const onScroll = () => {
      if (movingToLatest.current) {
        if (settleTimer.current) clearTimeout(settleTimer.current);
        // Fallback for browsers without scrollend.
        settleTimer.current = setTimeout(finish, 120);
      }
      updateVisibility();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancelNavigation();
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        // Visibility only: retain the baseline's scroll and keyboard behavior.
        updateVisibility();
      });
    });
    observer.observe(scroll);
    if (scroll.firstElementChild) observer.observe(scroll.firstElementChild);
    scroll.addEventListener('scroll', onScroll, { passive: true });
    scroll.addEventListener('scrollend', finish);
    scroll.addEventListener('wheel', cancelNavigation, { passive: true });
    scroll.addEventListener('touchmove', cancelNavigation, { passive: true });
    scroll.addEventListener('keydown', onKeyDown);
    updateVisibility();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(scrollFrame.current);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      movingToLatest.current = false;
      finishMove.current = () => {};
      scroll.removeEventListener('scroll', onScroll);
      scroll.removeEventListener('scrollend', finish);
      scroll.removeEventListener('wheel', cancelNavigation);
      scroll.removeEventListener('touchmove', cancelNavigation);
      scroll.removeEventListener('keydown', onKeyDown);
    };
  }, [cancelNavigation, enabled, scrollRef, updateVisibility]);

  return { showLatest, scrollToBottom, cancelNavigation };
}
