/**
 * LaTeX Renderer
 * 
 * This module handles rendering LaTeX content to HTML using KaTeX
 * and provides real-time preview functionality.
 */

import katex from 'katex';

export interface RenderOptions {
  displayMode?: boolean;
  throwOnError?: boolean;
  errorColor?: string;
  macros?: Record<string, string>;
  colorIsTextColor?: boolean;
  maxSize?: number;
  maxExpand?: number;
  allowedProtocols?: string[];
}

export interface RenderResult {
  html: string;
  error?: string;
  renderTime: number;
}

const DEFAULT_OPTIONS: RenderOptions = {
  displayMode: false,
  throwOnError: false,
  errorColor: '#cc0000',
  macros: {},
  colorIsTextColor: true,
  maxSize: 1000,
  maxExpand: 1000,
  allowedProtocols: ['http', 'https', 'mailto', 'file'],
};

/**
 * Render LaTeX content to HTML using KaTeX
 */
export function renderLaTeX(content: string, options: RenderOptions = {}): RenderResult {
  const startTime = performance.now();
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
  
  try {
    // Handle display math mode ($$...$$)
    if (content.startsWith('$$') && content.endsWith('$$')) {
      const innerContent = content.slice(2, -2);
      const html = katex.renderToString(innerContent, {
        ...mergedOptions,
        displayMode: true,
      });
      
      return {
        html: `<div class="katex-display">${html}</div>`,
        renderTime: performance.now() - startTime,
      };
    }
    
    // Handle inline math mode ($...$)
    if (content.startsWith('$') && content.endsWith('$')) {
      const innerContent = content.slice(1, -1);
      const html = katex.renderToString(innerContent, mergedOptions);
      
      return {
        html: `<span class="katex">${html}</span>`,
        renderTime: performance.now() - startTime,
      };
    }
    
    // Handle regular LaTeX content
    const html = katex.renderToString(content, mergedOptions);
    
    return {
      html,
      renderTime: performance.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return {
      html: `<span class="katex-error" style="color: ${mergedOptions.errorColor}">${errorMessage}</span>`,
      error: errorMessage,
      renderTime: performance.now() - startTime,
    };
  }
}

/**
 * Render a complete LaTeX document
 */
export function renderLaTeXDocument(content: string): RenderResult {
  const startTime = performance.now();
  
  // Extract the document content (remove \documentclass, \begin{document}, \end{document})
  let documentContent = content;
  
  // Remove document class
  documentContent = documentContent.replace(/\\\\documentclass\[?[^\n]*\n/, '');
  
  // Remove begin and end document
  documentContent = documentContent.replace(/\\\\begin\\{document\\}[\s\S]*?\\\\end\\{document\\}/, (match) => {
    // Extract content between begin and end document
    const innerMatch = match.match(/\\\\begin\\{document\\}([\s\S]*?)\\\\end\\{document\\}/);
    return innerMatch ? innerMatch[1] : '';
  });
  
  // Split into blocks and render each
  const blocks = splitIntoBlocks(documentContent);
  const renderedBlocks = blocks.map(block => {
    if (isMathBlock(block)) {
      return renderLaTeX(block, { displayMode: block.startsWith('$$') });
    }
    return renderLaTeX(block);
  });
  
  const html = renderedBlocks.map(r => r.html).join('');
  const totalTime = performance.now() - startTime;
  const hasError = renderedBlocks.some(r => r.error);
  
  return {
    html: `<div class="latex-document">${html}</div>`,
    error: hasError ? 'One or more rendering errors occurred' : undefined,
    renderTime: totalTime,
  };
}

/**
 * Split LaTeX content into logical blocks for rendering
 */
function splitIntoBlocks(content: string): string[] {
  const blocks: string[] = [];
  let currentBlock = '';
  let inMathMode = false;
  let inDisplayMathMode = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];
    
    // Handle display math mode ($$...$$)
    if (char === '$' && nextChar === '$' && !inMathMode) {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = '';
      }
      inDisplayMathMode = true;
      currentBlock = '$$';
      i++; // Skip next $
      continue;
    }
    
    if (char === '$' && nextChar === '$' && inDisplayMathMode) {
      currentBlock += '$$';
      blocks.push(currentBlock);
      currentBlock = '';
      inDisplayMathMode = false;
      i++; // Skip next $
      continue;
    }
    
    // Handle inline math mode ($...$)
    if (char === '$' && !inDisplayMathMode && !inMathMode) {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = '';
      }
      inMathMode = true;
      currentBlock = '$';
      continue;
    }
    
    if (char === '$' && !inDisplayMathMode && inMathMode) {
      currentBlock += '$';
      blocks.push(currentBlock);
      currentBlock = '';
      inMathMode = false;
      continue;
    }
    
    // Handle newlines (split blocks on double newlines)
    if (char === '\n' && nextChar === '\n') {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = '';
      }
      blocks.push('\n\n');
      i++; // Skip next newline
      continue;
    }
    
    currentBlock += char;
  }
  
  if (currentBlock) {
    blocks.push(currentBlock);
  }
  
  return blocks;
}

/**
 * Check if a block is a math block
 */
function isMathBlock(block: string): boolean {
  return block.startsWith('$$') || block.startsWith('$');
}

/**
 * Extract math expressions from text
 */
export function extractMathExpressions(text: string): { expressions: string[]; positions: [number, number][] } {
  const expressions: string[] = [];
  const positions: [number, number][] = [];
  
  let i = 0;
  while (i < text.length) {
    // Check for display math ($$...$$)
    if (text[i] === '$' && text[i + 1] === '$') {
      const start = i;
      i += 2;
      const expressionStart = i;
      
      while (i < text.length - 1 && !(text[i] === '$' && text[i + 1] === '$')) {
        i++;
      }
      
      if (i < text.length) {
        const expression = text.slice(expressionStart, i);
        expressions.push(`$$${expression}$$`);
        positions.push([start, i + 2]);
        i += 2;
      }
    }
    // Check for inline math ($...$)
    else if (text[i] === '$') {
      const start = i;
      i++;
      const expressionStart = i;
      
      while (i < text.length && text[i] !== '$') {
        i++;
      }
      
      if (i < text.length) {
        const expression = text.slice(expressionStart, i);
        expressions.push(`$${expression}$`);
        positions.push([start, i + 1]);
        i++;
      }
    } else {
      i++;
    }
  }
  
  return { expressions, positions };
}

/**
 * Replace math expressions with rendered HTML
 */
export function replaceMathExpressions(text: string, options: RenderOptions = {}): string {
  const { expressions, positions } = extractMathExpressions(text);
  
  let result = text;
  let offset = 0;
  
  expressions.forEach((expression, index) => {
    const [start, end] = positions[index];
    const renderResult = renderLaTeX(expression, options);
    
    result = (
      result.slice(0, start + offset) +
      renderResult.html +
      result.slice(end + offset)
    );
    
    offset += renderResult.html.length - (end - start);
  });
  
  return result;
}

/**
 * Render LaTeX with custom macros
 */
export function renderWithMacros(content: string, macros: Record<string, string>): RenderResult {
  return renderLaTeX(content, {
    macros,
    displayMode: false,
    throwOnError: false,
  });
}

/**
 * Check if KaTeX is supported in the current environment
 */
export function isKaTeXSupported(): boolean {
  return typeof katex !== 'undefined' && typeof katex.renderToString === 'function';
}

/**
 * Get KaTeX version
 */
export function getKaTeXVersion(): string {
  return katex.version || 'unknown';
}
