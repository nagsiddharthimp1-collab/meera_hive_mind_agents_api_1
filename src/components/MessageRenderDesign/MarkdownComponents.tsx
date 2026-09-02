'use client';

import hljs from 'highlight.js';
import React, { useMemo, useRef, useState } from 'react';
import { FiCheck, FiCopy } from 'react-icons/fi';
import 'highlight.js/styles/atom-one-light.css';

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const DATA_IMAGE_URL_RE = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]+$/i;
const LIVE_HTML_LANGUAGES = new Set(['live-html', 'preview-html', 'html-live']);
const LIVE_REACT_LANGUAGES = new Set(['live-react', 'preview-react', 'react-live', 'live-jsx']);
const PLOTLY_LANGUAGES = new Set(['plotly', 'live-plotly', 'interactive-graph']);
const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: http:; style-src 'unsafe-inline' https: http:; img-src data: blob: https: http:; font-src data: https: http:; connect-src https: http:;";

const sanitizeLinkHref = (rawHref: unknown): string | null => {
  if (typeof rawHref !== 'string') return null;
  const href = rawHref.trim();
  if (!href) return null;

  if (href.startsWith('/')) return href;
  if (href.startsWith('#')) return href;

  try {
    const url = new URL(href);
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? href : null;
  } catch {
    return null;
  }
};

const sanitizeImageSrc = (rawSrc: unknown): string | null => {
  if (typeof rawSrc !== 'string') return null;
  const src = rawSrc.trim();
  if (!src) return null;

  if (src.startsWith('/')) return src;
  if (DATA_IMAGE_URL_RE.test(src)) return src;

  try {
    const url = new URL(src);
    return url.protocol === 'https:' || url.protocol === 'http:' ? src : null;
  } catch {
    return null;
  }
};

const normalizeCodeLanguage = (language: string): string => String(language || '').toLowerCase().trim();

const escapeClosingScriptTags = (source: string): string => source.replace(/<\/script/gi, '<\\/script');

const stripReactImportsAndExports = (source: string): string =>
  source
    .replace(/^\s*import\s.+?;?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+/gm, '')
    .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, '')
    .trim();

const stripMarkdownFences = (source: string): string =>
  source
    .replace(/^\s*```[a-z0-9+#-]*\s*$/gim, '')
    .replace(/^\s*```\s*$/gim, '')
    .trim();

const toSafeErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  return 'Unable to parse preview payload.';
};

const buildHtmlPreviewDocument = (source: string): string => {
  const hasHtmlTag = /<html[\s>]/i.test(source);
  const htmlBody = hasHtmlTag
    ? source
    : `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}" />
    <style>
      body {
        margin: 0;
        padding: 16px;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      }
    </style>
  </head>
  <body>
${source}
  </body>
</html>`;

  return htmlBody;
};

const buildReactPreviewDocument = (source: string): string => {
  const appSource = escapeClosingScriptTags(stripMarkdownFences(stripReactImportsAndExports(source)));
  const encodedSource = JSON.stringify(appSource);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}" />
    <style>
      html, body { margin: 0; padding: 0; }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
        padding: 16px;
      }
      #root { min-height: 200px; }
      .preview-error {
        color: #b91c1c;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        padding: 12px;
        white-space: pre-wrap;
      }
    </style>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script>
      (function bootReactPreview() {
        const mount = document.getElementById('root');
        const showError = (message) => {
          const safe = String(message || 'Runtime error').replace(/</g, '&lt;');
          mount.innerHTML = '<div class="preview-error">' + safe + '</div>';
        };

        try {
          const source = ${encodedSource};
          const transformed = Babel.transform(source, {
            filename: 'preview.tsx',
            sourceType: 'script',
            presets: [
              ['react', { runtime: 'classic' }],
              ['typescript', { isTSX: true, allExtensions: true }],
            ],
          }).code;

          class PreviewErrorBoundary extends React.Component {
            constructor(props) {
              super(props);
              this.state = { error: null };
            }
            static getDerivedStateFromError(error) {
              return { error };
            }
            render() {
              if (this.state.error) {
                const text = this.state.error && this.state.error.message
                  ? this.state.error.message
                  : String(this.state.error || 'Runtime error');
                return React.createElement(
                  'div',
                  { className: 'preview-error' },
                  text
                );
              }
              return this.props.children;
            }
          }

          const factory = new Function(
            'React',
            'ReactDOM',
            'Plotly',
            'const { useState, useEffect, useMemo, useCallback, useRef, useReducer, useContext, useLayoutEffect } = React;\\n' +
              transformed +
              '\\nreturn typeof App !== "undefined" ? App : null;'
          );
          const Candidate = factory(React, ReactDOM, window.Plotly);

          if (typeof Candidate === 'function') {
            const root = ReactDOM.createRoot(mount);
            root.render(
              React.createElement(
                PreviewErrorBoundary,
                null,
                React.createElement(Candidate)
              )
            );
            return;
          }
          showError('Define an App component for live-react preview.');
        } catch (error) {
          const message = error && error.message ? error.message : String(error || 'Runtime error');
          showError(message);
        }
      })();
    </script>
  </body>
</html>`;
};

const buildPlotlyPreviewDocument = (spec: Record<string, unknown>): string => {
  const safeSpec = JSON.stringify(spec);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}" />
    <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #ffffff; }
      #plot { width: 100%; height: 100%; min-height: 280px; }
      .plot-error {
        color: #b91c1c;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        margin: 16px;
        padding: 12px;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      }
    </style>
  </head>
  <body>
    <div id="plot"></div>
    <script>
      (function renderPlot() {
        try {
          const spec = ${safeSpec};
          const data = Array.isArray(spec.data) ? spec.data : [];
          const layout = (spec.layout && typeof spec.layout === 'object') ? spec.layout : {};
          const config = (spec.config && typeof spec.config === 'object') ? spec.config : {};
          layout.autosize = layout.autosize !== false;
          config.responsive = config.responsive !== false;
          config.displaylogo = false;
          Plotly.newPlot('plot', data, layout, config);
        } catch (error) {
          const el = document.getElementById('plot');
          const message = (error && error.message) ? error.message : String(error || 'Plot error');
          el.outerHTML = '<div class="plot-error">' + message.replace(/</g, '&lt;') + '</div>';
        }
      })();
    </script>
  </body>
</html>`;
};

// Props that react-markdown passes to custom components
interface ReactMarkdownProps {
  node?: any;
  children?: React.ReactNode;
  level?: number;
  ordered?: boolean;
  checked?: boolean | null;
  [key: string]: any;
}

// Combine with standard HTML attributes for the specific element type
type CustomComponentProps<T extends HTMLElement> = React.HTMLAttributes<T> & ReactMarkdownProps;

// Shared copy functionality hook
const useCopyToClipboard = () => {
  const [copied, setCopied] = useState(false);

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  return { copied, copyText };
};

// Helper function to extract text from React children
const extractTextFromChildren = (element: any): string => {
  if (typeof element === 'string') return element;
  if (typeof element === 'number') return String(element);
  if (!element) return '';

  if (element.props && element.props.children) {
    if (Array.isArray(element.props.children)) {
      return element.props.children.map(extractTextFromChildren).join('');
    }
    return extractTextFromChildren(element.props.children);
  }

  if (Array.isArray(element)) {
    return element.map(extractTextFromChildren).join('');
  }
  return '';
};

// CodeBlock component with copy functionality
interface CodeBlockProps {
  language: string;
  code: string;
}

const StaticCodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const { copied, copyText } = useCopyToClipboard();
  const displayLanguage = language ? language.charAt(0).toUpperCase() + language.slice(1) : '';

  const highlightedCode = useMemo(() => {
    const trimmedCode = code.trim();
    if (!trimmedCode) return '';
    try {
      const validLanguage = hljs.getLanguage(language) ? language : 'plaintext';
      return hljs.highlight(trimmedCode, { language: validLanguage, ignoreIllegals: true }).value;
    } catch (e) {
      console.error('Error highlighting code:', e);
      return trimmedCode; // Fallback to un-highlighted code
    }
  }, [code, language]);

  return (
    <div className="my-4 rounded-md border border-gray-200 overflow-hidden bg-gray-50">
      <div className="px-3 py-1.5 flex justify-between items-center bg-gray-100 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-700">{displayLanguage}</span>
        <button
          onClick={() => copyText(code)}
          className="p-0.5 rounded text-xs hover:bg-black/10 dark:hover:bg-white/10 transition-colors focus:outline-none cursor-pointer"
          title={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? (
            <FiCheck size={14} className="text-primary" />
          ) : (
            <FiCopy size={14} className="text-primary/60 hover:text-primary/80" />
          )}
        </button>
      </div>
      <pre className="text-[15px] font-sans overflow-x-auto whitespace-pre-wrap break-words">
        <code
          className={`language-${language || 'plaintext'} hljs`}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </pre>
    </div>
  );
};

const LivePreviewCodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const { copied, copyText } = useCopyToClipboard();
  const [showCode, setShowCode] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const normalizedLanguage = normalizeCodeLanguage(language);
  const isReactPreview = LIVE_REACT_LANGUAGES.has(normalizedLanguage);
  const displayLanguage = isReactPreview ? 'Live React Preview' : 'Live HTML Preview';

  const srcDoc = useMemo(
    () => (isReactPreview ? buildReactPreviewDocument(code) : buildHtmlPreviewDocument(code)),
    [code, isReactPreview],
  );

  return (
    <div className="my-4 rounded-md border border-gray-200 overflow-hidden bg-white">
      <div className="px-3 py-1.5 flex items-center justify-between bg-gray-100 border-b border-gray-200 gap-2">
        <span className="text-xs font-semibold text-gray-700">{displayLanguage}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCode((v) => !v)}
            className="px-2 py-1 rounded text-xs text-primary/80 hover:text-primary hover:bg-black/5 transition-colors"
            title={showCode ? 'Show preview' : 'Show code'}
          >
            {showCode ? 'Preview' : 'Code'}
          </button>
          <button
            onClick={() => setPreviewKey((k) => k + 1)}
            className="px-2 py-1 rounded text-xs text-primary/80 hover:text-primary hover:bg-black/5 transition-colors"
            title="Reload preview"
          >
            Reload
          </button>
          <button
            onClick={() => copyText(code)}
            className="p-0.5 rounded text-xs hover:bg-black/10 transition-colors focus:outline-none dark:hover:bg-white/10"
            title={copied ? 'Copied!' : 'Copy code'}
          >
            {copied ? (
              <FiCheck size={14} className="text-primary" />
            ) : (
              <FiCopy size={14} className="text-primary/60 hover:text-primary/80" />
            )}
          </button>
        </div>
      </div>
      {showCode ? (
        <pre className="text-[15px] font-sans overflow-x-auto whitespace-pre-wrap break-words p-3 bg-gray-50">
          <code className={`language-${language || 'plaintext'} hljs`}>{code}</code>
        </pre>
      ) : (
        <iframe
          key={`${normalizedLanguage}-${previewKey}`}
          title={displayLanguage}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-popups"
          className="w-full h-[420px] border-0 bg-white"
          loading="lazy"
        />
      )}
    </div>
  );
};

const PlotlyCodeBlock: React.FC<CodeBlockProps> = ({ code }) => {
  const { copied, copyText } = useCopyToClipboard();
  const [showCode, setShowCode] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const parsed = useMemo(() => {
    try {
      const raw = JSON.parse(code) as Record<string, unknown>;
      return { spec: raw, error: null as string | null };
    } catch (error) {
      return { spec: null as Record<string, unknown> | null, error: toSafeErrorMessage(error) };
    }
  }, [code]);

  const srcDoc = useMemo(() => (parsed.spec ? buildPlotlyPreviewDocument(parsed.spec) : ''), [parsed.spec]);

  return (
    <div className="my-4 rounded-md border border-gray-200 overflow-hidden bg-white">
      <div className="px-3 py-1.5 flex items-center justify-between bg-gray-100 border-b border-gray-200 gap-2">
        <span className="text-xs font-semibold text-gray-700">Interactive Graph (Plotly)</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCode((v) => !v)}
            className="px-2 py-1 rounded text-xs text-primary/80 hover:text-primary hover:bg-black/5 transition-colors"
            title={showCode ? 'Show preview' : 'Show code'}
          >
            {showCode ? 'Preview' : 'Code'}
          </button>
          <button
            onClick={() => setPreviewKey((k) => k + 1)}
            className="px-2 py-1 rounded text-xs text-primary/80 hover:text-primary hover:bg-black/5 transition-colors"
            title="Reload graph"
          >
            Reload
          </button>
          <button
            onClick={() => copyText(code)}
            className="p-0.5 rounded text-xs hover:bg-black/10 transition-colors focus:outline-none dark:hover:bg-white/10"
            title={copied ? 'Copied!' : 'Copy code'}
          >
            {copied ? (
              <FiCheck size={14} className="text-primary" />
            ) : (
              <FiCopy size={14} className="text-primary/60 hover:text-primary/80" />
            )}
          </button>
        </div>
      </div>

      {parsed.error ? (
        <div className="m-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Invalid Plotly JSON: {parsed.error}
        </div>
      ) : null}

      {showCode || parsed.error ? (
        <pre className="text-[15px] font-sans overflow-x-auto whitespace-pre-wrap break-words p-3 bg-gray-50">
          <code className="language-json hljs">{code}</code>
        </pre>
      ) : (
        <iframe
          key={`plotly-${previewKey}`}
          title="Interactive Graph Preview"
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          className="w-full h-[440px] border-0 bg-white"
          loading="lazy"
        />
      )}
    </div>
  );
};

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const normalizedLanguage = normalizeCodeLanguage(language);
  if (PLOTLY_LANGUAGES.has(normalizedLanguage)) {
    return <PlotlyCodeBlock language={language} code={code} />;
  }
  if (LIVE_HTML_LANGUAGES.has(normalizedLanguage) || LIVE_REACT_LANGUAGES.has(normalizedLanguage)) {
    return <LivePreviewCodeBlock language={language} code={code} />;
  }
  return <StaticCodeBlock language={language} code={code} />;
};

// Helper function for rendering standard inline code elements
export const renderStandardInlineCode = (
  inlineProps: React.ComponentPropsWithoutRef<'code'> & {
    node?: unknown;
  },
) => {
  const { className, children, ...htmlElementProps } = inlineProps;
  const codeContent = String(children || '');
  const urlRegex = /^(https?:\/\/|www\.)\S+/i;

  if (urlRegex.test(codeContent)) {
    const href = codeContent.startsWith('www.') ? `http://${codeContent}` : codeContent;
    const safeHref = sanitizeLinkHref(href);
    if (!safeHref) {
      return (
        <code
          {...htmlElementProps}
          className={`${className || ''} bg-primary/10 text-primary p-0.5 rounded-sm [font-family:inherit] [font-size:inherit]`}
        >
          {children}
        </code>
      );
    }

    return (
      <code
        {...htmlElementProps}
        className={`${className || ''} bg-primary/10 text-primary p-0.5 rounded-sm [font-family:inherit] [font-size:inherit]`}
      >
        <a href={safeHref} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
          {children}
        </a>
      </code>
    );
  }

  return (
    <code
      {...htmlElementProps}
      className={`${className || ''} bg-primary/10 text-primary p-0.5 rounded-sm [font-family:inherit] [font-size:inherit] break-words [overflow-wrap:anywhere]`}
    >
      {children}
    </code>
  );
};

// Paragraph component (fallback for any other content or response)
export const MyCustomParagraph: React.FC<CustomComponentProps<HTMLParagraphElement>> = ({
  children,
  node,
  ...rest
}) => (
  <p className="text-[15px] font-sans leading-relaxed mt-2 break-words [overflow-wrap:anywhere]" {...rest}>
    {children}
  </p>
);

// Heading components
export const MyCustomH1: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h1 className="text-2xl font-sans font-semibold pt-4 pb-2 border-b border-gray-300" {...rest}>
    {children}
  </h1>
);

export const MyCustomH2: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h2 className="text-xl font-sans font-semibold pt-4 pb-2 border-b border-gray-300" {...rest}>
    {children}
  </h2>
);

export const MyCustomH3: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h3 className="text-lg font-sans font-semibold pt-2 pb-2 border-b border-gray-300" {...rest}>
    {children}
  </h3>
);

export const MyCustomH4: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h4 className="text-base font-sans font-semibold pt-2 pb-2" {...rest}>
    {children}
  </h4>
);

export const MyCustomH5: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h5 className="text-sm font-sans font-semibold pt-2 pb-2" {...rest}>
    {children}
  </h5>
);

export const MyCustomH6: React.FC<CustomComponentProps<HTMLHeadingElement>> = ({ children, node, ...rest }) => (
  <h6 className="text-xs font-sans font-semibold pt-2 pb-2" {...rest}>
    {children}
  </h6>
);

// Blockquote component with copy functionality
export const MyCustomBlockquote: React.FC<CustomComponentProps<HTMLQuoteElement>> = ({ children, node, ...rest }) => {
  const { copied, copyText } = useCopyToClipboard();

  const handleCopy = () => {
    const text = extractTextFromChildren(children);
    copyText(text);
  };

  return (
    <div className="my-4">
      <blockquote
        className="border-l-4 font-sans border-primary pl-4 italic bg-primary/10 p-4 pb-2 rounded-md text-[15px] relative"
        {...rest}
      >
        <div className="flex justify-between items-start">
          <div className="flex-1 pr-6">{children}</div>
          <button
            onClick={handleCopy}
            className="p-0.5 rounded text-xs hover:bg-black/10 transition-colors focus:outline-none dark:hover:bg-white/10 flex-shrink-0"
            title={copied ? 'Copied!' : 'Copy quote'}
          >
            {copied ? (
              <FiCheck size={14} className="text-primary" />
            ) : (
              <FiCopy size={14} className="text-primary/60 hover:text-primary/80" />
            )}
          </button>
        </div>
      </blockquote>
    </div>
  );
};

// List components
export const MyCustomUl: React.FC<CustomComponentProps<HTMLUListElement>> = ({ children, node, ...rest }) => (
  <ul className="list-disc font-sans pl-6 space-y-1 my-2 text-[15px]" {...rest}>
    {children}
  </ul>
);

export const MyCustomOl: React.FC<CustomComponentProps<HTMLOListElement>> = ({ children, node, ordered, ...rest }) => (
  <ol className="list-decimal font-sans pl-6 space-y-1 my-4 text-[15px]" {...rest}>
    {children}
  </ol>
);

export const MyCustomLi: React.FC<CustomComponentProps<HTMLLIElement>> = ({ children, node, ...rest }) => (
  <li className="font-sans text-[15px] break-words [overflow-wrap:anywhere]" {...rest}>
    {children}
  </li>
);

// Other inline elements
export const MyCustomHr: React.FC<CustomComponentProps<HTMLHRElement>> = ({ node, ...rest }) =>
  // do not render line breaks
  null;
// <hr className="my-4 border-gray-300" {...rest} />

export const MyCustomA: React.FC<CustomComponentProps<HTMLAnchorElement>> = ({ children, node, href, ...rest }) => {
  const safeHref = sanitizeLinkHref(href);
  if (!safeHref) {
    return <span className="font-sans break-words [overflow-wrap:anywhere]">{children}</span>;
  }

  const isExternal = /^https?:\/\//i.test(safeHref);
  return (
    <a
      href={safeHref}
      className="font-sans text-primary underline hover:no-underline focus:outline-none focus:ring-1 focus:ring-primary-focus break-words [overflow-wrap:anywhere]"
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer nofollow' : undefined}
      {...rest}
    >
      {children}
    </a>
  );
};

export const MyCustomImg: React.FC<CustomComponentProps<HTMLImageElement>> = ({ node, src, alt, ...rest }) => {
  const safeSrc = sanitizeImageSrc(src);
  if (!safeSrc) return null;

  return (
    <div className="block my-4 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-md">
      <img
        src={safeSrc}
        alt={typeof alt === 'string' && alt.trim() ? alt : 'image'}
        className="rounded-md border border-gray-200 shadow-sm font-sans w-full h-auto object-contain"
        {...rest}
      />
    </div>
  );
};

export const MyCustomDel: React.FC<CustomComponentProps<HTMLElement>> = ({ children, node, ...rest }) => (
  <del className="font-sans text-[15px]" {...rest}>
    {children}
  </del>
);

export const MyCustomSub: React.FC<CustomComponentProps<HTMLElement>> = ({ children, node, ...rest }) => (
  <sub className="font-sans align-baseline text-[0.75em] leading-none" {...rest}>
    {children}
  </sub>
);

export const MyCustomSup: React.FC<CustomComponentProps<HTMLElement>> = ({ children, node, ...rest }) => (
  <sup className="font-sans align-baseline text-[0.75em] leading-none" {...rest}>
    {children}
  </sup>
);

// Table components with copy functionality
export const MyCustomTable: React.FC<CustomComponentProps<HTMLTableElement>> = ({ children, node, ...rest }) => {
  const { copied, copyText } = useCopyToClipboard();
  const tableRef = useRef<HTMLTableElement>(null);

  const handleCopy = () => {
    if (!tableRef.current) return;
    const tableText = Array.from(tableRef.current.rows)
      .map((row) =>
        Array.from(row.cells)
          .map((cell) => cell.innerText)
          .join('\t'),
      )
      .join('\n');
    copyText(tableText);
  };

  return (
    <div className="mb-4 font-sans text-[15px]">
      <div className="flex justify-end">
        <button
          onClick={handleCopy}
          className="p-0.5 rounded text-xs hover:bg-black/10 transition-colors focus:outline-none dark:hover:bg-white/10"
          title={copied ? 'Copied!' : 'Copy table'}
        >
          {copied ? (
            <FiCheck size={14} className="text-primary" />
          ) : (
            <FiCopy size={14} className="text-primary/60 hover:text-primary/80" />
          )}
        </button>
      </div>
      <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-primary scrollbar-track-gray-200 hover:scrollbar-thumb-primary/80 scrollbar-thumb-rounded-md">
        <table ref={tableRef} className="min-w-full divide-y divide-gray-300 border border-gray-300" {...rest}>
          {children}
        </table>
      </div>
    </div>
  );
};

export const MyCustomThead: React.FC<CustomComponentProps<HTMLTableSectionElement>> = ({ children, node, ...rest }) => (
  <thead className="bg-gray-50" {...rest}>
    {children}
  </thead>
);

export const MyCustomTbody: React.FC<CustomComponentProps<HTMLTableSectionElement>> = ({ children, node, ...rest }) => (
  <tbody className="divide-y divide-gray-200 bg-white" {...rest}>
    {children}
  </tbody>
);

export const MyCustomTr: React.FC<CustomComponentProps<HTMLTableRowElement>> = ({ children, node, ...rest }) => (
  <tr className="hover:bg-gray-50" {...rest}>
    {children}
  </tr>
);

export const MyCustomTh: React.FC<CustomComponentProps<HTMLTableCellElement> & { isNumeric?: boolean }> = ({
  children,
  node,
  isNumeric,
  ...rest
}) => (
  <th
    scope="col"
    className={`px-4 py-3 text-left text-sm font-sans font-semibold text-gray-900 ${
      isNumeric ? 'text-right' : ''
    } last:pr-12`}
    {...rest}
  >
    {children}
  </th>
);

export const MyCustomTd: React.FC<CustomComponentProps<HTMLTableCellElement> & { isNumeric?: boolean }> = ({
  children,
  node,
  isNumeric,
  ...rest
}) => {
  const processedChildren = React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      const parts = child.split(/<br\s*\/?>/i);
      if (parts.length > 1) {
        return parts.map((part, index) => (
          <React.Fragment key={index}>
            {part}
            {index < parts.length - 1 && <br />}
          </React.Fragment>
        ));
      }
    }
    return child;
  });

  return (
    <td
      className={`whitespace-normal align-top font-sans px-4 py-2 text-[15px] text-gray-700 ${
        isNumeric ? 'text-right' : ''
      }`}
      {...rest}
    >
      {processedChildren}
    </td>
  );
};

// Image Skeleton component for showing loading state during image generation
export const ImageSkeleton: React.FC = () => {
  return (
    <div className="my-4 rounded-md border border-gray-200 overflow-hidden bg-gray-50">
      <div className="h-76 w-76 sm:h-136 sm:w-136 md:h-95 md:w-95 bg-gray-200 rounded-md flex items-center justify-center">
        {/* Primary color loader in the center */}
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    </div>
  );
};
