/**
 * Main App Component
 * 
 * This is the root component for the Polemic LaTeX Editor application.
 */

import React, { useState, useEffect } from 'react';
import { useLaTeXEditor } from './hooks/useLaTeXEditor';
import { useTheme } from './hooks/useTheme';
import Editor from './components/Editor';
import Preview from './components/Preview';
import Toolbar from './components/Toolbar';
import StatusBar from './components/StatusBar';
import Sidebar from './components/Sidebar';
import { FiMenu, FiX, FiMoon, FiSun, FiSettings } from 'react-icons/fi';

const App: React.FC = () => {
  const { theme, isDarkMode, toggleTheme, setTheme } = useTheme();
  const editor = useLaTeXEditor({
    initialContent: `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\title{Welcome to Polemic}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Welcome to Polemic, your open-source LaTeX editor!

\\section{Mathematics}

Here's some example math:

Inline: $E = mc^2$

Display math:
$$\\int_{a}^{b} x^2 \\,dx = \\frac{x^3}{3} \\Big|_{a}^{b}$$

\\end{document}`,
    debounceTime: 300,
  });
  
  const [showSidebar, setShowSidebar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        editor.saveDocument();
      }
      
      // Ctrl/Cmd + N to create new document
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        editor.createNewDocument();
      }
      
      // Ctrl/Cmd + T to toggle theme
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        toggleTheme();
      }
      
      // Ctrl/Cmd + P to toggle preview
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        editor.handleToggleSplitView();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editor, toggleTheme]);
  
  return (
    <div className="flex h-screen w-full bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* Sidebar */}
      {showSidebar && (
        <Sidebar 
          documents={editor.documents} 
          activeDocumentId={editor.activeDocumentId}
          onSwitchDocument={editor.switchDocument}
          onCreateDocument={editor.createNewDocument}
          onClose={() => setShowSidebar(false)}
        />
      )}
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <FiMenu className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
            
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {editor.document.title}
              </h1>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {editor.document.filePath ? editor.document.filePath.split('/').pop() : 'Untitled'}
              </span>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
            >
              {isDarkMode ? (
                <FiSun className="w-5 h-5 text-yellow-500" />
              ) : (
                <FiMoon className="w-5 h-5 text-blue-500" />
              )}
            </button>
            
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Settings"
            >
              <FiSettings className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        </header>
        
        {/* Toolbar */}
        <Toolbar 
          editor={editor} 
          isDarkMode={isDarkMode}
        />
        
        {/* Editor and Preview Area */}
        <div className="flex-1 flex overflow-hidden">
          {editor.isSplitView ? (
            <>
              <div className="flex-1 overflow-auto">
                <Editor 
                  content={editor.content}
                  onChange={editor.handleContentChange}
                  onCursorChange={editor.handleCursorChange}
                  onSelectionChange={editor.handleSelectionChange}
                  onFocusChange={editor.handleFocusChange}
                  fontSize={editor.fontSize}
                  showLineNumbers={editor.showLineNumbers}
                  tokens={editor.tokens}
                  validation={editor.validation}
                  insertText={editor.insertText}
                  insertCommand={editor.insertCommand}
                  insertEnvironment={editor.insertEnvironment}
                  wrapSelection={editor.wrapSelection}
                />
              </div>
              <div className="w-px bg-gray-200 dark:bg-gray-700" />
              <div className="flex-1 overflow-auto">
                <Preview 
                  content={editor.previewContent}
                  isLoading={editor.isPreviewLoading}
                  error={editor.previewError}
                  renderTime={editor.renderTime}
                  refresh={editor.refreshPreview}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-auto">
              <Editor 
                content={editor.content}
                onChange={editor.handleContentChange}
                onCursorChange={editor.handleCursorChange}
                onSelectionChange={editor.handleSelectionChange}
                onFocusChange={editor.handleFocusChange}
                fontSize={editor.fontSize}
                showLineNumbers={editor.showLineNumbers}
                tokens={editor.tokens}
                validation={editor.validation}
                insertText={editor.insertText}
                insertCommand={editor.insertCommand}
                insertEnvironment={editor.insertEnvironment}
                wrapSelection={editor.wrapSelection}
              />
            </div>
          )}
        </div>
        
        {/* Status Bar */}
        <StatusBar 
          stats={editor.stats}
          validation={editor.validation}
          isSplitView={editor.isSplitView}
          onToggleSplitView={editor.handleToggleSplitView}
          renderTime={editor.renderTime}
        />
      </div>
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-96 max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                <FiX className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Theme
                </label>
                <select
                  value={theme.id}
                  onChange={(e) => setTheme(e.target.value)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="dracula">Dracula</option>
                  <option value="solarized">Solarized Light</option>
                  <option value="solarized-dark">Solarized Dark</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Font Size
                </label>
                <input
                  type="range"
                  min="10"
                  max="24"
                  value={editor.fontSize}
                  onChange={(e) => editor.handleFontSizeChange(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-center text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {editor.fontSize}px
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Line Numbers
                </label>
                <button
                  onClick={editor.handleToggleLineNumbers}
                  className={`px-3 py-1 rounded-md text-sm ${editor.showLineNumbers ? 'bg-primary-100 dark:bg-primary-900' : 'bg-gray-100 dark:bg-gray-700'}`}
                >
                  {editor.showLineNumbers ? 'On' : 'Off'}
                </button>
              </div>
              
              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Split View
                </label>
                <button
                  onClick={editor.handleToggleSplitView}
                  className={`px-3 py-1 rounded-md text-sm ${editor.isSplitView ? 'bg-primary-100 dark:bg-primary-900' : 'bg-gray-100 dark:bg-gray-700'}`}
                >
                  {editor.isSplitView ? 'On' : 'Off'}
                </button>
              </div>
            </div>
            
            <div className="flex justify-end space-x-2 mt-6">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
