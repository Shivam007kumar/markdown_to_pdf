import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Download, Loader2, AlertCircle } from 'lucide-react';

function ExportButton({ markdown, customCss }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const errorTimerRef = useRef(null);

  // Fix: Cleanup timeout on component unmount
  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  const handleExport = async () => {
    if (loading) return; // Fix: Prevent double-click race conditions
    if (!markdown || markdown.trim() === '') {
      setError('Cannot export an empty document.');
      errorTimerRef.current = setTimeout(() => setError(null), 6000);
      return;
    }
    setLoading(true);
    setError(null);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    
    try {
      const response = await axios.post('/api/export', {
        markdown,
        custom_css: customCss
      });

      const { url } = response.data;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        throw new Error('No download URL received');
      }
    } catch (err) {
      console.error('Export failed:', err);
      // Fix: Use inline error state instead of jarring window.alert()
      setError('Failed to generate PDF. Please try again.');
      errorTimerRef.current = setTimeout(() => setError(null), 6000); // extended to 6s per review
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {error && (
        <span className="text-red-500 text-sm font-medium flex items-center gap-1 animate-pulse">
          <AlertCircle className="w-4 h-4" />
          {error}
        </span>
      )}
      <button
        onClick={handleExport}
        disabled={loading}
        className={`flex items-center gap-2 px-6 py-2 rounded-lg font-semibold transition-all shadow-lg active:scale-95 ${loading ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Exporting...
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            Export PDF
          </>
        )}
      </button>
    </div>
  );
}

export default ExportButton;
