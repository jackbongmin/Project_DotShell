// DotShell Electron 메인 프로세스: 게임 창을 띄운다.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const ENGINE_URL = process.env.DOTSHELL_ENGINE_URL || 'ws://127.0.0.1:8730/ws/terminal';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'DotShell',
    backgroundColor: '#1a1c2c',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    query: { engine: ENGINE_URL },
  });
  if (process.env.DOTSHELL_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
