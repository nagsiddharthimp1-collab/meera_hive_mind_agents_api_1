'use client';

import { startGoogleAgentConnection } from '@/lib/auth/startGoogleAgentConnection';
import { supabase } from '@/lib/supabaseClient';
import React, { useCallback, useEffect, useState } from 'react';
import { FiCalendar, FiCheck, FiMail, FiRefreshCw } from 'react-icons/fi';

type ConnectorStatus = {
  available: boolean;
  connected: boolean;
  email?: string | null;
  connectors?: {
    gmail?: { connected?: boolean; canRead?: boolean; canSend?: boolean };
    calendar?: { connected?: boolean; canRead?: boolean; canWrite?: boolean };
  };
};

const EMPTY_STATUS: ConnectorStatus = { available: false, connected: false };

export function ConnectorsView() {
  const [status, setStatus] = useState<ConnectorStatus>(EMPTY_STATUS);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    const { data, error: statusError } = await supabase.functions.invoke('agentic', {
      body: { operation: 'connection_status' },
    });
    if (statusError || data?.error) {
      setError(data?.error || statusError?.message || 'Could not load connectors.');
      setStatus(EMPTY_STATUS);
    } else {
      setError('');
      setStatus(data as ConnectorStatus);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const connect = useCallback(async () => {
    setError('');
    setIsConnecting(true);
    try {
      await startGoogleAgentConnection();
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : 'Could not connect Google.');
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError('');
    const { data, error: disconnectError } = await supabase.functions.invoke('agentic', {
      body: { operation: 'disconnect_google' },
    });
    if (disconnectError || data?.error) {
      setError(data?.error || disconnectError?.message || 'Could not disconnect Google.');
      return;
    }
    setStatus({ available: true, connected: false });
  }, []);

  const connected = status.connected;
  const connectorCards = [
    {
      key: 'gmail',
      title: 'Gmail',
      description: 'Read and search email, reply in the original thread, and send only after you approve.',
      icon: FiMail,
      ready: status.connectors?.gmail?.connected === true,
    },
    {
      key: 'calendar',
      title: 'Google Calendar',
      description: 'Check your schedule, add or reschedule events, and cancel only after you approve.',
      icon: FiCalendar,
      ready: status.connectors?.calendar?.connected === true,
    },
  ];

  return (
    <section className="mx-auto w-full max-w-4xl px-3 py-4 sm:px-6 sm:py-8">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/50">Meera tools</p>
        <h2 className="mt-2 text-3xl font-semibold text-primary">Connectors</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-primary/65">
          Connect your tools once, then ask Meera naturally in chat. Reading is private to your task, and every external write requires your approval.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-primary/15 bg-card/40">
        {connectorCards.map(({ key, title, description, icon: Icon, ready }, index) => (
          <div
            key={key}
            className={`flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between ${index ? 'border-t border-primary/15' : ''}`}
          >
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-primary/15 bg-background text-primary">
                <Icon size={21} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-primary">{title}</h3>
                  {ready ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      <FiCheck size={12} /> Connected
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-5 text-primary/60">{description}</p>
                {ready && status.email ? <p className="mt-1 truncate text-xs text-primary/45">{status.email}</p> : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void connect()}
              disabled={isLoading || isConnecting || !status.available}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/20 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isConnecting ? <FiRefreshCw className="animate-spin" size={14} /> : null}
              {ready ? 'Reconnect' : 'Connect'}
            </button>
          </div>
        ))}
      </div>

      {isLoading ? <p className="mt-4 text-sm text-primary/55">Checking connections…</p> : null}
      {!isLoading && !status.available ? (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-primary/80">
          Google connectors are being configured. Try again shortly.
        </p>
      ) : null}
      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      {connected ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/15 px-4 py-3">
          <p className="text-sm text-primary/65">Connected Google account: <span className="font-medium text-primary">{status.email}</span></p>
          <button type="button" onClick={() => void disconnect()} className="text-sm text-primary/65 underline underline-offset-4 hover:text-primary">
            Disconnect
          </button>
        </div>
      ) : null}

      <p className="mt-6 text-xs leading-5 text-primary/45">
        Meera stores an encrypted refresh token. Google credentials are never sent to Hermes or exposed in chat. You can disconnect at any time.
      </p>
    </section>
  );
}
