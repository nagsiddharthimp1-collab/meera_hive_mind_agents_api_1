'use client';

import { Dialog, Transition } from '@headlessui/react';
import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  FiCheck,
  FiCode,
  FiCopy,
  FiMaximize2,
  FiMinimize2,
  FiRefreshCw,
  FiRotateCcw,
  FiX,
} from 'react-icons/fi';

type InteractiveArtifactKind = 'plotly' | 'live-html' | 'live-react';

type InteractiveArtifactProps = {
  language: string;
  code: string;
};

const ARTIFACT_LANGUAGE_ALIASES: Record<string, InteractiveArtifactKind> = {
  plotly: 'plotly',
  'live-html': 'live-html',
  livehtml: 'live-html',
  'live-react': 'live-react',
  livereact: 'live-react',
};

const ARTIFACT_META: Record<InteractiveArtifactKind, { title: string; eyebrow: string }> = {
  plotly: { title: 'Interactive graph', eyebrow: 'Plotly' },
  'live-html': { title: 'Interactive app', eyebrow: 'Live HTML' },
  'live-react': { title: 'Interactive app', eyebrow: 'Live React' },
};

const getArtifactTitle = (kind: InteractiveArtifactKind, code: string) => {
  if (kind !== 'plotly') return ARTIFACT_META[kind].title;

  try {
    const parsed = JSON.parse(code) as {
      layout?: { title?: string | { text?: string } };
    };
    const rawTitle =
      typeof parsed.layout?.title === 'string' ? parsed.layout.title : parsed.layout?.title?.text;
    const title = rawTitle?.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
    return title || ARTIFACT_META[kind].title;
  } catch {
    return ARTIFACT_META[kind].title;
  }
};

const PLOTLY_CDN = 'https://cdn.plot.ly/plotly-2.35.2.min.js';
const REACT_CDN = 'https://unpkg.com/react@18.3.1/umd/react.production.min.js';
const REACT_DOM_CDN = 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js';
const BABEL_CDN = 'https://unpkg.com/@babel/standalone@7.26.9/babel.min.js';

const normalizeArtifactLanguage = (language: string) => language.trim().toLowerCase().replace(/_/g, '-');

export const getInteractiveArtifactKind = (language: string): InteractiveArtifactKind | null =>
  ARTIFACT_LANGUAGE_ALIASES[normalizeArtifactLanguage(language)] ?? null;

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escapeInlineScript = (value: string) => value.replace(/<\/script/gi, '<\\/script');

const baseDocumentStyles = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { width: 100%; min-height: 100%; margin: 0; }
  body {
    color: #0c3c26;
    background: #ffffff;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: auto;
    -webkit-tap-highlight-color: transparent;
  }
  button, input, select, textarea { font: inherit; }
  img, svg, canvas { max-width: 100%; }
  @media (max-width: 640px) {
    body { font-size: 14px; }
    button, a, input, select { min-height: 40px; }
  }
`;

const errorDocument = (message: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>${baseDocumentStyles}.error{min-height:100vh;display:grid;place-items:center;padding:24px}.error-card{max-width:520px;padding:20px;border:1px solid #d9dedb;border-radius:16px;background:#f7f9f8}.error-title{font-weight:700;margin-bottom:8px}.error-copy{color:#52615a;line-height:1.5}</style></head>
<body><main class="error"><section class="error-card"><div class="error-title">This preview could not open</div><div class="error-copy">${escapeHtml(message)}</div></section></main></body></html>`;

const makePlotlyDocument = (code: string) => {
  try {
    const parsed = JSON.parse(code) as {
      data?: unknown[];
      layout?: Record<string, unknown>;
      config?: Record<string, unknown>;
    };

    if (!Array.isArray(parsed.data)) {
      return errorDocument('The Plotly artifact is missing a valid data array. Open Code to inspect the response.');
    }

    const safeSpec = JSON.stringify(parsed).replace(/</g, '\\u003c');

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover">
    <style>
      ${baseDocumentStyles}
      html, body, #plot { height: 100%; overflow: hidden; }
      #plot { width: 100%; min-height: 220px; }
      .modebar { padding: 6px !important; }
      @media (max-width: 640px) { .modebar-btn { transform: scale(1.08); transform-origin: center; } }
    </style>
    <script src="${PLOTLY_CDN}"></script>
  </head>
  <body>
    <div id="plot" role="img" aria-label="Interactive data visualization"></div>
    <script>
      (() => {
        if (!window.Plotly) {
          document.body.innerHTML = '<main style="min-height:100vh;display:grid;place-items:center;padding:24px"><section style="max-width:520px;padding:20px;border:1px solid #d9dedb;border-radius:16px;background:#f7f9f8"><strong>Chart library unavailable</strong><p style="color:#52615a;line-height:1.5">Reload the preview. If the connection is offline, the chart will open when access returns.</p></section></main>';
          return;
        }
        const spec = ${safeSpec};
        const compact = window.matchMedia('(max-width: 640px)').matches;
        const data = spec.data.map((trace) => {
          const pointCount = Math.max(
            Array.isArray(trace.x) ? trace.x.length : 0,
            Array.isArray(trace.y) ? trace.y.length : 0,
            Array.isArray(trace.lat) ? trace.lat.length : 0
          );
          if (!compact || pointCount < 6 || typeof trace.mode !== 'string' || !trace.mode.includes('text')) {
            return trace;
          }
          const mode = trace.mode.split('+').filter((part) => part !== 'text').join('+') || 'markers';
          return { ...trace, mode };
        });
        const suppliedLayout = spec.layout || {};
        const layout = {
          autosize: true,
          paper_bgcolor: 'rgba(0,0,0,0)',
          plot_bgcolor: 'rgba(0,0,0,0)',
          font: { color: '#0c3c26', size: compact ? 11 : 13, ...(suppliedLayout.font || {}) },
          ...suppliedLayout,
          margin: {
            l: compact ? 34 : 52,
            r: compact ? 16 : 28,
            t: compact ? 42 : 56,
            b: compact ? 44 : 54,
            ...(suppliedLayout.margin || {})
          }
        };
        if (compact && (!suppliedLayout.legend || !suppliedLayout.legend.orientation)) {
          layout.legend = { ...(suppliedLayout.legend || {}), orientation: 'h', x: 0, y: -0.12 };
        }
        const config = {
          responsive: true,
          displaylogo: false,
          scrollZoom: true,
          modeBarButtonsToRemove: ['sendDataToCloud'],
          ...(spec.config || {})
        };
        const root = document.getElementById('plot');
        Plotly.newPlot(root, data, layout, config).then(() => {
          const observer = new ResizeObserver(() => Plotly.Plots.resize(root));
          observer.observe(document.body);
          window.addEventListener('message', (event) => {
            if (event.data?.source !== 'meera-artifact-viewer') return;
            if (event.data.command === 'reset') {
              const update = {};
              Object.keys(root._fullLayout || {}).forEach((key) => {
                if (/^[xy]axis\\d*$/.test(key)) update[key + '.autorange'] = true;
              });
              Plotly.relayout(root, update);
            }
          });
        }).catch((error) => {
          document.body.innerHTML = '<main style="padding:24px"><strong>Chart error</strong><p>' + String(error.message || error) + '</p></main>';
        });
      })();
    </script>
  </body>
</html>`;
  } catch {
    return errorDocument('The Plotly artifact contains invalid JSON. Open Code to inspect the response.');
  }
};

const makeHtmlDocument = (code: string) => {
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover">';
  const responsiveStyles = `<style data-meera-artifact>${baseDocumentStyles}</style>`;
  let document = code.trim();

  if (!/<html[\s>]/i.test(document)) {
    document = `<!doctype html><html><head><meta charset="utf-8">${viewport}${responsiveStyles}</head><body>${document}</body></html>`;
  } else {
    if (!/<meta[^>]+name=["']viewport["']/i.test(document)) {
      document = document.replace(/<head([^>]*)>/i, `<head$1>${viewport}`);
    }
    document = document.replace(/<head([^>]*)>/i, `<head$1>${responsiveStyles}`);
  }

  return document;
};

const makeReactDocument = (code: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover">
    <style>${baseDocumentStyles}#root{min-height:100vh}</style>
    <script crossorigin src="${REACT_CDN}"></script>
    <script crossorigin src="${REACT_DOM_CDN}"></script>
    <script src="${BABEL_CDN}"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="text/babel" data-presets="react">
      const { useCallback, useEffect, useMemo, useRef, useState } = React;
      ${escapeInlineScript(code)}
      const meeraRoot = ReactDOM.createRoot(document.getElementById('root'));
      meeraRoot.render(React.createElement(App));
    </script>
  </body>
</html>`;

const makeArtifactDocument = (kind: InteractiveArtifactKind, code: string) => {
  if (kind === 'plotly') return makePlotlyDocument(code);
  if (kind === 'live-react') return makeReactDocument(code);
  return makeHtmlDocument(code);
};

const ToolbarButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  primary?: boolean;
}> = ({ label, onClick, children, active = false, primary = false }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
      primary
        ? 'bg-primary text-background hover:bg-primary/90'
        : active
          ? 'bg-primary/10 text-primary'
          : 'text-primary/75 hover:bg-primary/8 hover:text-primary'
    }`}
  >
    {children}
  </button>
);

export const InteractiveArtifact: React.FC<InteractiveArtifactProps> = ({ language, code }) => {
  const kind = getInteractiveArtifactKind(language);
  const [isOpen, setIsOpen] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const [inlineLoading, setInlineLoading] = useState(true);
  const [expandedLoading, setExpandedLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const expandedFrameRef = useRef<HTMLIFrameElement>(null);

  const srcDoc = useMemo(() => (kind ? makeArtifactDocument(kind, code) : ''), [code, kind]);
  const displayTitle = useMemo(() => (kind ? getArtifactTitle(kind, code) : ''), [code, kind]);
  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  if (!kind) return null;

  const meta = ARTIFACT_META[kind];
  const reload = () => {
    setInlineLoading(true);
    setExpandedLoading(true);
    setRevision((value) => value + 1);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1400);
    } catch (error) {
      console.error('Failed to copy interactive artifact code:', error);
    }
  };

  const openArtifact = () => {
    setShowCode(false);
    setExpandedLoading(true);
    setIsOpen(true);
  };

  const closeArtifact = () => {
    if (document.fullscreenElement === panelRef.current) void document.exitFullscreen();
    setIsOpen(false);
    setShowCode(false);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === panelRef.current) {
        await document.exitFullscreen();
      } else {
        await panelRef.current?.requestFullscreen();
      }
    } catch (error) {
      console.error('Failed to toggle artifact fullscreen:', error);
    }
  };

  const resetPlotlyView = () => {
    expandedFrameRef.current?.contentWindow?.postMessage(
      { source: 'meera-artifact-viewer', command: 'reset' },
      '*',
    );
  };

  return (
    <>
      <section className="my-4 min-w-0 overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-sm">
        <div className="flex min-h-14 items-center gap-3 border-b border-primary/10 bg-primary/[0.035] px-3 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <span className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_14%,transparent)]" />
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold text-primary">{displayTitle}</div>
              <div className="mt-0.5 truncate text-xs text-primary/55">{meta.eyebrow} · live preview</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={reload}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-primary/65 transition-colors hover:bg-primary/8 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label="Reload preview"
              title="Reload preview"
            >
              <FiRefreshCw size={17} />
            </button>
            <ToolbarButton label={`Open ${meta.title.toLowerCase()} viewer`} onClick={openArtifact} primary>
              <FiMaximize2 size={16} />
              <span className="hidden sm:inline">Open viewer</span>
              <span className="sm:hidden">Open</span>
            </ToolbarButton>
          </div>
        </div>

        <div className="relative h-[clamp(300px,58vw,480px)] min-w-0 bg-white">
          {inlineLoading && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-white">
              <div className="flex items-center gap-2 text-sm text-primary/65">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
                Opening preview…
              </div>
            </div>
          )}
          <iframe
            key={`inline-${revision}`}
            srcDoc={srcDoc}
            title={`${displayTitle} preview`}
            sandbox="allow-scripts allow-downloads"
            referrerPolicy="no-referrer"
            onLoad={() => setInlineLoading(false)}
            className="h-full w-full border-0 bg-white"
          />
        </div>
      </section>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-[90]" onClose={closeArtifact}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-[#071f15]/55 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-hidden sm:p-3 md:p-5">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="translate-y-4 opacity-0 sm:scale-[0.98] sm:translate-y-0"
              enterTo="translate-y-0 opacity-100 sm:scale-100"
              leave="ease-in duration-150"
              leaveFrom="translate-y-0 opacity-100 sm:scale-100"
              leaveTo="translate-y-4 opacity-0 sm:scale-[0.98] sm:translate-y-0"
            >
              <Dialog.Panel
                ref={panelRef}
                className="grid h-[100dvh] w-full grid-rows-[auto_1fr] overflow-hidden bg-card shadow-2xl sm:h-full sm:rounded-3xl sm:border sm:border-white/20"
              >
                <header
                  className="flex min-h-16 items-center gap-2 border-b border-primary/10 bg-card px-3 sm:px-5"
                  style={{ paddingTop: 'env(safe-area-inset-top)' }}
                >
                  <button
                    type="button"
                    onClick={closeArtifact}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-primary transition-colors hover:bg-primary/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    aria-label="Close interactive app"
                    title="Close"
                  >
                    <FiX size={22} />
                  </button>

                  <div className="min-w-0 flex-1">
                    <Dialog.Title className="truncate text-sm font-semibold text-primary sm:text-base">
                      {displayTitle}
                    </Dialog.Title>
                    <Dialog.Description className="truncate text-xs text-primary/55">
                      {meta.eyebrow} · interactive workspace
                    </Dialog.Description>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {kind === 'plotly' && !showCode && (
                      <ToolbarButton label="Reset chart view" onClick={resetPlotlyView}>
                        <FiRotateCcw size={17} />
                        <span className="hidden lg:inline">Reset view</span>
                      </ToolbarButton>
                    )}
                    <ToolbarButton label="Reload app" onClick={reload}>
                      <FiRefreshCw size={17} />
                      <span className="hidden md:inline">Reload</span>
                    </ToolbarButton>
                    <ToolbarButton label={showCode ? 'Show app' : 'Show code'} onClick={() => setShowCode(!showCode)} active={showCode}>
                      <FiCode size={18} />
                      <span className="hidden md:inline">{showCode ? 'Preview' : 'Code'}</span>
                    </ToolbarButton>
                    <ToolbarButton
                      label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                      onClick={toggleFullscreen}
                      active={isFullscreen}
                    >
                      {isFullscreen ? <FiMinimize2 size={18} /> : <FiMaximize2 size={18} />}
                      <span className="hidden xl:inline">{isFullscreen ? 'Exit full screen' : 'Full screen'}</span>
                    </ToolbarButton>
                  </div>
                </header>

                <main className="relative min-h-0 bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                  {showCode ? (
                    <div className="relative h-full overflow-auto bg-[#111814] p-4 text-[#e7f0eb] sm:p-6">
                      <button
                        type="button"
                        onClick={copyCode}
                        className="sticky top-0 z-10 ml-auto flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-3 text-sm text-white backdrop-blur transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      >
                        {copied ? <FiCheck size={16} /> : <FiCopy size={16} />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      <pre className="mt-2 min-w-full whitespace-pre-wrap break-words font-mono text-[13px] leading-6 text-[#e7f0eb] sm:text-sm">
                        <code>{code}</code>
                      </pre>
                    </div>
                  ) : (
                    <>
                      {expandedLoading && (
                        <div className="absolute inset-0 z-10 grid place-items-center bg-white">
                          <div className="flex items-center gap-2 text-sm text-primary/65">
                            <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
                            Opening interactive app…
                          </div>
                        </div>
                      )}
                      <iframe
                        ref={expandedFrameRef}
                        key={`expanded-${revision}`}
                        srcDoc={srcDoc}
                        title={displayTitle}
                        sandbox="allow-scripts allow-downloads"
                        referrerPolicy="no-referrer"
                        onLoad={() => setExpandedLoading(false)}
                        className="h-full w-full border-0 bg-white"
                      />
                    </>
                  )}
                </main>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
    </>
  );
};
