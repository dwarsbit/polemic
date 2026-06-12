/**
 * Editor Component
 * 
 * This component provides a LaTeX editor with syntax highlighting,
 * line numbers, and other editing features.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import { LaTeXToken } from '../types';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vscLightPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface EditorProps {
  content: string;
  onChange: (content: string) => void;
  onCursorChange: (position: number) => void;
  onSelectionChange: (start: number, end: number) => void;
  onFocusChange: (isFocused: boolean) => void;
  fontSize: number;
  showLineNumbers: boolean;
  tokens: LaTeXToken[];
  validation: { valid: boolean; errors: string[] };
  insertText: (text: string, replaceSelection?: boolean) => void;
  insertCommand: (command: string) => void;
  insertEnvironment: (environment: string) => void;
  wrapSelection: (prefix: string, suffix: string) => void;
}

const Editor: React.FC<EditorProps> = ({
  content,
  onChange,
  onCursorChange,
  onSelectionChange,
  onFocusChange,
  fontSize,
  showLineNumbers,
  tokens,
  validation,
  insertText,
  insertCommand,
  insertEnvironment,
  wrapSelection,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  
  // Sync textarea with content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.value = content;
    }
  }, [content]);
  
  // Handle textarea changes
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
  }, [onChange]);
  
  // Handle cursor and selection changes
  const handleSelectionChange = useCallback(() => {
    if (textareaRef.current) {
      const cursorPos = textareaRef.current.selectionStart;
      const selectionStart = textareaRef.current.selectionStart;
      const selectionEnd = textareaRef.current.selectionEnd;
      
      onCursorChange(cursorPos);
      onSelectionChange(selectionStart, selectionEnd);
    }
  }, [onCursorChange, onSelectionChange]);
  
  // Handle focus changes
  const handleFocus = useCallback(() => {
    onFocusChange(true);
  }, [onFocusChange]);
  
  const handleBlur = useCallback(() => {
    onFocusChange(false);
  }, [onFocusChange]);
  
  // Update line numbers
  useEffect(() => {
    if (lineNumbersRef.current && showLineNumbers) {
      const lineCount = content.split('\n').length;
      const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1).join('\n');
      lineNumbersRef.current.textContent = lineNumbers;
    }
  }, [content, showLineNumbers]);
  
  // Sync scroll between editor and line numbers
  useEffect(() => {
    const textarea = textareaRef.current;
    const lineNumbers = lineNumbersRef.current;
    const editor = editorRef.current;
    
    if (!textarea || !lineNumbers || !editor) return;
    
    const handleScroll = () => {
      lineNumbers.scrollTop = textarea.scrollTop;
    };
    
    textarea.addEventListener('scroll', handleScroll);
    return () => textarea.removeEventListener('scroll', handleScroll);
  }, []);
  
  // Calculate editor height
  const calculateHeight = useCallback(() => {
    if (editorRef.current) {
      const lineHeight = fontSize * 1.5;
      const lineCount = content.split('\n').length;
      const minHeight = 100;
      const height = Math.max(minHeight, lineCount * lineHeight);
      return `${height}px`;
    }
    return '100%';
  }, [content, fontSize]);
  
  // Get syntax highlighting style based on theme
  const getSyntaxStyle = useCallback(() => {
    const isDark = document.documentElement.classList.contains('dark');
    return isDark ? vscDarkPlus : vscLightPlus;
  }, []);
  
  // Custom syntax highlighter for LaTeX
  const renderWithLaTeXHighlighting = useCallback((code: string) => {
    // This is a simplified version - in a real implementation,
    // we would use the tokenized LaTeX for more accurate highlighting
    return (
      <SyntaxHighlighter 
        language="latex" 
        style={getSyntaxStyle()}
        customStyle={{ 
          fontSize: `${fontSize}px`, 
          fontFamily: 'Fira Code, Monaco, Consolas, monospace',
          lineHeight: '1.5',
          padding: '1rem',
          background: 'transparent',
        }}
        showLineNumbers={false}
      >
        {code}
      </SyntaxHighlighter>
    );
  }, [fontSize, getSyntaxStyle]);
  
  return (
    <div 
      ref={editorRef} 
      className="editor-container flex h-full w-full overflow-hidden relative"
    >
      {/* Line Numbers */}
      {showLineNumbers && (
        <div 
          ref={lineNumbersRef}
          className="line-numbers absolute left-0 top-0 w-12 h-full overflow-hidden text-right pr-4 select-none bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700"
          style={{ 
            fontSize: `${fontSize}px`, 
            lineHeight: '1.5',
            paddingTop: '1rem',
          }}
        />
      )}
      
      {/* Textarea for editing */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleTextareaChange}
        onSelect={handleSelectionChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={handleSelectionChange}
        onKeyUp={handleSelectionChange}
        className="absolute inset-0 w-full h-full resize-none outline-none bg-transparent text-transparent caret-gray-900 dark:caret-gray-100 break-words whitespace-pre-wrap"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily: 'Fira Code, Monaco, Consolas, monospace',
          lineHeight: '1.5',
          padding: '1rem',
          paddingLeft: showLineNumbers ? '3.5rem' : '1rem',
          tabSize: 2,
        }}
      />
      
      {/* Syntax Highlighted Content (read-only display) */}
      <div 
        className="absolute inset-0 w-full h-full overflow-auto pointer-events-none"
        style={{
          padding: '1rem',
          paddingLeft: showLineNumbers ? '3.5rem' : '1rem',
        }}
      >
        <div 
          className="whitespace-pre-wrap break-words"
          style={{
            fontSize: `${fontSize}px`,
            fontFamily: 'Fira Code, Monaco, Consolas, monospace',
            lineHeight: '1.5',
          }}
        >
          {content.split('\n').map((line, index) => (
            <div key={index} className="relative">
              {renderLineWithHighlighting(line, tokens, index)}
            </div>
          ))}
        </div>
      </div>
      
      {/* Validation Errors */}
      {!validation.valid && validation.errors.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800 p-2 text-sm">
          {validation.errors.map((error, index) => (
            <div key={index} className="text-red-600 dark:text-red-400">
              {error}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Render a line with syntax highlighting based on tokens
 */
function renderLineWithHighlighting(line: string, tokens: LaTeXToken[], lineIndex: number): React.ReactNode {
  // Find tokens that belong to this line
  const lineStart = line === '' ? 0 : contentUpToLine(lineIndex).length;
  const lineEnd = lineStart + line.length;
  
  const lineTokens = tokens.filter(token => 
    token.start >= lineStart && token.end <= lineEnd
  );
  
  // If no tokens for this line, return the line as-is
  if (lineTokens.length === 0) {
    return line || '\n';
  }
  
  // Sort tokens by start position
  lineTokens.sort((a, b) => a.start - b.start);
  
  // Build the highlighted line
  const parts: React.ReactNode[] = [];
  let currentPos = 0;
  
  for (const token of lineTokens) {
    // Add text before the token
    if (token.start > currentPos) {
      parts.push(
        <span key={`text-${currentPos}`} className="text-gray-900 dark:text-gray-100">
          {line.slice(currentPos, token.start - lineStart)}
        </span>
      );
    }
    
    // Add the token with appropriate styling
    const tokenText = line.slice(token.start - lineStart, token.end - lineStart);
    parts.push(
      <span key={`token-${token.start}`} className={getTokenClassName(token.type)}>
        {tokenText}
      </span>
    );
    
    currentPos = token.end - lineStart;
  }
  
  // Add remaining text
  if (currentPos < line.length) {
    parts.push(
      <span key={`text-${currentPos}`} className="text-gray-900 dark:text-gray-100">
        {line.slice(currentPos)}
      </span>
    );
  }
  
  return <>{parts}</>;
}

/**
 * Get the content up to a specific line
 */
function contentUpToLine(lineIndex: number, content?: string): string {
  if (!content) return '';
  const lines = content.split('\n');
  return lines.slice(0, lineIndex).join('\n') + '\n';
}

/**
 * Get CSS class name for a token type
 */
function getTokenClassName(tokenType: LaTeXToken['type']): string {
  switch (tokenType) {
    case 'command':
      return 'text-blue-600 dark:text-blue-400';
    case 'environment':
      return 'text-green-600 dark:text-green-400';
    case 'math':
      return 'text-orange-600 dark:text-orange-400';
    case 'comment':
      return 'text-gray-500 dark:text-gray-400 italic';
    case 'string':
      return 'text-red-600 dark:text-red-400';
    case 'text':
    default:
      return 'text-gray-900 dark:text-gray-100';
  }
}

export default Editor;
