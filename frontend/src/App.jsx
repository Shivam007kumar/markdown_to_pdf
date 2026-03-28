import React, { useState, useEffect } from 'react';
import Editor from './components/Editor';
import Preview from './components/Preview';
import CSSEditor from './components/CSSEditor';
import ExportButton from './components/ExportButton';
import { Type, Code, Eye, FileText, Github, ChevronLeft, Check, Clipboard } from 'lucide-react';

const DEFAULT_MARKDOWN = '# Hello Markdown\n\nEdit me to see live preview!\n\n$$x^2 + y^2 = z^2$$';

function App() {
  const [markdown, setMarkdown] = useState('');
  const [customCss, setCustomCss] = useState('h1 {\n  color: #2c3e50;\n}');
  const [hasUserContent, setHasUserContent] = useState(false);
  
  // Mobile states
  const [activeMobileView, setActiveMobileView] = useState('preview'); // 'preview', 'editor', 'css'
  const [showTooltip, setShowTooltip] = useState(false);
  const [hasShownTooltip, setHasShownTooltip] = useState(false);

  useEffect(() => {
    if (hasUserContent && !hasShownTooltip) {
      setShowTooltip(true);
      setHasShownTooltip(true);
      const timer = setTimeout(() => setShowTooltip(false), 4500);
      return () => clearTimeout(timer);
    }
  }, [hasUserContent, hasShownTooltip]);

  const [debouncedMarkdown, setDebouncedMarkdown] = useState(markdown);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMarkdown(markdown), 300);
    return () => clearTimeout(timer);
  }, [markdown]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setMarkdown(text);
        setHasUserContent(true);
        setActiveMobileView('preview');
      }
    } catch (err) {
      console.error('Clipboard access denied or failed:', err);
      // Fallback is handled by the textarea below the button, no alert needed.
    }
  };

  const handleManualPaste = (e) => {
    const text = e.target.value;
    setMarkdown(text);
    if (text.trim() !== '') {
      setHasUserContent(true);
      setActiveMobileView('preview');
    }
  };

  const loadExample = () => {
    setMarkdown(DEFAULT_MARKDOWN);
    setHasUserContent(true);
    setActiveMobileView('preview');
  };

  // Render Landing State (Zero Content)
  if (!hasUserContent) {
    return (
      <div className="flex flex-col h-screen bg-slate-50 font-sans text-slate-900 items-center justify-center p-6 sm:p-8">
        <div className="max-w-md w-full flex flex-col items-center gap-6">
          <div className="w-20 h-20 flex items-center justify-center rounded-2xl bg-white p-3 shadow-md border border-slate-200">
            {/* The white logo looks better on a dark bg, but keeping docs_white with black tint or use docs.png */}
            <img src="/docs.png" alt="MD2PDF Logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent text-center">MD2PDF</h1>
          <p className="text-slate-500 text-center text-lg leading-relaxed">
            Convert Markdown into beautiful PDFs instantly.
          </p>

          <div className="w-full mt-4 flex flex-col gap-4">
            <button 
              onClick={handlePaste}
              className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white p-4 rounded-xl font-semibold shadow-lg transition-transform active:scale-95 text-lg w-full"
            >
              <Clipboard className="w-5 h-5" />
              Paste from Clipboard
            </button>
            
            <div className="relative w-full">
              <textarea 
                placeholder="Or manually paste plain markdown here..."
                onChange={handleManualPaste}
                rows={5}
                className="w-full p-4 rounded-xl border border-slate-200 shadow-inner bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none resize-none"
              />
            </div>

            <button 
              onClick={loadExample}
              className="text-slate-500 hover:text-slate-800 text-sm font-medium underline underline-offset-4 mt-2 transition-colors"
            >
              Start with an example template
            </button>
            <div className="mt-8 px-6 py-4 bg-white/40 backdrop-blur-xl border border-white/60 rounded-2xl shadow-sm w-full">
              <p className="text-sm text-center text-slate-700 font-medium">
                If you find MD2PDF useful, show some love with a <a href="https://github.com/Shivam007kumar/markdown_to_pdf" target="_blank" rel="noopener noreferrer" className="text-blue-600 font-bold hover:underline">⭐ Star on GitHub</a>!
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white font-sans text-slate-900 overflow-hidden relative">
      {/* Header */}
      <header className="flex justify-between items-center px-4 md:px-6 py-3 md:py-4 border-b border-slate-200 bg-white z-10 shrink-0">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-lg md:rounded-xl bg-white p-1 md:p-1.5 shadow-sm border border-slate-200/60 transition-transform hover:scale-105">
            <img src="/docs.png" alt="MD2PDF Logo" className="w-full h-full object-contain drop-shadow-sm" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">MD2PDF</h1>
        </div>
        
        <div className="flex justify-end items-center gap-4">
          {/* Desktop Github Link */}
          <a
            href="https://github.com/Shivam007kumar/markdown_to_pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-2 text-sm font-semibold text-slate-700 bg-white/40 backdrop-blur-2xl saturate-[150%] border-t border-l border-white/70 border-b border-r border-white/40 hover:bg-white/60 px-5 py-2.5 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all group hover:scale-105"
            title="Star us on GitHub!"
          >
            <Github className="w-4 h-4" />
            <span className="hidden lg:inline">Star on GitHub</span>
          </a>
          <ExportButton markdown={markdown} customCss={customCss} />
        </div>
      </header>

      {/* Main Content: Flex column on mobile, row on tablet/desktop */}
      <main className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0 relative">
        
        {/* Editor Panel 
            Mobile: Show only if activeMobileView is 'editor' or 'css'
            Desktop (md+): Always show taking half width (w-1/2)
        */}
        <div className={`
          md:w-1/2 md:flex flex-col border-r border-slate-200 min-h-0 bg-white
          ${(activeMobileView === 'editor' || activeMobileView === 'css') ? 'flex flex-1 absolute inset-0 z-20 md:static' : 'hidden md:flex'}
        `}>
          {/* Editor Header/Tabs */}
          <div className="flex border-b border-slate-200 bg-slate-50 shrink-0 justify-between items-center">
            <div className="flex">
              <button 
                onClick={() => setActiveMobileView('editor')}
                className={`flex items-center gap-2 px-4 md:px-6 py-3 text-sm font-medium transition-colors ${activeMobileView === 'editor' ? 'bg-white border-r border-slate-200 text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Type className="w-4 h-4" />
                <span className="hidden sm:inline">Markdown</span>
              </button>
              <button 
                onClick={() => setActiveMobileView('css')}
                className={`flex items-center gap-2 px-4 md:px-6 py-3 text-sm font-medium transition-colors ${activeMobileView === 'css' ? 'bg-white border-l border-r border-slate-200 text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Code className="w-4 h-4" />
                <span className="hidden sm:inline">CSS</span>
              </button>
            </div>
            
            {/* Mobile "Done" button to close editor overlay */}
            <button 
              onClick={() => setActiveMobileView('preview')}
              className="md:hidden flex items-center gap-1.5 px-4 text-sm font-semibold text-blue-600 hover:text-blue-800"
            >
              <Check className="w-4 h-4" />
              Done
            </button>
          </div>

          {/* Editor Container */}
          <div className="flex-1 overflow-auto bg-white min-h-0">
            {activeMobileView === 'css' ? (
              <CSSEditor value={customCss} onChange={setCustomCss} />
            ) : (
              <Editor value={markdown} onChange={(val) => { setMarkdown(val); }} />
            )}
          </div>
        </div>

        {/* Preview Panel
            Mobile: Show only if activeMobileView is 'preview'
            Desktop (md+): Always show taking half width
        */}
        <div className={`
          md:w-1/2 bg-slate-50 min-h-0
          ${activeMobileView === 'preview' ? 'flex flex-col flex-1 relative' : 'hidden md:flex flex-col'}
        `}>
          {/* Top Bar on Mobile for Edit Button */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <Eye className="w-4 h-4" />
              Live Preview
            </div>
            <button
              onClick={() => setActiveMobileView('editor')}
              className="md:hidden flex items-center gap-1.5 px-4 py-1.5 bg-white border border-slate-200 shadow-sm rounded-lg text-sm font-semibold text-slate-700 active:bg-slate-100 transition-transform active:scale-95"
            >
              <Type className="w-4 h-4" />
              Edit
            </button>
          </div>
          
          <div className="flex-1 overflow-auto bg-white p-4 md:p-6 min-h-0">
            <Preview markdown={debouncedMarkdown} customCss={customCss} />
          </div>
        </div>
      </main>

      {/* Floating Star on Mobile Only */}
      <div className={`md:hidden fixed bottom-6 left-4 z-40 transition-all duration-300 ${activeMobileView !== 'preview' ? 'opacity-0 pointer-events-none translate-y-4' : 'opacity-100 translate-y-0'}`}>
        <div className="relative flex items-center">
          
          {/* Fading Tooltip */}
          <div className={`absolute left-16 px-4 py-2 bg-slate-800/90 backdrop-blur-md text-white font-semibold text-sm rounded-2xl shadow-xl border border-white/10 whitespace-nowrap transition-all duration-700 origin-left ${showTooltip ? 'opacity-100 scale-100 translate-x-0' : 'opacity-0 scale-95 -translate-x-2 pointer-events-none'}`}>
            Show some love! ⭐
            <div className="absolute top-1/2 -left-2 -translate-y-1/2 w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-r-8 border-r-slate-800/90"></div>
          </div>

          <a
            href="https://github.com/Shivam007kumar/markdown_to_pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="flex shadow-[0_8px_32px_rgba(0,0,0,0.12)] items-center justify-center bg-white/40 backdrop-blur-2xl saturate-[150%] border-t border-l border-white/70 border-b border-r border-white/40 p-3.5 rounded-full text-slate-700 hover:scale-110 hover:bg-white/60 transition-all"
            title="Show some love on GitHub!"
          >
            <Github className="w-6 h-6" />
          </a>
        </div>
      </div>

    </div>
  );
}

export default App;
