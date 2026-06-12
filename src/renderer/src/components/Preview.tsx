/**
 * Preview Component
 * 
 * This component renders a live preview of LaTeX content using KaTeX.
 */

import React, { useEffect, useRef, useState } from 'react';
import { FiRefreshCw, FiAlertCircle, FiLoader } from 'react-icons/fi';

interface PreviewProps {
  content: string;
  isLoading: boolean;
  error?: string;
  renderTime: number;
  refresh: () => void;
}

const Preview: React.FC<PreviewProps> = ({
  content,
  isLoading,
  error,
  renderTime,
  refresh,
}) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const [isKaTeXLoaded, setIsKaTeXLoaded] = useState(false);
  
  // Check if KaTeX is loaded
  useEffect(() => {
    const checkKaTeX = () => {
      if (typeof window !== 'undefined' && (window as any).katex) {
        setIsKaTeXLoaded(true);
      } else {
        // KaTeX might be loading from CDN
        setTimeout(checkKaTeX, 100);
      }
    };
    
    checkKaTeX();
  }, []);
  
  // Auto-refresh when KaTeX loads
  useEffect(() => {
    if (isKaTeXLoaded && content) {
      renderPreview();
    }
  }, [isKaTeXLoaded, content]);
  
  // Render preview with KaTeX
  const renderPreview = () => {
    if (!previewRef.current || !isKaTeXLoaded) return;
    
    try {
      // Clear previous content
      previewRef.current.innerHTML = '';
      
      // For now, we'll render the content as HTML with basic math support
      // In a full implementation, we would use a more sophisticated LaTeX renderer
      previewRef.current.innerHTML = renderContentWithMath(content);
      
      // Apply KaTeX rendering to all math elements
      if (typeof (window as any).katex !== 'undefined') {
        (window as any).katex.renderMathInElement(previewRef.current, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true },
          ],
          throwOnError: false,
          errorColor: '#cc0000',
        });
      }
    } catch (err) {
      console.error('Error rendering preview:', err);
    }
  };
  
  // Render content with math expressions
  const renderContentWithMath = (content: string): string => {
    // Escape HTML special characters
    let html = escapeHtml(content);
    
    // Replace LaTeX environments with HTML equivalents
    html = replaceEnvironments(html);
    
    // Replace special LaTeX commands with HTML
    html = replaceCommands(html);
    
    return html;
  };
  
  // Escape HTML special characters
  const escapeHtml = (text: string): string => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/\n/g, '<br>')
      .replace(/\s\s/g, '&nbsp;&nbsp;');
  };
  
  // Replace LaTeX environments with HTML
  const replaceEnvironments = (html: string): string => {
    // Replace \begin{center}...\end{center} with <div style="text-align: center">...</div>
    html = html.replace(/\\\\begin\\{center\\}([\s\S]*?)\\\\end\\{center\\}/g, '<div style="text-align: center">$1</div>');
    
    // Replace \begin{itemize}...\end{itemize} with <ul>...</ul>
    html = html.replace(/\\\\begin\\{itemize\\}([\s\S]*?)\\\\end\\{itemize\\}/g, '<ul>$1</ul>');
    html = html.replace(/\\\\item/g, '<li>');
    
    // Replace \begin{enumerate}...\end{enumerate} with <ol>...</ol>
    html = html.replace(/\\\\begin\\{enumerate\\}([\s\S]*?)\\\\end\\{enumerate\\}/g, '<ol>$1</ol>');
    html = html.replace(/\\\\item/g, '<li>');
    
    // Replace \begin{quote}...\end{quote} with <blockquote>...</blockquote>
    html = html.replace(/\\\\begin\\{quote\\}([\s\S]*?)\\\\end\\{quote\\}/g, '<blockquote>$1</blockquote>');
    
    // Replace \textbf{...} with <strong>...</strong>
    html = html.replace(/\\\\textbf\\{([^}]*)\\}/g, '<strong>$1</strong>');
    
    // Replace \textit{...} with <em>...</em>
    html = html.replace(/\\\\textit\\{([^}]*)\\}/g, '<em>$1</em>');
    
    // Replace \underline{...} with <u>...</u>
    html = html.replace(/\\\\underline\\{([^}]*)\\}/g, '<u>$1</u>');
    
    // Replace \section{...} with <h2>...</h2>
    html = html.replace(/\\\\section\\{([^}]*)\\}/g, '<h2>$1</h2>');
    
    // Replace \subsection{...} with <h3>...</h3>
    html = html.replace(/\\\\subsection\\{([^}]*)\\}/g, '<h3>$1</h3>');
    
    // Replace \subsubsection{...} with <h4>...</h4>
    html = html.replace(/\\\\subsubsection\\{([^}]*)\\}/g, '<h4>$1</h4>');
    
    // Replace \paragraph{...} with <h5>...</h5>
    html = html.replace(/\\\\paragraph\\{([^}]*)\\}/g, '<h5>$1</h5>');
    
    // Replace \textbf{...} with <strong>...</strong>
    html = html.replace(/\\\\textbf\\{([^}]*)\\}/g, '<strong>$1</strong>');
    
    // Replace \emph{...} with <em>...</em>
    html = html.replace(/\\\\emph\\{([^}]*)\\}/g, '<em>$1</em>');
    
    return html;
  };
  
  // Replace LaTeX commands with HTML
  const replaceCommands = (html: string): string => {
    // Replace \newline with <br>
    html = html.replace(/\\\\newline/g, '<br>');
    
    // Replace \linebreak with <br>
    html = html.replace(/\\\\linebreak/g, '<br>');
    
    // Replace \pagebreak with <hr>
    html = html.replace(/\\\\pagebreak/g, '<hr>');
    
    // Replace \hline with <hr>
    html = html.replace(/\\\\hline/g, '<hr>');
    
    // Replace \noindent with style to remove indent
    html = html.replace(/\\\\noindent/g, '<span style="text-indent: 0;">');
    
    // Replace \today with current date
    html = html.replace(/\\\\today/g, new Date().toLocaleDateString());
    
    // Replace \LaTeX with the LaTeX logo
    html = html.replace(/\\\\LaTeX/g, '<span style="font-family: serif;">L<span style="text-size: 0.7em; vertical-align: super;">A</span>T<span style="text-size: 0.7em; vertical-align: super;">E</span>X</span>');
    
    // Replace \TeX with the TeX logo
    html = html.replace(/\\\\TeX/g, '<span style="font-family: serif;">T<span style="text-size: 0.7em; vertical-align: super;">E</span>X</span>');
    
    return html;
  };
  
  return (
    <div className="preview-container h-full w-full flex flex-col">
      {/* Preview Toolbar */}
      <div className="flex items-center justify-between p-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-2">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">Preview</h3>
          
          {isLoading && (
            <span className="flex items-center space-x-1 text-xs text-gray-500 dark:text-gray-400">
              <FiLoader className="w-3 h-3 animate-spin" />
              <span>Rendering...</span>
            </span>
          )}
          
          {renderTime > 0 && !isLoading && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {renderTime.toFixed(0)}ms
            </span>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          {error && (
            <span className="flex items-center space-x-1 text-xs text-red-500">
              <FiAlertCircle className="w-3 h-3" />
              <span>Error</span>
            </span>
          )}
          
          <button
            onClick={refresh}
            className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Refresh Preview"
          >
            <FiRefreshCw className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
      </div>
      
      {/* Preview Content */}
      <div 
        ref={previewRef}
        className="flex-1 overflow-auto p-4 bg-white dark:bg-gray-800"
        style={{
          fontSize: '16px',
          lineHeight: '1.6',
        }}
      >
        {content ? (
          <div 
            className="latex-preview prose dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: renderContentWithMath(content) }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <p>Preview will appear here</p>
          </div>
        )}
        
        {!isKaTeXLoaded && (
          <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-md border border-yellow-200 dark:border-yellow-800">
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              Loading KaTeX for math rendering...
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Preview;
