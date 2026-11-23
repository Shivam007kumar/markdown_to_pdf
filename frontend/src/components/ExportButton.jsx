import React from 'react';
import { Download, Loader2 } from 'lucide-react';

function ExportButton({ title, landscape, isPrinting }) {
  const handleExport = () => {
    if (isPrinting) return;

    // Inject dynamic @page orientation style
    const existingStyle = document.getElementById('page-orientation-style');
    if (existingStyle) existingStyle.remove();
    const styleEl = document.createElement('style');
    styleEl.id = 'page-orientation-style';
    styleEl.textContent = landscape
      ? '@page { size: A4 landscape; margin: 20mm; }'
      : '@page { size: A4 portrait; margin: 20mm; }';
    document.head.appendChild(styleEl);

    // Set document title for PDF filename
    const prevTitle = document.title;
    document.title = (title && title.trim()) ? title.trim() : 'MD2PDF-Document';

    // Print
    window.print();

    // Restore after print dialog closes
    const restoreTitle = () => {
      document.title = prevTitle;
      styleEl.remove();
      window.removeEventListener('afterprint', restoreTitle);
    };
    window.addEventListener('afterprint', restoreTitle);
    // Fallback timer in case afterprint does not fire
    setTimeout(() => {
      document.title = prevTitle;
      if (styleEl.parentNode) styleEl.remove();
    }, 60000);
  };

  return (
    <button
      onClick={handleExport}
      disabled={isPrinting}
      title="Tip: Turn off 'Headers and footers' in Chrome's print dialog."
      className={`export-button flex items-center gap-2 px-3 py-1.5 h-9 rounded-lg font-semibold transition-all shadow-lg active:scale-95 text-sm ${
        isPrinting
          ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
          : 'bg-slate-900 text-white hover:bg-slate-800'
      }`}
    >
      {isPrinting ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Preparing…
        </>
      ) : (
        <>
          <Download className="w-4 h-4" />
          Export PDF
        </>
      )}
    </button>
  );
}

export default ExportButton;
