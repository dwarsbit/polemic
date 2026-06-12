import { contextBridge, ipcRenderer } from 'electron';

export const api = {
  // File operations
  saveFile: (content: string) => ipcRenderer.invoke('save-file', content),
  openFile: () => ipcRenderer.invoke('open-file'),
  
  // Export operations
  exportPDF: (latexContent: string) => ipcRenderer.invoke('export-pdf', latexContent),
  exportPNG: (latexContent: string) => ipcRenderer.invoke('export-png', latexContent),
  
  // Theme operations
  onThemeChange: (callback: (theme: string) => void) => {
    ipcRenderer.on('theme-change', (event, theme) => callback(theme));
  },
  
  // Window operations
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  close: () => ipcRenderer.send('close-window'),
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
