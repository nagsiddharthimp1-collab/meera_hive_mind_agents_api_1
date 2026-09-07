'use client';

import { useMemo, useState } from 'react';

type OpenInBrowserDialogProps = {
  isOpen: boolean;
  browserHint: 'Safari' | 'Chrome';
  openUrl: string;
  onClose: () => void;
};

const sanitizeForSafariScheme = (url: string): string => {
  if (url.startsWith('https://')) return url;
  if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
  return `https://${url.replace(/^\/+/, '')}`;
};

export function OpenInBrowserDialog({ isOpen, browserHint, openUrl, onClose }: OpenInBrowserDialogProps) {
  const [copied, setCopied] = useState(false);
  const isIOS = browserHint === 'Safari';

  const instruction = useMemo(
    () =>
      isIOS
        ? 'Tap share in this view and choose "Open in Safari", then continue with Google.'
        : 'Tap the menu in this view and choose "Open in browser", then continue with Google.',
    [isIOS],
  );

  if (!isOpen) return null;

  const tryOpenBrowser = () => {
    try {
      if (isIOS) {
        window.location.href = `x-safari-${sanitizeForSafariScheme(openUrl)}`;
        return;
      }
      window.open(openUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.warn('Unable to open external browser automatically:', error);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(openUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.warn('Unable to copy link:', error);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-primary/20 bg-background p-5 shadow-xl">
        <h3 className="text-lg font-medium text-primary text-center">Open in {browserHint} to continue</h3>
        <p className="mt-2 text-sm text-secondary text-center">
          Google sign-in is blocked inside this in-app browser.
        </p>
        <p className="mt-2 text-sm text-secondary text-center">{instruction}</p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={tryOpenBrowser}
            className="w-full rounded-lg border border-primary/30 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5"
          >
            Try Open in {browserHint}
          </button>
          <button
            type="button"
            onClick={copyLink}
            className="w-full rounded-lg border border-primary/20 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5"
          >
            {copied ? 'Link copied' : 'Copy Link'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-primary/10 px-4 py-2 text-sm text-secondary hover:text-primary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
