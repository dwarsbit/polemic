// Main application types
export interface LaTeXDocument {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  filePath?: string;
}

export interface EditorState {
  content: string;
  cursorPosition: number;
  selectionStart: number;
  selectionEnd: number;
  isFocused: boolean;
}

export interface PreviewState {
  content: string;
  isLoading: boolean;
  error?: string;
  renderTime: number;
}

export interface ExportOptions {
  format: 'pdf' | 'png' | 'svg';
  quality?: number;
  scale?: number;
  pageSize?: string;
}

export interface ToolbarCommand {
  id: string;
  label: string;
  icon: React.ReactNode;
  command: string;
  shortcut?: string;
  group?: string;
}

export interface Theme {
  id: string;
  name: string;
  isDark: boolean;
  colors: {
    background: string;
    text: string;
    primary: string;
    secondary: string;
    accent: string;
    border: string;
    editorBackground: string;
    editorText: string;
    lineNumbers: string;
    selection: string;
  };
}

export interface AppState {
  documents: LaTeXDocument[];
  activeDocumentId: string;
  theme: Theme;
  editorState: EditorState;
  previewState: PreviewState;
  isSplitView: boolean;
  showLineNumbers: boolean;
  fontSize: number;
}

export type ActionType =
  | 'SET_CONTENT'
  | 'SET_CURSOR_POSITION'
  | 'SET_SELECTION'
  | 'SET_FOCUS'
  | 'SET_PREVIEW_CONTENT'
  | 'SET_PREVIEW_LOADING'
  | 'SET_PREVIEW_ERROR'
  | 'SET_THEME'
  | 'TOGGLE_SPLIT_VIEW'
  | 'TOGGLE_LINE_NUMBERS'
  | 'SET_FONT_SIZE'
  | 'NEW_DOCUMENT'
  | 'SWITCH_DOCUMENT'
  | 'SAVE_DOCUMENT'
  | 'OPEN_DOCUMENT';

export interface Action {
  type: ActionType;
  payload?: any;
}

// Electron API types
export interface ElectronAPI {
  saveFile: (content: string) => Promise<{ success: boolean; path?: string }>;
  openFile: () => Promise<{ success: boolean; content?: string; path?: string }>;
  exportPDF: (latexContent: string) => Promise<{ success: boolean; path?: string }>;
  exportPNG: (latexContent: string) => Promise<{ success: boolean; path?: string }>;
  onThemeChange: (callback: (theme: string) => void) => void;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// LaTeX syntax types
export interface LaTeXToken {
  type: 'command' | 'environment' | 'math' | 'comment' | 'string' | 'text';
  value: string;
  start: number;
  end: number;
}

export interface LaTeXSyntaxTree {
  tokens: LaTeXToken[];
  environments: {
    name: string;
    start: number;
    end: number;
    children: LaTeXSyntaxTree;
  }[];
}
