const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell, protocol, net: electronNet } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const os = require('os')
const fs = require('fs')
const url = require('url')

// ── Project root ──────────────────────────────────────────────────────────────
const PROJECT_ROOT = process.env.VEX_DIR ||
  path.join(os.homedir(), 'Desktop', 'netindavoid')

const NVM_NODE = path.join(os.homedir(), '.nvm', 'versions', 'node', 'v20.19.5', 'bin')
const VENV_BIN = path.join(PROJECT_ROOT, 'apps', 'api', '.venv', 'bin')
const ENV = {
  ...process.env,
  PATH: `${VENV_BIN}:${NVM_NODE}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
  NODE_ENV: 'production',
}

// Static web files: bundled in packaged app, or local build in dev
const WEB_OUT = app.isPackaged
  ? path.join(process.resourcesPath, 'web-out')
  : path.join(PROJECT_ROOT, 'apps', 'web', 'out')

let mainWindow = null
let tray = null
let apiProc = null
let isQuitting = false

// ── Register app:// scheme BEFORE app is ready ────────────────────────────────
// Treat it like https:// — same-origin, fetch API, no mixed-content blocks
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    secure: true,
    standard: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}])

// ── Loading status helper ─────────────────────────────────────────────────────
function setStatus(win, text) {
  if (!win || win.isDestroyed()) return
  win.webContents.executeJavaScript(
    `document.getElementById('status').textContent = ${JSON.stringify(text)}`
  ).catch(() => {})
}

// ── API process ───────────────────────────────────────────────────────────────
let apiLastError = ''

const API_DIR   = path.join(PROJECT_ROOT, 'apps', 'api')
const UVICORN   = path.join(VENV_BIN, 'uvicorn')
const PIP       = path.join(VENV_BIN, 'pip')

// Run a shell command via the user's login shell so PATH includes pyenv/conda/python.org installs.
function shellRun(cmd, opts = {}) {
  return spawn('/bin/zsh', ['-l', '-c', cmd], opts)
}

// Auto-setup: create .venv and install requirements if uvicorn is missing.
// Called from the app.whenReady() flow with the loading window for status updates.
function setupVenv(loadingWin) {
  return new Promise((resolve, reject) => {
    setStatus(loadingWin, 'First launch: setting up Python environment…')

    const venvProc = shellRun(`python3 -m venv "${path.join(API_DIR, '.venv')}"`, { cwd: API_DIR })
    let venvErr = ''
    venvProc.stderr.on('data', (d) => { venvErr += d.toString() })
    venvProc.on('error', (e) => reject(new Error(`Could not launch shell: ${e.message}`)))
    venvProc.on('exit', (code) => {
      if (code !== 0) return reject(new Error(
        `Python environment setup failed.\n\n${venvErr.slice(-300)}\n\nInstall Python 3 from python.org then relaunch Vex.`
      ))

      setStatus(loadingWin, 'Installing dependencies (1–2 min first time)…')

      const pipProc = shellRun(`"${PIP}" install -r requirements.txt --quiet`, { cwd: API_DIR })
      let pipErr = ''
      pipProc.stderr.on('data', (d) => { pipErr += d.toString() })
      pipProc.on('error', (e) => reject(new Error(`pip failed: ${e.message}`)))
      pipProc.on('exit', (code) => {
        if (code !== 0) return reject(new Error(`pip install failed:\n${pipErr.slice(-300)}`))
        resolve()
      })
    })
  })
}

function startAPI() {
  apiProc = spawn(UVICORN, ['main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: API_DIR,
    env: ENV,
  })

  apiProc.stderr.on('data', (d) => {
    const line = d.toString().trim()
    console.error('[API]', line)
    if (line) apiLastError = line
  })
  apiProc.stdout.on('data', (d) => console.log('[API]', d.toString().trim()))

  apiProc.on('error', (e) => { apiLastError = e.message })
  apiProc.on('exit', (code) => {
    if (!isQuitting) console.warn('API exited with code', code)
  })

  return apiProc
}

function killAll() {
  isQuitting = true
  if (apiProc) { try { apiProc.kill('SIGTERM') } catch (_) {} }
}

function waitForAPI(timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs

    // Fail immediately if API process dies
    if (apiProc) {
      apiProc.once('exit', (code) => {
        if (!isQuitting) reject(new Error(`API exited (code ${code})\n\n${apiLastError}`))
      })
    }

    const check = () => {
      http.get('http://127.0.0.1:8000/health', (res) => {
        res.resume()
        if (res.statusCode < 500) return resolve()
        if (Date.now() > deadline) return reject(new Error(`API health check timed out.\n\n${apiLastError}`))
        setTimeout(check, 1500)
      }).on('error', () => {
        if (Date.now() > deadline) return reject(new Error(`API did not start within ${timeoutMs / 1000}s.\n\nLast error: ${apiLastError || 'none'}\n\nMake sure PostgreSQL and Redis are running.`))
        setTimeout(check, 1500)
      })
    }
    check()
  })
}

// ── app:// protocol handler ───────────────────────────────────────────────────
// Serves the pre-built Next.js static export from disk.
// All navigation is client-side (Next.js router) — no server needed.
function registerAppProtocol() {
  protocol.handle('app', (request) => {
    let { pathname } = new URL(request.url)

    // decode %20 etc.
    pathname = decodeURIComponent(pathname)

    // Root
    if (pathname === '/' || pathname === '') {
      return electronNet.fetch(url.pathToFileURL(path.join(WEB_OUT, 'index.html')).href)
    }

    // Exact file (JS, CSS, images, fonts)
    const exact = path.join(WEB_OUT, pathname)
    if (fs.existsSync(exact) && fs.statSync(exact).isFile()) {
      return electronNet.fetch(url.pathToFileURL(exact).href)
    }

    // Next.js trailingSlash: try pathname/index.html
    const asDir = path.join(WEB_OUT, pathname.replace(/\/$/, ''), 'index.html')
    if (fs.existsSync(asDir)) {
      return electronNet.fetch(url.pathToFileURL(asDir).href)
    }

    // SPA fallback — Next.js router handles the route in JS
    return electronNet.fetch(url.pathToFileURL(path.join(WEB_OUT, 'index.html')).href)
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
    backgroundColor: '#111111',
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
    trafficLightPosition: { x: 14, y: 11 },
    backgroundColor: '#111111',
    show: false,
    icon: path.join(__dirname, 'build', 'icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Allow fetching http://127.0.0.1:8000 from app:// origin
      webSecurity: false,
    },
  })

  // Load the pre-built static app directly — no web server needed
  mainWindow.loadURL('app://localhost')

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide() }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    shell.openExternal(u)
    return { action: 'deny' }
  })
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  // Use a dedicated 22×22 template PNG for the macOS menu bar.
  // Template images are pure black + alpha — macOS inverts them automatically
  // for dark/light mode so the icon is always visible.
  const trayPng = path.join(__dirname, 'build', 'tray-icon.png')
  const img = nativeImage.createFromPath(trayPng)
  tray = new Tray(img)
  tray.setToolTip('Vex')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Vex', click: () => { mainWindow?.show() } },
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
      message: 'A new version of Vex is downloading in the background.',
      buttons: ['OK'],
    })
  })

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info', title: 'Update Ready',
      message: 'Update downloaded. Vex will restart to apply it.',
      buttons: ['Restart Now', 'Later'],
    }).then(({ response }) => {
      if (response === 0) { isQuitting = true; autoUpdater.quitAndInstall() }
    })
  })

  autoUpdater.checkForUpdatesAndNotify().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 4 * 60 * 60 * 1000)
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
function isAPIAlreadyUp() {
  return new Promise((resolve) => {
    http.get('http://127.0.0.1:8000/health', (res) => {
      res.resume()
      resolve(res.statusCode < 500)
    }).on('error', () => resolve(false))
  })
}

app.whenReady().then(async () => {
  registerAppProtocol()

  const loading = createLoadingWindow()
  await new Promise(r => setTimeout(r, 300))

  setStatus(loading, 'Starting API…')

  // Reuse existing API if already running (dev sessions, previous crash-restarts)
  const alreadyUp = await isAPIAlreadyUp()
  if (!alreadyUp) {
    // Auto-setup Python venv on first launch (or after venv was deleted)
    if (!fs.existsSync(UVICORN)) {
      try {
        await setupVenv(loading)
      } catch (err) {
        loading.close()
        dialog.showErrorBox('Setup failed', err.message)
        app.quit()
        return
      }
    }

    setStatus(loading, 'Starting API…')
    const proc = startAPI()

    // Show live stderr in loading screen so user knows what's happening
    proc.stderr.on('data', (d) => {
      const line = d.toString().trim().split('\n').pop() || ''
      if (line && !line.includes('DeprecationWarning')) {
        setStatus(loading, line.length > 60 ? line.slice(0, 57) + '…' : line)
      }
    })

    try {
      await waitForAPI()
    } catch (err) {
      loading.close()
      dialog.showErrorBox(
        'Startup failed',
        `The API could not start.\n\n${err.message}\n\nMake sure PostgreSQL and Redis are running, then relaunch Vex.`
      )
      app.quit()
      return
    }
  }

  setStatus(loading, 'Loading…')
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
