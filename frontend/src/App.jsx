import React, { useState, useEffect } from 'react';
import Editor from './components/Editor';
import Preview from './components/Preview';
import CSSEditor from './components/CSSEditor';
import ExportButton from './components/ExportButton';
import { Type, Code, Eye, FileText, Github } from 'lucide-react';

function App() {
  const [markdown, setMarkdown] = useState('# Hello Markdown\n\nEdit me to see live preview!\n\n$$x^2 + y^2 = z^2$$');
  const [customCss, setCustomCss] = useState('h1 {\n  color: #2c3e50;\n}');
  const [activeTab, setActiveTab] = useState('editor'); // 'editor' or 'css'

  // Fix: Debounce markdown updates to Preview by 300ms to save rendering CPU and network calls
  const [debouncedMarkdown, setDebouncedMarkdown] = useState(markdown);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMarkdown(markdown), 300);
    return () => clearTimeout(timer);
  }, [markdown]);

  return (
    <div className="flex flex-col h-screen bg-white font-sans text-slate-900 overflow-hidden">
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-white p-1.5 shadow-sm border border-slate-200/60 transition-transform hover:scale-105">
            <img src="/docs_white.png" alt="MD2PDF Logo" className="w-full h-full object-contain drop-shadow-sm" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">MD2PDF</h1>
        </div>
        
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/Shivam007kumar/markdown_to_pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors group"
            title="Star us on GitHub!"
          >
            <Github className="w-5 h-5 group-hover:scale-110 transition-transform" />
            <span className="hidden sm:inline">Star on GitHub</span>
          </a>
          <ExportButton markdown={markdown} customCss={customCss} />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1 overflow-hidden min-h-0">
        {/* Left Panel (Editors) */}
        <div className="w-1/2 flex flex-col border-r border-slate-200 min-h-0">
          {/* Tabs */}
          <div className="flex border-b border-slate-200 bg-slate-50 shrink-0">
            <button 
              onClick={() => setActiveTab('editor')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors ${activeTab === 'editor' ? 'bg-white border-r border-slate-200 text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Type className="w-4 h-4" />
              Markdown
            </button>
            <button 
              onClick={() => setActiveTab('css')}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors ${activeTab === 'css' ? 'bg-white border-l border-r border-slate-200 text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Code className="w-4 h-4" />
              Custom CSS
            </button>
          </div>

          {/* Editor Container */}
          <div className="flex-1 overflow-auto bg-white min-h-0">
            {activeTab === 'editor' ? (
              <Editor value={markdown} onChange={setMarkdown} />
            ) : (
              <CSSEditor value={customCss} onChange={setCustomCss} />
            )}
          </div>
        </div>

        {/* Right Panel (Preview) */}
        <div className="w-1/2 flex flex-col bg-slate-50 min-h-0">
          <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-200 bg-slate-50 text-sm font-medium text-slate-500 shrink-0">
            <Eye className="w-4 h-4" />
            Live Preview
          </div>
          <div className="flex-1 overflow-auto bg-white p-6 min-h-0">
            <Preview markdown={debouncedMarkdown} customCss={customCss} />
          </div>
        </div>
      </main>
    </div>
  );
}


export default App;
