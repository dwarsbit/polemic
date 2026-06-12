/**
 * LaTeX Parser Tests
 * 
 * Tests for the LaTeX parsing and tokenization functionality.
 */

import { describe, it, expect } from 'vitest';
import { tokenizeLaTeX, parseLaTeX, validateLaTeX, countStats, extractCommands, extractEnvironments } from '../utils/latexParser';

describe('LaTeX Parser', () => {
  describe('tokenizeLaTeX', () => {
    it('should tokenize basic LaTeX commands', () => {
      const content = '\\documentclass{article}\n\\begin{document}\nHello World\n\\end{document}';
      const tokens = tokenizeLaTeX(content);
      
      expect(tokens.length).toBeGreaterThan(0);
      expect(tokens.some(t => t.type === 'command')).toBe(true);
      expect(tokens.some(t => t.type === 'environment')).toBe(true);
    });
    
    it('should tokenize math mode', () => {
      const content = 'Inline: $E = mc^2$ and display: $$\\int x dx$$';
      const tokens = tokenizeLaTeX(content);
      
      const mathTokens = tokens.filter(t => t.type === 'math');
      expect(mathTokens.length).toBe(2);
      expect(mathTokens[0].value).toBe('$E = mc^2$');
      expect(mathTokens[1].value).toBe('$$\\int x dx$$');
    });
    
    it('should tokenize comments', () => {
      const content = '% This is a comment\n\\documentclass{article}';
      const tokens = tokenizeLaTeX(content);
      
      const commentTokens = tokens.filter(t => t.type === 'comment');
      expect(commentTokens.length).toBe(1);
      expect(commentTokens[0].value).toBe('% This is a comment');
    });
    
    it('should handle empty content', () => {
      const tokens = tokenizeLaTeX('');
      expect(tokens.length).toBe(0);
    });
    
    it('should handle whitespace', () => {
      const content = '   \n\n  \t  ';
      const tokens = tokenizeLaTeX(content);
      expect(tokens.length).toBe(0);
    });
  });
  
  describe('parseLaTeX', () => {
    it('should parse LaTeX into syntax tree', () => {
      const content = '\\begin{document}\n\\section{Introduction}\nHello\n\\end{document}';
      const tree = parseLaTeX(content);
      
      expect(tree.tokens.length).toBeGreaterThan(0);
      expect(tree.environments.length).toBeGreaterThan(0);
    });
    
    it('should find nested environments', () => {
      const content = '\\begin{document}\n\\begin{center}\nText\n\\end{center}\n\\end{document}';
      const tree = parseLaTeX(content);
      
      expect(tree.environments.length).toBeGreaterThan(0);
      const documentEnv = tree.environments.find(e => e.name === 'document');
      expect(documentEnv).toBeDefined();
      expect(documentEnv?.children.environments.length).toBeGreaterThan(0);
    });
  });
  
  describe('validateLaTeX', () => {
    it('should validate correct LaTeX', () => {
      const content = '\\begin{document}\nContent\n\\end{document}';
      const result = validateLaTeX(content);
      
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });
    
    it('should detect unclosed environments', () => {
      const content = '\\begin{document}\nContent';
      const result = validateLaTeX(content);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
    
    it('should detect unclosed math mode', () => {
      const content = 'Math: $E = mc^2';
      const result = validateLaTeX(content);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('math mode'))).toBe(true);
    });
    
    it('should detect unclosed braces', () => {
      const content = '\\documentclass{article';
      const result = validateLaTeX(content);
      
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('brace'))).toBe(true);
    });
  });
  
  describe('countStats', () => {
    it('should count words correctly', () => {
      const content = 'Hello World';
      const stats = countStats(content);
      
      expect(stats.words).toBe(2);
      expect(stats.characters).toBe(11);
      expect(stats.lines).toBe(1);
    });
    
    it('should count lines correctly', () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const stats = countStats(content);
      
      expect(stats.lines).toBe(3);
    });
    
    it('should handle LaTeX commands in word count', () => {
      const content = '\\textbf{Hello} \\textit{World}';
      const stats = countStats(content);
      
      // Commands are replaced with spaces, so we should get 2 words
      expect(stats.words).toBe(2);
    });
  });
  
  describe('extractCommands', () => {
    it('should extract all commands', () => {
      const content = '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}';
      const commands = extractCommands(content);
      
      expect(commands).toContain('documentclass');
      expect(commands).toContain('usepackage');
      expect(commands).toContain('begin');
    });
    
    it('should return unique commands', () => {
      const content = '\\textbf{Hello} \\textbf{World}';
      const commands = extractCommands(content);
      
      expect(commands).toHaveLength(1);
      expect(commands[0]).toBe('textbf');
    });
  });
  
  describe('extractEnvironments', () => {
    it('should extract all environments', () => {
      const content = '\\begin{document}\n\\begin{center}\nContent\n\\end{center}\n\\end{document}';
      const environments = extractEnvironments(content);
      
      expect(environments).toContain('document');
      expect(environments).toContain('center');
    });
    
    it('should return unique environments', () => {
      const content = '\\begin{itemize}\n\\item A\n\\end{itemize}\n\\begin{itemize}\n\\item B\n\\end{itemize}';
      const environments = extractEnvironments(content);
      
      expect(environments).toHaveLength(1);
      expect(environments[0]).toBe('itemize');
    });
  });
});
