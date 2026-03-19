import React, { useState } from 'react';
import axios from 'axios';
import { Download, Loader2 } from 'lucide-react';

function ExportButton({ markdown, customCss }) {
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const response = await axios.post('/api/export', {
        markdown,
        custom_css: customCss
      });

      // The backend now returns a JSON with an S3 presigned URL
      const { url } = response.data;
      if (url) {
        window.open(url, '_blank');
      } else {
        throw new Error('No download URL received');
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to generate PDF. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
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
  );
}

export default ExportButton;
