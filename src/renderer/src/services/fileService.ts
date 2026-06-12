/**
 * File Service
 * 
 * This module handles file operations for the LaTeX editor,
 * including opening, saving, and managing LaTeX documents.
 */

import { LaTeXDocument } from '../types';

// Type for the electron API
interface ElectronAPI {
  saveFile: (content: string) => Promise<{ success: boolean; path?: string }>;
  openFile: () => Promise<{ success: boolean; content?: string; path?: string }>;
}

// Get the electron API from the window object
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

const electronAPI = window.electronAPI;

export interface FileResult {
  success: boolean;
  content?: string;
  path?: string;
  error?: string;
}

export interface DocumentInfo {
  id: string;
  title: string;
  path?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Default LaTeX document template
 */
const DEFAULT_DOCUMENT = `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}

\\title{Untitled Document}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

This is a new LaTeX document. Start writing your content here.

\\section{Mathematics}

Here's an example of inline math: $E = mc^2$ and display math:

$$\\int_{a}^{b} x^2 \\,dx$$

\\end{document}`;

/**
 * Create a new LaTeX document
 */
export function createNewDocument(): LaTeXDocument {
  return {
    id: generateId(),
    title: 'Untitled Document',
    content: DEFAULT_DOCUMENT,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Open a LaTeX file
 */
export async function openFile(): Promise<FileResult> {
  try {
    if (!electronAPI) {
      throw new Error('Electron API not available');
    }
    
    const result = await electronAPI.openFile();
    
    if (result.success && result.content && result.path) {
      return {
        success: true,
        content: result.content,
        path: result.path,
      };
    }
    
    return {
      success: false,
      error: 'No file selected or failed to open file',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Save LaTeX content to a file
 */
export async function saveFile(content: string, filePath?: string): Promise<FileResult> {
  try {
    if (!electronAPI) {
      throw new Error('Electron API not available');
    }
    
    const result = await electronAPI.saveFile(content);
    
    if (result.success && result.path) {
      return {
        success: true,
        path: result.path,
        content,
      };
    }
    
    return {
      success: false,
      error: 'Failed to save file',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Save document with metadata
 */
export async function saveDocument(document: LaTeXDocument): Promise<FileResult> {
  // Add document metadata as comments at the top
  const contentWithMetadata = `%% Polemic Document Metadata
%% ID: ${document.id}
%% Title: ${document.title}
%% Created: ${document.createdAt.toISOString()}
%% Updated: ${document.updatedAt.toISOString()}
%% File: ${document.filePath || 'Untitled'}
%%

${document.content}`;
  
  return saveFile(contentWithMetadata, document.filePath);
}

/**
 * Parse document metadata from content
 */
export function parseDocumentMetadata(content: string): Partial<DocumentInfo> {
  const metadata: Partial<DocumentInfo> = {};
  
  // Look for metadata comments at the top
  const metadataMatch = content.match(/%% Polemic Document Metadata[\s\S]*?%%/);
  
  if (metadataMatch) {
    const metadataContent = metadataMatch[0];
    
    // Extract ID
    const idMatch = metadataContent.match(/%% ID: ([^\n]+)/);
    if (idMatch) metadata.id = idMatch[1];
    
    // Extract title
    const titleMatch = metadataContent.match(/%% Title: ([^\n]+)/);
    if (titleMatch) metadata.title = titleMatch[1];
    
    // Extract created date
    const createdMatch = metadataContent.match(/%% Created: ([^\n]+)/);
    if (createdMatch) {
      metadata.createdAt = new Date(createdMatch[1]);
    }
    
    // Extract updated date
    const updatedMatch = metadataContent.match(/%% Updated: ([^\n]+)/);
    if (updatedMatch) {
      metadata.updatedAt = new Date(updatedMatch[1]);
    }
    
    // Extract file path
    const fileMatch = metadataContent.match(/%% File: ([^\n]+)/);
    if (fileMatch) metadata.path = fileMatch[1];
  }
  
  return metadata;
}

/**
 * Extract title from LaTeX content
 */
export function extractTitleFromContent(content: string): string {
  // Look for \title{...}
  const titleMatch = content.match(/\\\\title\\{([^}]+)\\}/);
  if (titleMatch) {
    return titleMatch[1];
  }
  
  // Look for first section
  const sectionMatch = content.match(/\\\\section\\{([^}]+)\\}/);
  if (sectionMatch) {
    return sectionMatch[1];
  }
  
  // Return first non-empty line
  const lines = content.split('\\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('%') && !trimmed.startsWith('\\\\')) {
      return trimmed.length > 50 ? trimmed.substring(0, 50) + '...' : trimmed;
    }
  }
  
  return 'Untitled Document';
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

/**
 * Get file extension from path
 */
export function getFileExtension(path: string): string {
  const lastDot = path.lastIndexOf('.');
  const lastSlash = path.lastIndexOf('/');
  
  if (lastDot > lastSlash) {
    return path.slice(lastDot + 1);
  }
  
  return '';
}

/**
 * Get file name without extension
 */
export function getFileNameWithoutExtension(path: string): string {
  const baseName = path.split('/').pop() || '';
  const lastDot = baseName.lastIndexOf('.');
  
  if (lastDot > 0) {
    return baseName.slice(0, lastDot);
  }
  
  return baseName;
}

/**
 * Check if a file path is a LaTeX file
 */
export function isLaTeXFile(path: string): boolean {
  const extension = getFileExtension(path).toLowerCase();
  return ['tex', 'latex'].includes(extension);
}

/**
 * Get recent files (placeholder for actual implementation)
 */
export function getRecentFiles(): DocumentInfo[] {
  // In a real implementation, this would read from local storage
  // or a configuration file
  return [];
}

/**
 * Add a file to recent files
 */
export function addRecentFile(path: string, title: string): void {
  // In a real implementation, this would save to local storage
  // or a configuration file
  console.log(`Adding recent file: ${path} - ${title}`);
}
