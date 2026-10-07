'use client';

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface PWAInstallContextType {
  installPrompt: BeforeInstallPromptEvent | null;
  isStandalone: boolean;
  isIOS: boolean;
  handleInstallClick: () => void;
}

const PWAInstallContext = createContext<PWAInstallContextType | undefined>(undefined);

const RUNTIME_MIGRATION_STORAGE_KEY = 'meera:pwa-assets-migration:v2';

export const usePWAInstall = () => {
  const context = useContext(PWAInstallContext);
  if (context === undefined) {
    throw new Error('usePWAInstall must be used within a PWAInstallProvider');
  }
  return context;
};

export const PWAInstallProvider = ({ children }: { children: ReactNode }) => {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Retire only the legacy worker once. Never clear chat/session data or reload a draft.
    const startWorker = async () => {
      if (!('serviceWorker' in navigator)) return;
      try {
        if (localStorage.getItem(RUNTIME_MIGRATION_STORAGE_KEY) !== 'done') {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const registration of registrations) {
            const worker = registration.active || registration.waiting || registration.installing;
            if (worker && new URL(worker.scriptURL).pathname === '/sw.js') await registration.unregister();
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.filter(key => key.startsWith('meera-os-cache') || key.startsWith('workbox-precache')).map(key => caches.delete(key)));
          }
          localStorage.setItem(RUNTIME_MIGRATION_STORAGE_KEY, 'done');
        }
        // Development HMR chunks must never be cached.
        if (process.env.NODE_ENV === 'production') {
          await navigator.serviceWorker.register('/meera-sw.js', { scope: '/', updateViaCache: 'none' });
        }
      } catch (error) { console.warn('PWA setup unavailable:', error); }
    };
    void startWorker();

    if (typeof window !== 'undefined') {
      setIsStandalone(window.matchMedia('(display-mode: standalone)').matches);
      setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = () => {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the A2HS prompt');
        } else {
          console.log('User dismissed the A2HS prompt');
        }
        setInstallPrompt(null);
      });
    } else if (isIOS) {
      alert("To install, tap the share button and then 'Add to Home Screen'.");
    }
  };

  const value = {
    installPrompt,
    isStandalone,
    isIOS,
    handleInstallClick,
  };

  return <PWAInstallContext.Provider value={value}>{children}</PWAInstallContext.Provider>;
};
