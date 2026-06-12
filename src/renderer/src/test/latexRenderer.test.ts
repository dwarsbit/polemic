/**
 * LaTeX Renderer Tests
 * 
 * Tests for the LaTeX rendering functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderLaTeX, extractMathExpressions, replaceMathExpressions } from '../utils/latexRenderer';

// Mock KaTeX
global.katex = {
  renderToString: vi.fn((math: string, options?: any) => `<span>${math}</span>`),
  version: '0.16.10',
  renderMathInElement: vi.fn(),
};

describe('LaTeX Renderer', () => {
  describe('renderLaTeX', () => {
    it('should render inline math', () => {
      const result = renderLaTeX('$E = mc^2$');
      
      expect(result.html).toContain('<span class="katex">');
      expect(result.error).toBeUndefined();
      expect(result.renderTime).toBeGreaterThan(0);
    });
    
    it('should render display math', () => {
      const result = renderLaTeX('$$\\int x dx$$');
      
      expect(result.html).toContain('<div class="katex-display">');
      expect(result.error).toBeUndefined();
    });
    
    it('should handle errors', () => {
      // Mock KaTeX to throw an error
      global.katex.renderToString = vi.fn(() => {
        throw new Error('Invalid LaTeX');
      });
      
      const result = renderLaTeX('$\\invalid$');
      
      expect(result.error).toBe('Invalid LaTeX');
      expect(result.html).toContain('katex-error');
    });
  });
  
  describe('extractMathExpressions', () => {
    it('should extract inline math expressions', () => {
      const text = 'Inline math: $E = mc^2$ and more text';
      const result = extractMathExpressions(text);
      
      expect(result.expressions).toHaveLength(1);
      expect(result.expressions[0]).toBe('$E = mc^2$');
      expect(result.positions[0]).toEqual([13, 24]);
    });
    
    it('should extract display math expressions', () => {
      const text = 'Display math: $$\\int x dx$$ and more text';
      const result = extractMathExpressions(text);
      
      expect(result.expressions).toHaveLength(1);
      expect(result.expressions[0]).toBe('$$\\int x dx$$');
      expect(result.positions[0]).toEqual([14, 28]);
    });
    
    it('should extract multiple math expressions', () => {
      const text = '$a$ and $b$ and $$c$$';
      const result = extractMathExpressions(text);
      
      expect(result.expressions).toHaveLength(3);
      expect(result.expressions[0]).toBe('$a$');
      expect(result.expressions[1]).toBe('$b$');
      expect(result.expressions[2]).toBe('$$c$$');
    });
    
    it('should handle nested dollar signs', () => {
      const text = 'Price: $100.00';
      const result = extractMathExpressions(text);
      
      // This should not match as math because it's not a valid math expression
      expect(result.expressions).toHaveLength(0);
    });
  });
  
  describe('replaceMathExpressions', () => {
    it('should replace math expressions with rendered HTML', () => {
      const text = 'Math: $E = mc^2$';
      const result = replaceMathExpressions(text);
      
      expect(result).toContain('<span class="katex">');
      expect(result).not.toContain('$E = mc^2$');
    });
    
    it('should handle multiple expressions', () => {
      const text = '$a$ and $b$';
      const result = replaceMathExpressions(text);
      
      expect(result).toContain('<span class="katex">');
      expect(result).not.toContain('$a$');
      expect(result).not.toContain('$b$');
    });
  });
});
