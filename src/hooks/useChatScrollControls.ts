'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// Keep navigation to the latest message distinct from a reader scrolling up.
export function useChatScrollControls(scrollRef: RefObject<HTMLDivElement>, enabled: boolean) {
  const [showLatest, setShowLatest] = useState(false);
  const following = useRef(false);
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

  const cancelFollowing = useCallback(() => {
    following.current = false;
    movingToLatest.current = false;
    cancelAnimationFrame(scrollFrame.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    updateVisibility();
  }, [updateVisibility]);

  const scrollToBottom = useCallback((smooth = true, force = false) => {
    const scroll = scrollRef.current;
    if (!scroll || !force) return;
    following.current = true;
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
    let previousTop = scroll.scrollTop;
    let previousHeight = scroll.scrollHeight;
    following.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48;

    const finish = () => {
      if (!movingToLatest.current) return;
      if (settleTimer.current) clearTimeout(settleTimer.current);
      // A reply may have grown while the single smooth navigation was running.
      if (following.current) scroll.scrollTop = scroll.scrollHeight;
      movingToLatest.current = false;
      updateVisibility();
    };
    finishMove.current = finish;

    const onScroll = () => {
      if (movingToLatest.current) {
        if (settleTimer.current) clearTimeout(settleTimer.current);
        // Fallback for browsers without scrollend.
        settleTimer.current = setTimeout(finish, 120);
      } else {
        const gap = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
        if (gap < 48) following.current = true;
        else if (scroll.scrollTop < previousTop - 1 && scroll.scrollHeight === previousHeight) following.current = false;
      }
      previousTop = scroll.scrollTop;
      previousHeight = scroll.scrollHeight;
      updateVisibility();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancelFollowing();
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (following.current && !movingToLatest.current) scroll.scrollTop = scroll.scrollHeight;
        updateVisibility();
      });
    });
    observer.observe(scroll);
    if (scroll.firstElementChild) observer.observe(scroll.firstElementChild);
    scroll.addEventListener('scroll', onScroll, { passive: true });
    scroll.addEventListener('scrollend', finish);
    scroll.addEventListener('wheel', cancelFollowing, { passive: true });
    scroll.addEventListener('touchmove', cancelFollowing, { passive: true });
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
      scroll.removeEventListener('wheel', cancelFollowing);
      scroll.removeEventListener('touchmove', cancelFollowing);
      scroll.removeEventListener('keydown', onKeyDown);
    };
  }, [cancelFollowing, enabled, scrollRef, updateVisibility]);

  return { showLatest, scrollToBottom, cancelFollowing };
}
