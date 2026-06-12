/**
 * useTheme Hook
 * 
 * Custom hook for managing dark/light theme switching.
 */

import { useState, useEffect } from 'react';
import { Theme } from '../types';

// Define available themes
const THEMES: Record<string, Theme> = {
  light: {
    id: 'light',
    name: 'Light',
    isDark: false,
    colors: {
      background: '#ffffff',
      text: '#1f2937',
      primary: '#3b82f6',
      secondary: '#6b7280',
      accent: '#10b981',
      border: '#e5e7eb',
      editorBackground: '#ffffff',
      editorText: '#1f2937',
      lineNumbers: '#9ca3af',
      selection: '#3b82f6',
    },
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    isDark: true,
    colors: {
      background: '#111827',
      text: '#f9fafb',
      primary: '#60a5fa',
      secondary: '#9ca3af',
      accent: '#34d399',
      border: '#374151',
      editorBackground: '#1f2937',
      editorText: '#f3f4f6',
      lineNumbers: '#6b7280',
      selection: '#3b82f6',
    },
  },
  dracula: {
    id: 'dracula',
    name: 'Dracula',
    isDark: true,
    colors: {
      background: '#282a36',
      text: '#f8f8f2',
      primary: '#bd93f9',
      secondary: '#6272a4',
      accent: '#8be9fd',
      border: '#44475a',
      editorBackground: '#282a36',
      editorText: '#f8f8f2',
      lineNumbers: '#6272a4',
      selection: '#44475a',
    },
  },
  solarized: {
    id: 'solarized',
    name: 'Solarized Light',
    isDark: false,
    colors: {
      background: '#fdf6e3',
      text: '#657b83',
      primary: '#268bd2',
      secondary: '#859900',
      accent: '#b58900',
      border: '#93a1a1',
      editorBackground: '#fdf6e3',
      editorText: '#657b83',
      lineNumbers: '#93a1a1',
      selection: '#268bd2',
    },
  },
  'solarized-dark': {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    isDark: true,
    colors: {
      background: '#002b36',
      text: '#839496',
      primary: '#268bd2',
      secondary: '#b58900',
      accent: '#cb4b16',
      border: '#073642',
      editorBackground: '#002b36',
      editorText: '#839496',
      lineNumbers: '#586e75',
      selection: '#268bd2',
    },
  },
};

// Storage key for theme preference
const THEME_STORAGE_KEY = 'polemic-theme';

export interface ThemeContextType {
  theme: Theme;
  themes: Theme[];
  isDarkMode: boolean;
  toggleTheme: () => void;
  setTheme: (themeId: string) => void;
  getThemeColor: (colorKey: keyof Theme['colors']) => string;
}

export function useTheme(): ThemeContextType {
  // Get initial theme from localStorage or default to system preference
  const [themeId, setThemeId] = useState<string>(() => {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme && THEMES[savedTheme]) {
      return savedTheme;
    }
    
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    
    return 'light';
  });
  
  const theme = THEMES[themeId] || THEMES.light;
  const themes = Object.values(THEMES);
  const isDarkMode = theme.isDark;
  
  // Apply theme to document
  useEffect(() => {
    const root = window.document.documentElement;
    
    // Remove all theme classes
    root.classList.remove('light', 'dark', 'dracula', 'solarized', 'solarized-dark');
    
    // Add current theme class
    root.classList.add(themeId);
    
    // Set CSS variables for theme colors
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--theme-${key}`, value);
    });
    
    // Save theme preference
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  }, [themeId, theme.colors]);
  
  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem(THEME_STORAGE_KEY)) {
        setThemeId(e.matches ? 'dark' : 'light');
      }
    };
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
  
  const toggleTheme = () => {
    const currentIndex = themes.findIndex(t => t.id === themeId);
    const nextIndex = (currentIndex + 1) % themes.length;
    setThemeId(themes[nextIndex].id);
  };
  
  const setTheme = (newThemeId: string) => {
    if (THEMES[newThemeId]) {
      setThemeId(newThemeId);
    }
  };
  
  const getThemeColor = (colorKey: keyof Theme['colors']) => {
    return theme.colors[colorKey];
  };
  
  return {
    theme,
    themes,
    isDarkMode,
    toggleTheme,
    setTheme,
    getThemeColor,
  };
}

export function getThemeById(themeId: string): Theme | undefined {
  return THEMES[themeId];
}

export function getAllThemes(): Theme[] {
  return Object.values(THEMES);
}
