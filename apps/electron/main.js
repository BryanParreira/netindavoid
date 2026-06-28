const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell, protocol, net: electronNet } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const { spawn } = require('child_process')
const http = require('http')
const os = require('os')
const fs = require('fs')
const url = require('url')

// ── Paths ─────────────────────────────────────────────────────────────────────
//
// Packaged app  →  API source is bundled into Resources/api-src (read-only).
//                  venv + .env live in userData (writable, survives updates).
//
// Dev (npm start) → fall back to PROJECT_ROOT scanning so local dev still works.

const USER_DATA = app.getPath('userData')

function _devProjectRoot() {
  if (process.env.VEX_DIR) return process.env.VEX_DIR
  const persist = path.join(USER_DATA, 'vex-project-root.txt')
  try {
    const p = fs.readFileSync(persist, 'utf8').trim()
    if (p && fs.existsSync(path.join(p, 'apps', 'api', 'main.py'))) return p
  } catch {}
  for (const c of [
    path.join(os.homedir(), 'Desktop', 'Vex'),
    path.join(os.homedir(), 'Desktop', 'vex'),
    path.join(os.homedir(), 'Desktop', 'netindavoid'),
    path.join(os.homedir(), 'Vex'),
    path.join(os.homedir(), 'vex'),
    path.join(os.homedir(), 'netindavoid'),
  ]) {
    if (fs.existsSync(path.join(c, 'apps', 'api', 'main.py'))) return c
  }
  return null
}

// API_SRC  = directory containing main.py (may be read-only when packaged)
// VENV_DIR = directory where the venv lives (always writable)
// DOT_ENV  = .env file written on first launch with localhost DB/Redis URLs
const API_SRC  = app.isPackaged
  ? path.join(process.resourcesPath, 'api-src')
  : path.join(_devProjectRoot() || path.join(os.homedir(), 'Desktop', 'Vex'), 'apps', 'api')

const VENV_DIR = path.join(USER_DATA, '.venv')
const VENV_BIN = path.join(VENV_DIR, 'bin')
const DOT_ENV  = path.join(USER_DATA, '.env')

// Local DB/Redis URLs — written into DOT_ENV on first launch
const LOCAL_DB_URL    = 'postgresql+asyncpg://localhost:5432/vex'
const LOCAL_REDIS_URL = 'redis://localhost:6379/0'

const ENV = {
  ...process.env,
  PATH: `${VENV_BIN}:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin`,
  NODE_ENV:    'production',
  // Override Docker-default URLs so the API talks to localhost services
  DATABASE_URL:          LOCAL_DB_URL,
  REDIS_URL:             LOCAL_REDIS_URL,
  CELERY_BROKER_URL:     'redis://localhost:6379/1',
  CELERY_RESULT_BACKEND: 'redis://localhost:6379/2',
}

// Static web files
const WEB_OUT = app.isPackaged
  ? path.join(process.resourcesPath, 'web-out')
  : path.join(API_SRC, '..', '..', 'web', 'out')

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

const UVICORN = path.join(VENV_BIN, 'uvicorn')

// Auto-setup: open a Terminal to create the venv + install deps + init DB.
// Venv is created in userData (writable) not in API_SRC (may be read-only).
function setupVenv(loadingWin) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(os.tmpdir(), 'vex-setup.command')
    const donePath   = path.join(os.tmpdir(), 'vex-setup-done')

    try { fs.unlinkSync(donePath) } catch (_) {}

    // Ensure userData dir exists so venv can be created there
    try { fs.mkdirSync(USER_DATA, { recursive: true }) } catch (_) {}

    const script = [
      '#!/bin/bash',
      'set -e',
      'export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:$PATH"',
      'echo ""',
      'echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"',
      'echo "  Vex — first-time setup  (do not close this window)"',
      'echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"',
      'echo ""',

      // ── 1. Python venv ──────────────────────────────────────────────────────
      // Prefer Python 3.11-3.13 — psycopg2-binary and other packages
      // don't have pre-built wheels for 3.14+ yet, causing source builds to fail.
      'echo "[1/4] Creating Python environment..."',
      'PYTHON=""',
      'for v in python3.13 python3.12 python3.11 python3.10; do',
      '  if command -v "$v" &>/dev/null; then PYTHON="$v"; break; fi',
      'done',
      '[ -z "$PYTHON" ] && PYTHON=python3',
      'echo "Using $($PYTHON --version)"',
      `"$PYTHON" -m venv "${VENV_DIR}"`,
      `"${VENV_BIN}/pip" install --upgrade pip --quiet`,
      'echo "[2/4] Installing Python dependencies (1-3 min)..."',
      `"${VENV_BIN}/pip" install --prefer-binary -r "${API_SRC}/requirements.txt" --quiet`,

      // ── 2. PostgreSQL ───────────────────────────────────────────────────────
      'echo "[3/4] Setting up database..."',
      // Start PostgreSQL if installed via Homebrew
      'if command -v brew &>/dev/null; then',
      '  PG_VER=$(brew list --formula 2>/dev/null | grep -E "^postgresql@" | sort -V | tail -1)',
      '  [ -n "$PG_VER" ] && brew services start "$PG_VER" &>/dev/null || true',
      '  brew services start redis &>/dev/null || true',
      'fi',
      // Give services a moment to start
      'sleep 3',
      // Create database (idempotent — errors if it already exists, which is fine)
      'createdb vex 2>/dev/null || true',
      // Run Alembic migrations
      `cd "${API_SRC}"`,
      `DATABASE_URL="${LOCAL_DB_URL}" "${VENV_BIN}/alembic" upgrade head 2>&1 || true`,
      // Bootstrap admin user + default tenant
      `DATABASE_URL="${LOCAL_DB_URL}" REDIS_URL="redis://localhost:6379/0" python3 -c "
import asyncio, sys
sys.path.insert(0, '${API_SRC}')
import os
os.environ.setdefault('DATABASE_URL', '${LOCAL_DB_URL}')
os.environ.setdefault('REDIS_URL', 'redis://localhost:6379/0')
from scripts.bootstrap import bootstrap_admin
asyncio.run(bootstrap_admin())
" 2>&1 || true`,

      // ── 3. Done ─────────────────────────────────────────────────────────────
      'echo "[4/4] Done!"',
      `touch "${donePath}"`,
      'echo ""',
      'echo "✓ Setup complete — Vex is starting..."',
      'sleep 3',
    ].join('\n')

    try {
      fs.writeFileSync(scriptPath, script, { mode: 0o755 })
    } catch (e) {
      return reject(new Error('Could not write setup script: ' + e.message))
    }

    shell.openPath(scriptPath).then((openErr) => {
      if (openErr) {
        return reject(new Error('Could not open Terminal for setup: ' + openErr))
      }

      setStatus(loadingWin, 'First-time setup running in Terminal…')

      let elapsed = 0
      const poll = setInterval(() => {
        elapsed += 2000
        if (fs.existsSync(donePath)) {
          clearInterval(poll)
          try { fs.unlinkSync(donePath) } catch (_) {}
          resolve()
        } else if (elapsed >= 600_000) {  // 10 min timeout for first install
          clearInterval(poll)
          reject(new Error('Setup timed out (10 min). Check Terminal for errors, then relaunch Vex.'))
        }
      }, 2000)
    })
  })
}

// Try to start PostgreSQL + Redis via Homebrew (silent — best-effort).
function startDependencies() {
  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', `
      export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"
      if command -v brew &>/dev/null; then
        PG=$(brew list --formula 2>/dev/null | grep -E "^postgresql@" | sort -V | tail -1)
        [ -n "$PG" ] && brew services start "$PG" &>/dev/null || true
        brew services start redis &>/dev/null || true
      fi
    `], { env: process.env })
    proc.on('close', () => resolve())
    setTimeout(resolve, 8000)  // don't wait forever
  })
}

function startAPI() {
  apiProc = spawn(UVICORN, ['main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: API_SRC,
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

  // Reuse existing API if already running (dev sessions / crash-restarts)
  const alreadyUp = await isAPIAlreadyUp()
  if (!alreadyUp) {
    // First launch: venv doesn't exist yet — run full setup
    if (!fs.existsSync(UVICORN)) {
      setStatus(loading, 'First-time setup — opening Terminal…')
      try {
        await setupVenv(loading)
      } catch (err) {
        loading.close()
        dialog.showErrorBox('Setup failed', err.message)
        app.quit()
        return
      }
    }

    // Best-effort: start PostgreSQL + Redis via Homebrew
    setStatus(loading, 'Starting services…')
    await startDependencies()

    setStatus(loading, 'Starting API…')
    const proc = startAPI()

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
        `The API could not start.\n\n${err.message}\n\n` +
        `Make sure PostgreSQL and Redis are installed and running:\n` +
        `  brew install postgresql redis\n` +
        `  brew services start postgresql\n` +
        `  brew services start redis\n\n` +
        `Then relaunch Vex.`
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
