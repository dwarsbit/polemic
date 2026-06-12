/**
 * Test Setup
 * 
 * This file sets up the test environment for Vitest.
 */

import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Clean up after each test
afterEach(() => {
  cleanup();
});

// Mock window.electronAPI for tests
beforeEach(() => {
  global.window = {
    ...global.window,
    electronAPI: {
      saveFile: vi.fn().mockResolvedValue({ success: true, path: '/test.tex' }),
      openFile: vi.fn().mockResolvedValue({ success: true, content: '\\documentclass{article}\n\\begin{document}\n\\end{document}', path: '/test.tex' }),
      exportPDF: vi.fn().mockResolvedValue({ success: true, path: '/test.pdf' }),
      exportPNG: vi.fn().mockResolvedValue({ success: true, path: '/test.png' }),
      onThemeChange: vi.fn(),
      minimize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
    },
  };
});

// Mock matchMedia
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

// Global test timeout
vi.setConfig({ test: { globals: true, environment: 'jsdom', setupFiles: ['./setup.ts'] } });
