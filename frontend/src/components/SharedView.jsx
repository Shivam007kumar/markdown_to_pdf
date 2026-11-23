import React, { useState, useEffect } from 'react';
import localforage from 'localforage';
import Preview from './Preview';
import ExportButton from './ExportButton';
import WebViewBanner from './WebViewBanner';
import { Copy, Check, Edit3, Loader2 } from 'lucide-react';

function formatExpiry(ttlSeconds) {
  if (typeof ttlSeconds !== 'number' || ttlSeconds <= 0) return 'Expired';
  const days = Math.floor(ttlSeconds / 86400);
  const hours = Math.floor((ttlSeconds % 86400) / 3600);
  if (days > 0 && hours > 0) return `Expires in ${days}d ${hours}h`;
  if (days > 0) return `Expires in ${days}d`;
  if (hours > 0) return `Expires in ${hours}h`;
  const mins = Math.floor(ttlSeconds / 60);
  return mins > 0 ? `Expires in ${mins}m` : 'Expires soon';
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return Promise.resolve(ok);
  } catch (_) {
    return Promise.resolve(false);
  }
}

function SharedView({ id }) {
  const [state, setState] = useState('loading'); // loading | error | ready
  const [doc, setDoc] = useState(null);
  const [landscape, setLandscape] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/share/${id}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 200) {
          const data = await res.json();
          setState('ready');
          setDoc(data);
        } else {
          setState('error');
        }
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => { cancelled = true; };
  }, [id]);

  const handleCopyLink = async () => {
    const ok = await copyToClipboard(window.location.href);
    if (ok) {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const handleEditCopy = async () => {
    if (!doc) return;
    const confirmed = window.confirm(
      'Replace your current local draft with a copy of this shared note?'
    );
    if (!confirmed) return;
    await localforage.setItem('md2pdf-title', doc.title);
    await localforage.setItem('md2pdf-markdown', doc.markdown);
    await localforage.setItem('md2pdf-css', doc.custom_css);
    await localforage.setItem('md2pdf_draft', {
      markdown: doc.markdown,
      customCss: doc.custom_css,
      imageMap: {},
    });
    window.location.href = '/';
  };

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span className="text-sm font-medium">Loading shared document…</span>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-6">
        <div className="text-center max-w-sm flex flex-col gap-4">
          <p className="text-2xl font-bold text-slate-800">Link not found</p>
          <p className="text-slate-500 text-sm leading-relaxed">
            This shared link has expired or does not exist.
          </p>
          <a
            href="/"
            className="inline-block mt-2 px-6 py-2.5 bg-slate-900 text-white font-semibold rounded-xl shadow hover:bg-slate-700 transition-colors text-sm"
          >
            Open MD2PDF Editor
          </a>
        </div>
      </div>
    );
  }

  // Sanitize CSS: strip @import and external url() references
  const sanitizedCss = (doc.custom_css || '')
    .replace(/@import[^;]*;/gi, '')
    .replace(/url\s*\(\s*["']?(https?:|\/\/)[^)]*["']?\s*\)/gi, 'url()');

  return (
    <div className="shared-view-container bg-white">
      <WebViewBanner />

      {/* Header bar — hidden on print */}
      <div
        className="flex flex-wrap items-center gap-2 px-4 md:px-6 py-3 border-b border-slate-200 bg-white"
        data-print-hide="true"
      >
        {/* Title */}
        <span className="font-bold text-slate-800 text-base md:text-lg flex-1 min-w-0 truncate">
          {doc.title || 'Shared Document'}
        </span>

        {/* Expiry badge */}
        <span className="shrink-0 text-xs font-medium px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full">
          {formatExpiry(doc.ttl_seconds)}
        </span>

        {/* Landscape toggle */}
        <button
          onClick={() => setLandscape((prev) => !prev)}
          className="shrink-0 text-xs font-medium px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-slate-600"
        >
          {landscape ? 'Landscape' : 'Portrait'}
        </button>

        {/* Save as PDF */}
        <ExportButton title={doc.title} landscape={landscape} isPrinting={isPrinting} />

        {/* Copy Link */}
        <button
          onClick={handleCopyLink}
          className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-slate-700"
        >
          {linkCopied ? (
            <><Check className="w-3.5 h-3.5 text-green-600" /> Copied</>
          ) : (
            <><Copy className="w-3.5 h-3.5" /> Copy Link</>
          )}
        </button>

        {/* Edit a copy */}
        <button
          onClick={handleEditCopy}
          className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors"
        >
          <Edit3 className="w-3.5 h-3.5" />
          Edit a copy
        </button>
      </div>

      {/* Document content */}
      <div className="p-4 md:p-8">
        <Preview
          markdown={doc.markdown}
          customCss={sanitizedCss}
          onRenderingChange={setIsPrinting}
        />
      </div>
    </div>
  );
}

export default SharedView;
