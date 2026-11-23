import React, { useState } from 'react';
import { Share2, Loader2, X, Copy, Check } from 'lucide-react';

function ShareButton({ title, markdown, customCss }) {
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const copyToClipboard = async (text) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      // fall through to execCommand fallback
    }
    // execCommand fallback
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
      return ok;
    } catch (_) {
      return false;
    }
  };

  const handleShare = async () => {
    if (!markdown.trim()) {
      setStatus('error');
      setErrorMsg('Nothing to share — write some Markdown first.');
      return;
    }

    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, markdown, custom_css: customCss }),
      });

      if (res.status === 429) {
        setStatus('error');
        setErrorMsg('Too many shares — please wait before sharing again.');
        return;
      }

      if (res.status === 201) {
        const data = await res.json();
        const url = `${window.location.origin}/shared/${data.id}`;
        setShareUrl(url);
        setStatus('success');
        setShowModal(true);
        copyToClipboard(url);
        return;
      }

      // 5xx or unexpected
      setStatus('error');
      setErrorMsg('Share failed. Please try again.');
    } catch (_) {
      setStatus('error');
      setErrorMsg('Share failed. Please try again.');
    }
  };

  const handleCopyInModal = async () => {
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setShowModal(false);
    setStatus('idle');
    setShareUrl('');
    setCopied(false);
  };

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={handleShare}
          disabled={status === 'loading'}
          title="Share this document"
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all shadow active:scale-95 text-sm ${
            status === 'loading'
              ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {status === 'loading' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="hidden sm:inline">Sharing…</span>
            </>
          ) : (
            <>
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">Share</span>
            </>
          )}
        </button>
        {status === 'error' && (
          <span className="text-[11px] text-red-500 max-w-[180px] text-right leading-tight">
            {errorMsg}
          </span>
        )}
      </div>

      {/* Share modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Link copied!</h2>
              <button
                onClick={handleClose}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-500">
              Your document is now shareable. The link has been copied to your clipboard.
            </p>

            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <span className="text-sm text-slate-700 flex-1 select-all break-all font-mono">
                {shareUrl}
              </span>
              <button
                onClick={handleCopyInModal}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-700 transition-colors"
              >
                {copied ? (
                  <><Check className="w-3.5 h-3.5" /> Copied</>
                ) : (
                  <><Copy className="w-3.5 h-3.5" /> Copy</>
                )}
              </button>
            </div>

            <p className="text-xs text-slate-400 text-center">Expires in 7 days</p>

            <button
              onClick={handleClose}
              className="mt-1 text-sm text-slate-500 hover:text-slate-800 font-medium underline underline-offset-2 self-center transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default ShareButton;
