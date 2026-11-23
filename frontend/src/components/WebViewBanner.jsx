import React, { useState } from 'react';

const IN_APP_UA_PATTERNS = [
  /FBAN|FBAV/,
  /Instagram/,
  /WhatsApp/,
  /Telegram/,
  /\bLine\b/,
  /; wv\)/,
];

function isInAppBrowser() {
  const ua = navigator.userAgent;
  return IN_APP_UA_PATTERNS.some(p => p.test(ua));
}

function WebViewBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('webview-banner-dismissed') === '1';
    } catch {
      return false;
    }
  });

  if (!isInAppBrowser() || dismissed) return null;

  const handleDismiss = () => {
    try {
      sessionStorage.setItem('webview-banner-dismissed', '1');
    } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div
      className="webview-banner"
      data-print-hide="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: '#fef08a',
        color: '#713f12',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.6rem 1rem',
        fontSize: '0.875rem',
        fontWeight: 500,
        borderBottom: '1px solid #fde047',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <span>In-app browser detected — open in Chrome to save as PDF.</span>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        style={{
          marginLeft: '1rem',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: '1.125rem',
          lineHeight: 1,
          color: '#713f12',
          padding: '0.25rem',
          borderRadius: '4px',
        }}
      >
        ×
      </button>
    </div>
  );
}

export default WebViewBanner;
