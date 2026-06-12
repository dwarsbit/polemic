/**
 * Export Service
 * 
 * This module handles exporting LaTeX documents to various formats
 * including PDF, PNG, and other formats.
 */

import { ExportOptions } from '../types';

// Type for the electron API
interface ElectronAPI {
  exportPDF: (latexContent: string) => Promise<{ success: boolean; path?: string }>;
  exportPNG: (latexContent: string) => Promise<{ success: boolean; path?: string }>;
  saveFile: (content: string) => Promise<{ success: boolean; path?: string }>;
}

// Get the electron API from the window object
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

const electronAPI = window.electronAPI;

export interface ExportResult {
  success: boolean;
  path?: string;
  error?: string;
  data?: Blob | string;
}

/**
 * Export LaTeX content to PDF
 */
export async function exportToPDF(latexContent: string, options: ExportOptions = { format: 'pdf' }): Promise<ExportResult> {
  try {
    if (!electronAPI) {
      throw new Error('Electron API not available');
    }
    
    const result = await electronAPI.exportPDF(latexContent);
    
    if (result.success && result.path) {
      return {
        success: true,
        path: result.path,
      };
    }
    
    return {
      success: false,
      error: 'Failed to export PDF',
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
 * Export LaTeX content to PNG
 */
export async function exportToPNG(latexContent: string, options: ExportOptions = { format: 'png' }): Promise<ExportResult> {
  try {
    if (!electronAPI) {
      throw new Error('Electron API not available');
    }
    
    const result = await electronAPI.exportPNG(latexContent);
    
    if (result.success && result.path) {
      return {
        success: true,
        path: result.path,
      };
    }
    
    return {
      success: false,
      error: 'Failed to export PNG',
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
 * Export LaTeX content to SVG
 */
export async function exportToSVG(latexContent: string, options: ExportOptions = { format: 'svg' }): Promise<ExportResult> {
  try {
    // For SVG export, we'll use the browser's rendering capabilities
    // This is a placeholder for actual implementation
    
    // In a real implementation, we would:
    // 1. Render the LaTeX to HTML using KaTeX
    // 2. Convert the HTML to SVG using a library like svgdom or manually
    // 3. Return the SVG content
    
    return {
      success: false,
      error: 'SVG export not yet implemented',
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
 * Export LaTeX content to plain text
 */
export function exportToText(latexContent: string): ExportResult {
  try {
    // Remove LaTeX commands and environments
    let text = latexContent;
    
    // Remove LaTeX commands
    text = text.replace(/\\\\[a-zA-Z]+/g, '');
    
    // Remove environments
    text = text.replace(/\\\\begin\\{[^}]+\\}[\s\S]*?\\\\end\\{[^}]+\\}/g, '');
    
    // Remove math mode
    text = text.replace(/\$\$[\s\S]*?\$\$/g, '');
    text = text.replace(/\$[^$]*\$/g, '');
    
    // Clean up multiple spaces and newlines
    text = text.replace(/\s+/g, ' ').trim();
    
    return {
      success: true,
      data: text,
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
 * Export LaTeX content to HTML
 */
export function exportToHTML(latexContent: string): ExportResult {
  try {
    // In a real implementation, we would render the LaTeX to HTML
    // using KaTeX and other rendering libraries
    
    // For now, return a simple HTML wrapper
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>LaTeX Export</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css">
</head>
<body>
  <pre>${escapeHtml(latexContent)}</pre>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.js"></script>
</body>
</html>`;
    
    return {
      success: true,
      data: html,
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
 * Save LaTeX content to a .tex file
 */
export async function saveToFile(latexContent: string, fileName?: string): Promise<ExportResult> {
  try {
    if (!electronAPI) {
      throw new Error('Electron API not available');
    }
    
    const result = await electronAPI.saveFile(latexContent);
    
    if (result.success && result.path) {
      return {
        success: true,
        path: result.path,
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
 * Export to multiple formats
 */
export async function exportToMultipleFormats(
  latexContent: string,
  formats: ExportOptions['format'][]
): Promise<Record<string, ExportResult>> {
  const results: Record<string, ExportResult> = {};
  
  for (const format of formats) {
    switch (format) {
      case 'pdf':
        results.pdf = await exportToPDF(latexContent, { format });
        break;
      case 'png':
        results.png = await exportToPNG(latexContent, { format });
        break;
      case 'svg':
        results.svg = await exportToSVG(latexContent, { format });
        break;
    }
  }
  
  return results;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Get supported export formats
 */
export function getSupportedFormats(): ExportOptions['format'][] {
  return ['pdf', 'png', 'svg'];
}

/**
 * Check if a format is supported
 */
export function isFormatSupported(format: string): boolean {
  return getSupportedFormats().includes(format as ExportOptions['format']);
}
