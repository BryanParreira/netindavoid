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
  NODE_ENV: 'production',
}

let mainWindow = null
let tray = null
let apiProc = null
let webProc = null
let isQuitting = false

// ── Loading status helper ─────────────────────────────────────────────────────

function setStatus(win, text) {
  if (!win || win.isDestroyed()) return
  win.webContents.executeJavaScript(
    `document.getElementById('status').textContent = ${JSON.stringify(text)}`
  ).catch(() => {})
}

// ── Process helpers ───────────────────────────────────────────────────────────

function startAPI() {
  const uvicorn = path.join(VENV_BIN, 'uvicorn')
  apiProc = spawn(uvicorn, ['main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: path.join(PROJECT_ROOT, 'apps', 'api'),
    env: ENV,
  })
  apiProc.on('error', (e) => console.error('API error:', e))
  apiProc.on('exit', (code) => { if (!isQuitting) console.warn('API exited', code) })
}

function startWeb(loadingWin) {
  const webDir = path.join(PROJECT_ROOT, 'apps', 'web')
  const npm = path.join(NVM_NODE, 'npm')
  const hasBuild = fs.existsSync(path.join(webDir, '.next', 'BUILD_ID'))

  if (hasBuild) {
    // Production: instant startup (~2s)
    webProc = spawn(npm, ['run', 'start'], { cwd: webDir, env: ENV, shell: false })
  } else {
    // First run: build then start (shows progress in loading screen)
    setStatus(loadingWin, 'Building app for first run… (~1 min)')
    webProc = spawn('sh', ['-c', 'npm run build && npm run start'], {
      cwd: webDir, env: { ...ENV, shell: true },
    })
    // Update status when build finishes and start begins
    webProc.stdout && webProc.stdout.on('data', (d) => {
      const s = d.toString()
      if (s.includes('Starting server') || s.includes('ready')) {
        setStatus(loadingWin, 'Starting web server…')
      }
    })
  }
  webProc.on('error', (e) => console.error('Web error:', e))
}

function killAll() {
  isQuitting = true
  if (apiProc) { try { apiProc.kill('SIGTERM') } catch (_) {} }
  if (webProc) { try { webProc.kill('SIGTERM') } catch (_) {} }
}

function waitForURL(url, timeoutMs = 180000) {
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
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    center: true,
    backgroundColor: '#1f1f1f',
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
    trafficLightPosition: { x: 14, y: 18 },
    backgroundColor: '#1f1f1f',
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
    if (!isQuitting) { e.preventDefault(); mainWindow.hide() }
  })

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
      type: 'info', title: 'Update Available',
      message: 'A new version of Netindavoid is downloading in the background.',
      buttons: ['OK'],
    })
  })

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'Update Ready',
      message: 'Update downloaded. Netindavoid will restart to apply it.',
      buttons: ['Restart Now', 'Later'],
    }).then(({ response }) => {
      if (response === 0) { isQuitting = true; autoUpdater.quitAndInstall() }
    })
  })

  autoUpdater.checkForUpdatesAndNotify().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 4 * 60 * 60 * 1000)
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  const loading = createLoadingWindow()

  // Give loading screen time to render before spawning heavy processes
  await new Promise(r => setTimeout(r, 300))

  setStatus(loading, 'Starting API…')
  startAPI()

  setStatus(loading, 'Starting web server…')
  startWeb(loading)

  try {
    // API comes up fast; web may need a build first time
    await Promise.all([
      waitForURL('http://127.0.0.1:8000/health').then(() => setStatus(loading, 'API ready — waiting for web…')),
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
app.on('activate', () => { if (mainWindow) mainWindow.show() })

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus() }
  })
}
