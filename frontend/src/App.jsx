import React, { useState, useEffect, useMemo, useCallback } from 'react';
import localforage from 'localforage';
import Editor from './components/Editor';
import Preview from './components/Preview';
import CSSEditor from './components/CSSEditor';
import ExportButton from './components/ExportButton';
import ShareButton from './components/ShareButton';
import SharedView from './components/SharedView';
import WebViewBanner from './components/WebViewBanner';
import { Type, Code, Eye, Github, ChevronLeft, Check, Clipboard, Trash2, SpellCheck } from 'lucide-react';

const DEFAULT_MARKDOWN = '# Hello Markdown\n\nEdit me to see live preview!\n\n$$x^2 + y^2 = z^2$$';

function App() {
  const [markdown, setMarkdown] = useState('');
  const [customCss, setCustomCss] = useState('h1 {\n  color: #2c3e50;\n}');
  const [hasUserContent, setHasUserContent] = useState(false);
  const [imageMap, setImageMap] = useState({});
  const [saveStatus, setSaveStatus] = useState('idle'); // idle, saving, saved
  const [isInitialized, setIsInitialized] = useState(false);
  const [title, setTitle] = useState('');
  const [landscape, setLandscape] = useState(false);
  const [isMermaidRendering, setIsMermaidRendering] = useState(false);
  const [hasDoubleEscapedMath, setHasDoubleEscapedMath] = useState(false);
  const [spellcheckEnabled, setSpellcheckEnabled] = useState(true);

  const handleFixMathDelimiters = useCallback(() => {
    // Replace all \\(...\\) with \(...\) and \\[...\\] with \[...\] in markdown
    setMarkdown((prev) =>
      prev
        .replace(/\\\\(\([\s\S]*?\\\\[)])/g, (_, inner) => {
          const content = inner.slice(1, inner.lastIndexOf('\\\\'));
          return `\\(${content}\\)`;
        })
        .replace(/\\\\(\[[\s\S]*?\\\\\])/g, (_, inner) => {
          const content = inner.slice(1, inner.lastIndexOf('\\\\'));
          return `\\[${content}\\]`;
        })
    );
  }, []);

  // Mobile states
  const [activeMobileView, setActiveMobileView] = useState('preview'); // 'preview', 'editor', 'css'
  const [showTooltip, setShowTooltip] = useState(false);
  const [hasShownTooltip, setHasShownTooltip] = useState(false);

  // Routing: check for /shared/:id before any localforage reads
  const sharedMatch = window.location.pathname.match(/^\/shared\/([A-Za-z0-9]{12})\/?$/);
  const isSharedPath = window.location.pathname.startsWith('/shared/');
  if (isSharedPath && !sharedMatch) {
    // Invalid /shared/... path — render not-found
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
  if (sharedMatch) {
    return <SharedView id={sharedMatch[1]} />;
  }

  // Load draft on mount
  useEffect(() => {
    localforage.getItem('md2pdf_draft').then((draft) => {
      if (draft) {
        if (draft.markdown !== undefined) setMarkdown(draft.markdown);
        if (draft.customCss !== undefined) setCustomCss(draft.customCss);
        if (draft.imageMap !== undefined) setImageMap(draft.imageMap);
        setHasUserContent(true);
      }
      setIsInitialized(true);
    });
    localforage.getItem('md2pdf-title').then(v => { if (v) setTitle(v); });
    localforage.getItem('md2pdf-landscape').then(v => { if (v !== null) setLandscape(!!v); });
    localforage.getItem('md2pdf-spellcheck').then(v => { if (v !== null && v !== undefined) setSpellcheckEnabled(!!v); });
  }, []);

  // Save to draft whenever content changes
  useEffect(() => {
    if (!isInitialized) return;
    
    // Don't auto-save if everything is completely empty and no user content yet
    if (!hasUserContent && markdown === '' && Object.keys(imageMap).length === 0) return;
    
    setSaveStatus('saving');
    
    const draftData = {
      markdown,
      customCss,
      imageMap
    };
    
    const timer = setTimeout(() => {
      localforage.setItem('md2pdf_draft', draftData).then(() => {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      });
    }, 800); // Debounce saving
    
    return () => clearTimeout(timer);
  }, [markdown, customCss, imageMap, isInitialized, hasUserContent]);

  // Auto-save title
  useEffect(() => {
    const t = setTimeout(() => localforage.setItem('md2pdf-title', title), 300);
    return () => clearTimeout(t);
  }, [title]);

  // Auto-save landscape
  useEffect(() => {
    localforage.setItem('md2pdf-landscape', landscape);
  }, [landscape]);

  // Auto-save spellcheck toggle
  useEffect(() => {
    localforage.setItem('md2pdf-spellcheck', spellcheckEnabled);
  }, [spellcheckEnabled]);

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

  const resolvedMarkdownForExport = useMemo(() => {
    let result = markdown;
    Object.keys(imageMap).forEach((blobUrl) => {
      result = result.split(blobUrl).join(imageMap[blobUrl]);
    });
    return result;
  }, [markdown, imageMap]);

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

  const handleClearDocument = async () => {
    await localforage.removeItem('md2pdf_draft');
    setMarkdown('');
    setCustomCss('h1 {\n  color: #2c3e50;\n}');
    setImageMap({});
    setHasUserContent(false);
    setActiveMobileView('preview');
  };

  // Render Landing State (Zero Content)
  if (!hasUserContent) {
    return (
      <div className="flex flex-col h-screen bg-slate-50 font-sans text-slate-900 items-center justify-center p-6 sm:p-8">
        <WebViewBanner />
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
    <div className="app-shell flex flex-col h-screen bg-white font-sans text-slate-900 overflow-hidden relative">
      <WebViewBanner />
      {/* Header */}
      <header className="flex justify-between items-center px-4 md:px-6 py-3 md:py-4 border-b border-slate-200 bg-white z-10 shrink-0">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-8 h-8 md:w-10 md:h-10 flex items-center justify-center rounded-lg md:rounded-xl bg-white p-1 md:p-1.5 shadow-sm border border-slate-200/60 transition-transform hover:scale-105">
            <img src="/docs.png" alt="MD2PDF Logo" className="w-full h-full object-contain drop-shadow-sm" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent leading-none">MD2PDF</h1>
            {saveStatus === 'saving' && <span className="text-[10px] md:text-[11px] text-slate-400 font-medium mt-0.5 animate-pulse">Saving...</span>}
            {saveStatus === 'saved' && <span className="text-[10px] md:text-[11px] text-emerald-500 font-medium mt-0.5">All changes saved locally</span>}
          </div>
        </div>

        {/* Title input */}
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Document title…"
          className="hidden md:block border border-gray-300 rounded-md px-3 py-1 text-sm font-semibold text-gray-800 bg-white max-w-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none placeholder:font-normal placeholder:text-gray-400"
        />

        {/* Landscape/Portrait pill toggle */}
        <div className="hidden md:flex orientation-toggle" role="group" aria-label="Page orientation">
          <button
            className={`orientation-option${!landscape ? ' active' : ''}`}
            onClick={() => setLandscape(false)}
            aria-pressed={!landscape}
          >
            📄 Portrait
          </button>
          <button
            className={`orientation-option${landscape ? ' active' : ''}`}
            onClick={() => setLandscape(true)}
            aria-pressed={landscape}
          >
            🖥 Landscape
          </button>
        </div>

        {/* Spellcheck toggle */}
        <button
          onClick={() => setSpellcheckEnabled(prev => !prev)}
          title={spellcheckEnabled ? 'Disable spellcheck' : 'Enable spellcheck'}
          className={`hidden md:flex items-center gap-1.5 text-sm font-medium border rounded-lg px-3 py-1.5 h-9 transition-colors ${spellcheckEnabled ? 'text-blue-700 border-blue-200 bg-blue-50 hover:bg-blue-100' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
        >
          <SpellCheck className="w-4 h-4" />
          <span>Spellcheck</span>
        </button>
        
        <div className="flex justify-end items-center gap-2 md:gap-3">
          <button
            onClick={handleClearDocument}
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-red-600 transition-colors p-2 md:px-3 md:py-1.5 h-9 rounded-xl hover:bg-red-50"
            title="Clear Document"
          >
            <Trash2 className="w-4 h-4 md:w-4 md:h-4" />
            <span className="hidden lg:inline">Clear</span>
          </button>
          
          {/* Desktop Github Link */}
          <a
            href="https://github.com/Shivam007kumar/markdown_to_pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-2 text-sm font-semibold text-slate-700 border border-gray-300 bg-white hover:bg-gray-50 hover:border-gray-400 px-3 py-1.5 h-9 rounded-lg transition-all"
            title="Star us on GitHub!"
          >
            <Github className="w-4 h-4" />
            <span className="hidden lg:inline">Star on GitHub</span>
          </a>
          <ExportButton title={title} landscape={landscape} isPrinting={isMermaidRendering} />
          <ShareButton title={title} markdown={resolvedMarkdownForExport} customCss={customCss} />
        </div>
      </header>

      {/* Main Content: Flex column on mobile, row on tablet/desktop */}
      <main className="split-workspace flex flex-col md:flex-row flex-1 overflow-hidden min-h-0 relative">
        
        {/* Editor Panel 
            Mobile: Show only if activeMobileView is 'editor' or 'css'
            Desktop (md+): Always show taking half width (w-1/2)
        */}
        <div className={`editor-pane
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
            <div className="flex items-center gap-2">
              {hasDoubleEscapedMath && (
                <button
                  onClick={handleFixMathDelimiters}
                  title='Fix double-escaped math delimiters (\\( → \()'
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-md hover:bg-amber-100 transition-colors"
                >
                  Fix \\( delimiters
                </button>
              )}
              <button 
                onClick={() => setActiveMobileView('preview')}
                className="md:hidden flex items-center gap-1.5 px-4 text-sm font-semibold text-blue-600 hover:text-blue-800"
              >
                <Check className="w-4 h-4" />
                Done
              </button>
            </div>
          </div>

          {/* Editor Container */}
          <div className="flex-1 overflow-auto bg-white min-h-0">
            {activeMobileView === 'css' ? (
              <CSSEditor value={customCss} onChange={setCustomCss} />
            ) : (
              <Editor 
                value={markdown} 
                onChange={(val) => { setMarkdown(val); }} 
                onImageAdded={(blobUrl, base64) => setImageMap(prev => ({...prev, [blobUrl]: base64}))} 
                onHasDoubleEscapedMath={setHasDoubleEscapedMath}
                spellcheckEnabled={spellcheckEnabled}
              />
            )}
          </div>
        </div>

        {/* Preview Panel
            Mobile: Show only if activeMobileView is 'preview'
            Desktop (md+): Always show taking half width
        */}
        <div className={`preview-pane
          md:w-1/2 bg-slate-50 min-h-0
          ${activeMobileView === 'preview' ? 'flex flex-col flex-1 relative' : 'hidden md:flex flex-col'}
        `}>
          {/* Top Bar on Mobile for Edit Button */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-slate-50 shrink-0" data-print-hide="true">
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
            <Preview markdown={debouncedMarkdown} customCss={customCss} onRenderingChange={setIsMermaidRendering} />
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
