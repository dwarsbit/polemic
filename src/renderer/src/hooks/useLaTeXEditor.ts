/**
 * useLaTeXEditor Hook
 * 
 * Custom hook for managing LaTeX editor state and functionality.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { EditorState, PreviewState, LaTeXDocument } from '../types';
import { tokenizeLaTeX, validateLaTeX, countStats } from '../utils/latexParser';
import { renderLaTeXDocument, replaceMathExpressions } from '../utils/latexRenderer';
import { debounce } from './useDebounce';

export interface LaTeXEditorOptions {
  initialContent?: string;
  initialFontSize?: number;
  showLineNumbers?: boolean;
  isSplitView?: boolean;
  debounceTime?: number;
}

export interface LaTeXEditorResult {
  // Editor state
  content: string;
  cursorPosition: number;
  selectionStart: number;
  selectionEnd: number;
  isFocused: boolean;
  fontSize: number;
  showLineNumbers: boolean;
  isSplitView: boolean;
  
  // Preview state
  previewContent: string;
  isPreviewLoading: boolean;
  previewError?: string;
  renderTime: number;
  
  // Document state
  document: LaTeXDocument;
  documents: LaTeXDocument[];
  activeDocumentId: string;
  
  // Statistics
  stats: {
    words: number;
    characters: number;
    lines: number;
  };
  
  // Validation
  validation: {
    valid: boolean;
    errors: string[];
  };
  
  // Syntax highlighting
  tokens: ReturnType<typeof tokenizeLaTeX>;
  
  // Editor handlers
  handleContentChange: (newContent: string) => void;
  handleCursorChange: (position: number) => void;
  handleSelectionChange: (start: number, end: number) => void;
  handleFocusChange: (isFocused: boolean) => void;
  handleFontSizeChange: (size: number) => void;
  handleToggleLineNumbers: () => void;
  handleToggleSplitView: () => void;
  
  // Document handlers
  createNewDocument: () => void;
  switchDocument: (documentId: string) => void;
  updateDocumentTitle: (title: string) => void;
  saveDocument: () => Promise<void>;
  
  // Preview handlers
  refreshPreview: () => void;
  
  // Utility functions
  insertText: (text: string, replaceSelection?: boolean) => void;
  insertCommand: (command: string) => void;
  insertEnvironment: (environment: string) => void;
  wrapSelection: (prefix: string, suffix: string) => void;
}

const DEFAULT_OPTIONS: LaTeXEditorOptions = {
  initialContent: '',
  initialFontSize: 14,
  showLineNumbers: true,
  isSplitView: true,
  debounceTime: 300,
};

const DEFAULT_DOCUMENT: LaTeXDocument = {
  id: 'default',
  title: 'Untitled Document',
  content: '',
  createdAt: new Date(),
  updatedAt: new Date(),
};

export function useLaTeXEditor(options: LaTeXEditorOptions = {}): LaTeXEditorResult {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  
  // State management
  const [documents, setDocuments] = useState<LaTeXDocument[]>([DEFAULT_DOCUMENT]);
  const [activeDocumentId, setActiveDocumentId] = useState<string>('default');
  const [fontSize, setFontSize] = useState<number>(mergedOptions.initialFontSize!);
  const [showLineNumbers, setShowLineNumbers] = useState<boolean>(mergedOptions.showLineNumbers!);
  const [isSplitView, setIsSplitView] = useState<boolean>(mergedOptions.isSplitView!);
  
  // Editor state
  const [cursorPosition, setCursorPosition] = useState<number>(0);
  const [selectionStart, setSelectionStart] = useState<number>(0);
  const [selectionEnd, setSelectionEnd] = useState<number>(0);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  
  // Preview state
  const [previewContent, setPreviewContent] = useState<string>('');
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string>();
  const [renderTime, setRenderTime] = useState<number>(0);
  
  // Syntax highlighting
  const [tokens, setTokens] = useState<ReturnType<typeof tokenizeLaTeX>>([]);
  
  // Validation
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] }>({
    valid: true,
    errors: [],
  });
  
  // Statistics
  const [stats, setStats] = useState<{ words: number; characters: number; lines: number }>({
    words: 0,
    characters: 0,
    lines: 0,
  });
  
  // Ref for debouncing
  const debounceRef = useRef<ReturnType<typeof debounce>>();
  
  // Get active document
  const activeDocument = documents.find(doc => doc.id === activeDocumentId) || documents[0];
  const content = activeDocument.content;
  
  // Initialize with provided content
  useEffect(() => {
    if (mergedOptions.initialContent) {
      setDocuments([{
        ...DEFAULT_DOCUMENT,
        content: mergedOptions.initialContent,
      }]);
    }
  }, [mergedOptions.initialContent]);
  
  // Update tokens, validation, and stats when content changes
  useEffect(() => {
    const newTokens = tokenizeLaTeX(content);
    setTokens(newTokens);
    
    const newValidation = validateLaTeX(content);
    setValidation(newValidation);
    
    const newStats = countStats(content);
    setStats(newStats);
  }, [content]);
  
  // Debounced preview update
  useEffect(() => {
    debounceRef.current = debounce(() => {
      updatePreview();
    }, mergedOptions.debounceTime);
    
    debounceRef.current();
    
    return () => {
      if (debounceRef.current) {
        debounceRef.current.cancel();
      }
    };
  }, [content, mergedOptions.debounceTime]);
  
  const updatePreview = useCallback(() => {
    setIsPreviewLoading(true);
    setPreviewError(undefined);
    
    try {
      const startTime = performance.now();
      
      // For now, we'll use a simple approach: replace math expressions
      // In a full implementation, we'd use a more sophisticated renderer
      const rendered = replaceMathExpressions(content);
      
      setPreviewContent(rendered);
      setRenderTime(performance.now() - startTime);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Unknown error');
      setPreviewContent('');
    } finally {
      setIsPreviewLoading(false);
    }
  }, [content]);
  
  // Editor handlers
  const handleContentChange = useCallback((newContent: string) => {
    setDocuments(prev => 
      prev.map(doc => 
        doc.id === activeDocumentId 
          ? { ...doc, content: newContent, updatedAt: new Date() }
          : doc
      )
    );
  }, [activeDocumentId]);
  
  const handleCursorChange = useCallback((position: number) => {
    setCursorPosition(position);
  }, []);
  
  const handleSelectionChange = useCallback((start: number, end: number) => {
    setSelectionStart(start);
    setSelectionEnd(end);
  }, []);
  
  const handleFocusChange = useCallback((focused: boolean) => {
    setIsFocused(focused);
  }, []);
  
  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size);
  }, []);
  
  const handleToggleLineNumbers = useCallback(() => {
    setShowLineNumbers(prev => !prev);
  }, []);
  
  const handleToggleSplitView = useCallback(() => {
    setIsSplitView(prev => !prev);
  }, []);
  
  // Document handlers
  const createNewDocument = useCallback(() => {
    const newDocument: LaTeXDocument = {
      id: Date.now().toString(),
      title: `Untitled Document ${documents.length + 1}`,
      content: `\\documentclass{article}
\\usepackage{amsmath}

\\begin{document}

\\end{document}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    setDocuments(prev => [...prev, newDocument]);
    setActiveDocumentId(newDocument.id);
  }, [documents.length]);
  
  const switchDocument = useCallback((documentId: string) => {
    setActiveDocumentId(documentId);
  }, []);
  
  const updateDocumentTitle = useCallback((title: string) => {
    setDocuments(prev => 
      prev.map(doc => 
        doc.id === activeDocumentId 
          ? { ...doc, title, updatedAt: new Date() }
          : doc
      )
    );
  }, [activeDocumentId]);
  
  const saveDocument = useCallback(async () => {
    // In a real implementation, this would call the file service
    console.log('Saving document:', activeDocument);
  }, [activeDocument]);
  
  // Preview handlers
  const refreshPreview = useCallback(() => {
    updatePreview();
  }, [updatePreview]);
  
  // Utility functions
  const insertText = useCallback((text: string, replaceSelection: boolean = false) => {
    if (replaceSelection && selectionStart !== selectionEnd) {
      const newContent = content.slice(0, selectionStart) + text + content.slice(selectionEnd);
      handleContentChange(newContent);
      setCursorPosition(selectionStart + text.length);
      setSelectionStart(selectionStart + text.length);
      setSelectionEnd(selectionStart + text.length);
    } else {
      const newContent = content.slice(0, cursorPosition) + text + content.slice(cursorPosition);
      handleContentChange(newContent);
      setCursorPosition(cursorPosition + text.length);
    }
  }, [content, cursorPosition, selectionStart, selectionEnd, handleContentChange]);
  
  const insertCommand = useCallback((command: string) => {
    insertText(command);
  }, [insertText]);
  
  const insertEnvironment = useCallback((environment: string) => {
    const envTemplate = `\\begin{${environment}}

\\end{${environment}}`;
    insertText(envTemplate);
  }, [insertText]);
  
  const wrapSelection = useCallback((prefix: string, suffix: string) => {
    if (selectionStart !== selectionEnd) {
      const selectedText = content.slice(selectionStart, selectionEnd);
      const newContent = content.slice(0, selectionStart) + prefix + selectedText + suffix + content.slice(selectionEnd);
      handleContentChange(newContent);
      setCursorPosition(selectionEnd + suffix.length);
      setSelectionStart(selectionStart + prefix.length);
      setSelectionEnd(selectionEnd + suffix.length);
    }
  }, [content, selectionStart, selectionEnd, handleContentChange]);
  
  return {
    // Editor state
    content,
    cursorPosition,
    selectionStart,
    selectionEnd,
    isFocused,
    fontSize,
    showLineNumbers,
    isSplitView,
    
    // Preview state
    previewContent,
    isPreviewLoading,
    previewError,
    renderTime,
    
    // Document state
    document: activeDocument,
    documents,
    activeDocumentId,
    
    // Statistics
    stats,
    
    // Validation
    validation,
    
    // Syntax highlighting
    tokens,
    
    // Editor handlers
    handleContentChange,
    handleCursorChange,
    handleSelectionChange,
    handleFocusChange,
    handleFontSizeChange,
    handleToggleLineNumbers,
    handleToggleSplitView,
    
    // Document handlers
    createNewDocument,
    switchDocument,
    updateDocumentTitle,
    saveDocument,
    
    // Preview handlers
    refreshPreview,
    
    // Utility functions
    insertText,
    insertCommand,
    insertEnvironment,
    wrapSelection,
  };
}

// Debounce utility
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): { (...args: Parameters<T>): void; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, wait);
  };
  
  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  
  return Object.assign(debounced, { cancel });
}
