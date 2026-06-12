/**
 * LaTeX Parser and Syntax Highlighter
 * 
 * This module provides functions to parse and tokenize LaTeX content
 * for syntax highlighting and analysis.
 */

import { LaTeXToken, LaTeXSyntaxTree } from '../types';

// Common LaTeX commands
const LATEX_COMMANDS = [
  // Document structure
  '\\documentclass', '\\usepackage', '\\begin', '\\end',
  '\\title', '\\author', '\\date', '\\maketitle',
  '\\tableofcontents', '\\newpage', '\\clearpage',
  
  // Text formatting
  '\\textbf', '\\textit', '\\underline', '\\emph',
  '\\textsf', '\\texttt', '\\textsc', '\\textsl',
  '\\large', '\\Large', '\\LARGE', '\\huge', '\\Huge',
  '\\small', '\\footnotesize', '\\scriptsize', '\\tiny',
  
  // Lists
  '\\item', '\\enumerate', '\\itemize', '\\description',
  
  // Math mode
  '\\frac', '\\sqrt', '\\sum', '\\prod', '\\int',
  '\\lim', '\\limsup', '\\liminf', '\\log', '\\ln',
  '\\sin', '\\cos', '\\tan', '\\cot', '\\sec', '\\csc',
  '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon',
  '\\zeta', '\\eta', '\\theta', '\\iota', '\\kappa',
  '\\lambda', '\\mu', '\\nu', '\\xi', '\\omicron',
  '\\pi', '\\rho', '\\sigma', '\\tau', '\\upsilon',
  '\\phi', '\\chi', '\\psi', '\\omega',
  
  // Tables
  '\\tabular', '\\hline', '\\cline', '\\multicolumn',
  '\\multirow', '\\hline',
  
  // Figures
  '\\includegraphics', '\\caption', '\\label', '\\ref',
  '\\cite', '\\bibliography', '\\bibliographystyle',
  
  // Special
  '\\newcommand', '\\renewcommand', '\\newenvironment',
  '\\setlength', '\\addtolength', '\\newlength',
];

// Common LaTeX environments
const LATEX_ENVIRONMENTS = [
  'document', 'figure', 'table', 'tabular', 'enumerate',
  'itemize', 'description', 'center', 'flushleft', 'flushright',
  'quote', 'quotation', 'verse', 'equation', 'align',
  'gather', 'multline', 'eqnarray', 'theorem', 'proof',
  'minipage', 'picture', 'array', 'cases', 'matrix',
];

/**
 * Tokenize LaTeX content into tokens for syntax highlighting
 */
export function tokenizeLaTeX(content: string): LaTeXToken[] {
  const tokens: LaTeXToken[] = [];
  let position = 0;
  
  while (position < content.length) {
    // Skip whitespace
    if (/\s/.test(content[position])) {
      position++;
      continue;
    }
    
    // Check for comments
    if (content[position] === '%') {
      const start = position;
      while (position < content.length && content[position] !== '\n') {
        position++;
      }
      tokens.push({
        type: 'comment',
        value: content.slice(start, position),
        start,
        end: position,
      });
      continue;
    }
    
    // Check for math mode ($...$ or $$...$$)
    if (content[position] === '$') {
      const start = position;
      const isDisplay = content[position + 1] === '$';
      
      if (isDisplay) {
        position += 2; // Skip $$
        while (position < content.length - 1 && !(content[position] === '$' && content[position + 1] === '$')) {
          position++;
        }
        if (position < content.length) {
          position += 2; // Skip closing $$
        }
      } else {
        position++; // Skip $
        while (position < content.length && content[position] !== '$') {
          position++;
        }
        if (position < content.length) {
          position++; // Skip closing $
        }
      }
      
      tokens.push({
        type: 'math',
        value: content.slice(start, position),
        start,
        end: position,
      });
      continue;
    }
    
    // Check for LaTeX commands (\...)
    if (content[position] === '\\' && position < content.length - 1) {
      const start = position;
      let end = position + 1;
      
      // Find the end of the command
      while (end < content.length && /[a-zA-Z]/.test(content[end])) {
        end++;
      }
      
      // Check if it's a known command
      const command = content.slice(start, end);
      const isCommand = LATEX_COMMANDS.includes(command);
      
      // Handle commands with arguments
      if (isCommand) {
        // Skip optional arguments [...
        if (end < content.length && content[end] === '[') {
          let bracketDepth = 1;
          end++;
          while (end < content.length && bracketDepth > 0) {
            if (content[end] === '[') bracketDepth++;
            else if (content[end] === ']') bracketDepth--;
            end++;
          }
        }
        
        // Skip required arguments {...}
        if (end < content.length && content[end] === '{') {
          let braceDepth = 1;
          end++;
          while (end < content.length && braceDepth > 0) {
            if (content[end] === '{') braceDepth++;
            else if (content[end] === '}') braceDepth--;
            end++;
          }
        }
      }
      
      tokens.push({
        type: 'command',
        value: content.slice(start, end),
        start,
        end,
      });
      position = end;
      continue;
    }
    
    // Check for environments (\begin{...}...\end{...})
    if (content.slice(position, position + 6) === '\\begin') {
      const start = position;
      let end = position + 6;
      
      // Skip whitespace
      while (end < content.length && /\s/.test(content[end])) {
        end++;
      }
      
      // Skip {
      if (end < content.length && content[end] === '{') {
        end++;
      }
      
      // Find environment name
      let envStart = end;
      while (end < content.length && /[a-zA-Z]/.test(content[end])) {
        end++;
      }
      
      const envName = content.slice(envStart, end);
      
      // Skip closing }
      if (end < content.length && content[end] === '}') {
        end++;
      }
      
      // Find matching \end{...}
      let envEnd = end;
      const searchEnd = `\\end{${envName}}`;
      const endIndex = content.indexOf(searchEnd, envEnd);
      
      if (endIndex !== -1) {
        envEnd = endIndex + searchEnd.length;
      } else {
        envEnd = content.length;
      }
      
      tokens.push({
        type: 'environment',
        value: content.slice(start, envEnd),
        start,
        end: envEnd,
      });
      
      position = envEnd;
      continue;
    }
    
    // Check for strings (text in quotes)
    if (content[position] === '"' || content[position] === "'") {
      const quote = content[position];
      const start = position;
      position++;
      
      while (position < content.length && content[position] !== quote) {
        if (content[position] === '\\') {
          position++; // Skip escaped quote
        }
        position++;
      }
      
      if (position < content.length) {
        position++; // Skip closing quote
      }
      
      tokens.push({
        type: 'string',
        value: content.slice(start, position),
        start,
        end: position,
      });
      continue;
    }
    
    // Default: text
    const start = position;
    while (position < content.length && !/\s|\%|\$|\\|\{|\}/.test(content[position])) {
      position++;
    }
    
    if (position > start) {
      tokens.push({
        type: 'text',
        value: content.slice(start, position),
        start,
        end: position,
      });
    }
  }
  
  return tokens;
}

/**
 * Parse LaTeX content into a syntax tree
 */
export function parseLaTeX(content: string): LaTeXSyntaxTree {
  const tokens = tokenizeLaTeX(content);
  const environments: { name: string; start: number; end: number; children: LaTeXSyntaxTree }[] = [];
  
  // Find environments
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    
    if (token.type === 'environment') {
      // Extract environment name from \begin{...}
      const beginMatch = token.value.match(/\\begin\{([^}]+)\}/);
      if (beginMatch) {
        const envName = beginMatch[1];
        const start = token.start;
        const end = token.end;
        
        // Find the content between \begin and \end
        const contentStart = token.value.indexOf('}') + 1;
        const contentEnd = token.value.lastIndexOf('\\end');
        const innerContent = token.value.slice(contentStart, contentEnd);
        
        // Parse inner content
        const children = parseLaTeX(innerContent);
        
        environments.push({
          name: envName,
          start,
          end,
          children,
        });
      }
    }
    
    i++;
  }
  
  return {
    tokens,
    environments,
  };
}

/**
 * Extract all commands from LaTeX content
 */
export function extractCommands(content: string): string[] {
  const commandRegex = /\\\\([a-zA-Z]+)/g;
  const commands: Set<string> = new Set();
  
  let match;
  while ((match = commandRegex.exec(content)) !== null) {
    commands.add(match[1]);
  }
  
  return Array.from(commands);
}

/**
 * Extract all environments from LaTeX content
 */
export function extractEnvironments(content: string): string[] {
  const envRegex = /\\begin\{([^}]+)\}/g;
  const environments: Set<string> = new Set();
  
  let match;
  while ((match = envRegex.exec(content)) !== null) {
    environments.add(match[1]);
  }
  
  return Array.from(environments);
}

/**
 * Validate LaTeX content for basic syntax errors
 */
export function validateLaTeX(content: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check for unclosed environments
  const beginRegex = /\\begin\{([^}]+)\}/g;
  const endRegex = /\\end\{([^}]+)\}/g;
  
  const begins: string[] = [];
  const ends: string[] = [];
  
  let match;
  while ((match = beginRegex.exec(content)) !== null) {
    begins.push(match[1]);
  }
  
  while ((match = endRegex.exec(content)) !== null) {
    ends.push(match[1]);
  }
  
  // Check if all begins have matching ends
  begins.forEach((env, index) => {
    if (index >= ends.length || ends[index] !== env) {
      errors.push(`Unclosed environment: ${env}`);
    }
  });
  
  // Check for unclosed math mode
  const dollarCount = (content.match(/\$/g) || []).length;
  if (dollarCount % 2 !== 0) {
    errors.push('Unclosed math mode ($)');
  }
  
  // Check for unclosed braces
  let braceDepth = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') braceDepth++;
    else if (content[i] === '}') braceDepth--;
    
    if (braceDepth < 0) {
      errors.push('Unmatched closing brace');
      break;
    }
  }
  
  if (braceDepth > 0) {
    errors.push('Unclosed brace');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Count words and characters in LaTeX content
 */
export function countStats(content: string): { words: number; characters: number; lines: number } {
  // Remove LaTeX commands for word counting
  const cleanContent = content.replace(/\\\\[a-zA-Z]+/g, ' ');
  const words = cleanContent.trim().split(/\s+/).filter(word => word.length > 0).length;
  const characters = content.length;
  const lines = content.split('\n').length;
  
  return { words, characters, lines };
}
