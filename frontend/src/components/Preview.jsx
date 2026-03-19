import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';

function Preview({ markdown, customCss }) {
  // Memoize the CSS to prevent unnecessary re-renders
  const styleElement = useMemo(() => (
    <style dangerouslySetInnerHTML={{ __html: customCss }} />
  ), [customCss]);

  return (
    <div className="p-10 max-w-4xl mx-auto shadow-sm bg-white min-h-[120%] mb-10 preview-container">
      {styleElement}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, rehypeKatex]}
        components={{
          code({ inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            
            if (!inline && language === 'mermaid') {
              // We'll handle mermaid by rendering it via mermaid.ink logic
              const code = String(children).trim();
              const encoded = btoa(code);
              return <img src={`https://mermaid.ink/svg/${encoded}`} alt="Mermaid diagram" className="mx-auto" />;
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
