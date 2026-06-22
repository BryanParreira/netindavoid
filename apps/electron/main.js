const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const os = require('os')
const fs = require('fs')

// ── Project root ──────────────────────────────────────────────────────────────
const PROJECT_ROOT = process.env.NETINDAVOID_DIR ||
  path.join(os.homedir(), 'Desktop', 'netindavoid')

const NVM_NODE = path.join(os.homedir(), '.nvm', 'versions', 'node', 'v20.19.5', 'bin')
const VENV_BIN = path.join(PROJECT_ROOT, 'apps', 'api', '.venv', 'bin')
const ENV = {
  ...process.env,
  PATH: `${VENV_BIN}:${NVM_NODE}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
}

let mainWindow = null
let tray = null
let apiProc = null
let webProc = null
let isQuitting = false

// ── Process helpers ───────────────────────────────────────────────────────────

function startAPI() {
  const uvicorn = path.join(VENV_BIN, 'uvicorn')
  apiProc = spawn(uvicorn, ['main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: path.join(PROJECT_ROOT, 'apps', 'api'),
    env: ENV,
  })
  apiProc.on('error', (e) => console.error('API error:', e))
  apiProc.on('exit', (code) => {
    if (!isQuitting) console.warn('API exited', code)
  })
}

function startWeb() {
  const npm = path.join(NVM_NODE, 'npm')
  webProc = spawn(npm, ['run', 'dev'], {
    cwd: path.join(PROJECT_ROOT, 'apps', 'web'),
    env: ENV,
    shell: false,
  })
  webProc.on('error', (e) => console.error('Web error:', e))
}

function killAll() {
  isQuitting = true
  if (apiProc) { try { apiProc.kill('SIGTERM') } catch (_) {} }
  if (webProc) { try { webProc.kill('SIGTERM') } catch (_) {} }
}

function waitForURL(url, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      http.get(url, (res) => {
        res.resume()
        if (res.statusCode < 500) return resolve()
        if (Date.now() > deadline) return reject(new Error('Timeout: ' + url))
        setTimeout(check, 1500)
      }).on('error', () => {
        if (Date.now() > deadline) return reject(new Error('Timeout: ' + url))
        setTimeout(check, 1500)
      })
    }
    check()
  })
}

// ── Loading screen ────────────────────────────────────────────────────────────

function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 300,
    frame: false,
    resizable: false,
    center: true,
    backgroundColor: '#111113',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    icon: path.join(__dirname, 'build', 'icon.icns'),
  })
  win.loadFile(path.join(__dirname, 'loading.html'))
  return win
}

// ── Main window ───────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111113',
    show: false,
    icon: path.join(__dirname, 'build', 'icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.loadURL('http://localhost:3000')

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.icns'))
  const trayIcon = img.resize({ width: 18, height: 18 })
  tray = new Tray(trayIcon)
  tray.setToolTip('Netindavoid')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Netindavoid', click: () => { mainWindow?.show() } },
    { type: 'separator' },
    { label: 'Check for Updates', click: () => autoUpdater.checkForUpdatesAndNotify() },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } },
  ]))
  tray.on('click', () => mainWindow?.show())
}

// ── Auto-updater ──────────────────────────────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Available',
      message: 'A new version of Netindavoid is downloading in the background.',
      buttons: ['OK'],
    })
  })

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready',
      message: 'Update downloaded. Netindavoid will restart to apply it.',
      buttons: ['Restart Now', 'Later'],
    }).then(({ response }) => {
      if (response === 0) {
        isQuitting = true
        autoUpdater.quitAndInstall()
      }
    })
  })

  // Check on startup, then every 4 hours
  autoUpdater.checkForUpdatesAndNotify().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 4 * 60 * 60 * 1000)
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const loading = createLoadingWindow()

  startAPI()
  startWeb()

  try {
    await Promise.all([
      waitForURL('http://127.0.0.1:8000/health'),
      waitForURL('http://localhost:3000'),
    ])
  } catch (err) {
    loading.close()
    dialog.showErrorBox('Startup failed', err.message + '\n\nCheck that PostgreSQL and Redis are running.')
    app.quit()
    return
  }

  loading.close()
  createMainWindow()
  createTray()
  setupAutoUpdater()
})

app.on('before-quit', killAll)
app.on('will-quit', killAll)

app.on('activate', () => {
  if (mainWindow) mainWindow.show()
})

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  })
}
