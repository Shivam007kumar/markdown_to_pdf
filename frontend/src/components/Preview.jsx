import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { renderDocument, renderMermaidDiagrams } from '../lib/renderDocument';

function Preview({ markdown, customCss }) {
  const [html, setHtml] = useState('');
  const containerRef = useRef(null);
  const renderIdRef = useRef(0);

  // Custom CSS style element (keep existing behavior: basic </style> breakout protection)
  const styleElement = useMemo(() => {
    const sanitizedCss = (customCss || '').replace(/<\/?style.*?>/gi, '');
    return <style dangerouslySetInnerHTML={{ __html: sanitizedCss }} />;
  }, [customCss]);

  // Render pipeline: debounced, with render-ID cancellation for stale async mermaid
  useEffect(() => {
    // Increment render ID; mermaid callbacks will check this before applying SVGs
    const currentId = ++renderIdRef.current;

    const timer = setTimeout(async () => {
      try {
        const rendered = await renderDocument(markdown || '');

        // Check the render is still current before setting state
        if (renderIdRef.current !== currentId) return;

        setHtml(rendered);

        // After React flushes the HTML into the DOM, run mermaid async rendering
        // We use a microtask (via queueMicrotask or rAF) so the ref is populated
        requestAnimationFrame(() => {
          if (renderIdRef.current !== currentId) return;
          if (containerRef.current) {
            renderMermaidDiagrams(
              containerRef.current,
              currentId,
              () => renderIdRef.current
            );
          }
        });
      } catch (err) {
        console.error('[Preview] renderDocument error:', err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [markdown]);

  return (
    <div className="p-10 max-w-4xl mx-auto shadow-sm bg-white min-h-[120%] mb-10 preview-container">
      {styleElement}
      <div
        ref={containerRef}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export default Preview;
