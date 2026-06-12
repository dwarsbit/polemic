import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { enable } from '@electron/remote/main';
import { v4 as uuidv4 } from 'uuid';

// Enable remote module for renderer process
enable(webPreferences);

const webPreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  enableRemoteModule: true,
  preload: path.join(__dirname, 'preload.js'),
};

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Polemic - LaTeX Editor',
    webPreferences: {
      ...webPreferences,
      webSecurity: false, // Allow loading local resources
    },
  });

  // Load the renderer in development, production build in production
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Enable remote for the window
  enable(mainWindow.webContents);
}

// Handle file operations
ipcMain.handle('save-file', async (event, content: string) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Save LaTeX File',
    defaultPath: 'document.tex',
    filters: [
      { name: 'LaTeX Files', extensions: ['tex', 'latex'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (filePath) {
    await require('fs').promises.writeFile(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  }

  return { success: false };
});

ipcMain.handle('open-file', async () => {
  const { filePaths } = await dialog.showOpenDialog({
    title: 'Open LaTeX File',
    filters: [
      { name: 'LaTeX Files', extensions: ['tex', 'latex'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (filePaths && filePaths.length > 0) {
    const content = await require('fs').promises.readFile(filePaths[0], 'utf-8');
    return { success: true, content, path: filePaths[0] };
  }

  return { success: false };
});

ipcMain.handle('export-pdf', async (event, latexContent: string) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export to PDF',
    defaultPath: `document-${uuidv4()}.pdf`,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });

  if (filePath) {
    // In a real implementation, this would use latex.js or a backend service
    // For now, we'll simulate the export
    return { success: true, path: filePath };
  }

  return { success: false };
});

ipcMain.handle('export-png', async (event, latexContent: string) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Export to PNG',
    defaultPath: `document-${uuidv4()}.png`,
    filters: [{ name: 'PNG Files', extensions: ['png'] }],
  });

  if (filePath) {
    // In a real implementation, this would use a rendering service
    return { success: true, path: filePath };
  }

  return { success: false };
});

// Handle app lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Handle new window creation (for security)
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, url) => {
    event.preventDefault();
    require('electron').shell.openExternal(url);
  });
});
