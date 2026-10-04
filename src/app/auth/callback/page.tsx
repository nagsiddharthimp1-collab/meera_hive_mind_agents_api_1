'use client';

import { finishGoogleAgentConnection } from '@/lib/auth/startGoogleAgentConnection';
import { clearAuthRedirectTrace, clearGuestTokenState, logAuthRedirectEvent } from '@/lib/authRedirect';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handle = async () => {
      try {
        // Touch auth so Supabase reads the #access_token from the URL
        const searchParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const providerError =
          searchParams.get('error_description') ||
          searchParams.get('error') ||
          hashParams.get('error_description') ||
          hashParams.get('error');
        const { data, error } = await supabase.auth.getSession();

        if (data.session) {
          await fetch('/api/analytics/growth-links/attribute', {
            method: 'POST',
            headers: { Authorization: `Bearer ${data.session.access_token}` },
          }).catch(() => {
            // Attribution is best-effort and must never block sign-in.
          });
          let returnTo: string | null = null;
          try {
            returnTo = await finishGoogleAgentConnection();
          } catch (connectionError) {
            console.error('Google agent connection error:', connectionError);
            router.replace('/?connection_error=google');
            return;
          }
          clearGuestTokenState('auth_callback');
          clearAuthRedirectTrace();
          logAuthRedirectEvent('auth_callback_session_restored', {
            pathname: window.location.pathname,
          });
          router.replace(returnTo || '/');
          return;
        }

        logAuthRedirectEvent('auth_callback_session_missing', {
          message: providerError || error?.message || 'No session returned',
          pathname: window.location.pathname,
        });
        router.replace('/sign-in?auth_error=google');
      } catch (error) {
        console.error('Supabase auth callback error:', error);
        router.replace('/sign-in?auth_error=google');
      }
    };

    handle();
  }, [router]);

  return (
    <div className="flex items-center justify-center h-screen">
      <p className="text-primary text-base">Signing you in…</p>
    </div>
  );
}
