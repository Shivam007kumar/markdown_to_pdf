import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import pako from 'pako';

function Preview({ markdown, customCss }) {
  // Fix: Move custom CSS sanitization exclusively inside useMemo to avoid redundant executions on every keystroke
  const styleElement = useMemo(() => {
    // Basic protection against closing tag breakouts, documented as a permissive implementation
    const sanitizedCss = customCss.replace(/<\/?style.*?>/gi, '');
    return <style dangerouslySetInnerHTML={{ __html: sanitizedCss }} />;
  }, [customCss]);

  return (
    <div className="p-10 max-w-4xl mx-auto shadow-sm bg-white min-h-[120%] mb-10 preview-container">
      {styleElement}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          // Fix: Remove deprecated 'inline' prop for ReactMarkdown v9
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            
            const supportedDiagrams = ['mermaid', 'plantuml', 'd2', 'excalidraw', 'graphviz', 'structurizr'];
            if (match && supportedDiagrams.includes(language)) {
              // Handle supported diagrams by rendering them via Kroki.io
              const code = String(children).trim();
              try {
                const data = new TextEncoder().encode(code);
                const compressed = pako.deflate(data, { level: 9 });
                // Fix: Use Uint8Array + reduce for exponentially faster base64 string construction on large inputs
                const binaryString = new Uint8Array(compressed).reduce((acc, byte) => acc + String.fromCharCode(byte), '');
                const encoded = btoa(binaryString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                return <img src={`https://kroki.io/${language}/svg/${encoded}`} alt={`${language} diagram`} className="mx-auto" />;
              } catch (e) {
                return <code>{code}</code>;
              }
            }
            
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export default Preview;
