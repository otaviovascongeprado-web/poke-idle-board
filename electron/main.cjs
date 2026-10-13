const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');

// --- CHROMIUM / V8 MEMORY OPTIMIZATION SWITCHES ---
// Limit V8 heap per renderer process to prevent lazy bloating up to 1GB+:
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256 --optimize_for_size --expose-gc');
// Cap network & media caches to prevent gigabytes of cached assets:
app.commandLine.appendSwitch('disk-cache-size', '67108864');       // 64 MB max per session
app.commandLine.appendSwitch('media-cache-size', '33554432');      // 32 MB max
// Avoid GPU texture doubling on high-DPI scaled displays (e.g. 125%/150% scaling):
app.commandLine.appendSwitch('force-device-scale-factor', '1');
// Prevent unbounded growth of GPU shader disk cache:
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
// Enable Chromium's native memory purging and suspension capabilities:
app.commandLine.appendSwitch('enable-features', 'PurgeAndSuspend,MemoryPurge');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const ACCOUNT_COUNT = 4;
const POKE_WORKSPACE_ID = 'poke-idle';
// Do NOT crush offscreen dimensions to 1x1, as that can crash WebGL/Canvas viewports:
const OFFSCREEN_BOUNDS = { x: -10000, y: -10000, width: 800, height: 600 };
const viewsByWorkspace = new Map();
const urlsByWorkspace = new Map();
let mainWindow;
let ipcHandlersRegistered = false;
let resourceSampler = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(createMainWindow);
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function validWorkspaceId(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
}
function validAccountIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < ACCOUNT_COUNT;
}
function validateUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
function partitionFor(workspaceId, accountIndex) {
  // Preserve the existing Poke Idle profiles so their saved logins survive migration.
  if (workspaceId === POKE_WORKSPACE_ID) {
    return `persist:poke-idle-account-${String(accountIndex + 1).padStart(2, '0')}`;
  }
  return `persist:${workspaceId}-account-${String(accountIndex + 1).padStart(2, '0')}`;
}
function isMainRenderer(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}
function sendPaneStatus(workspaceId, accountIndex, state, message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('board:pane-status', { workspaceId, accountIndex, state, message });
}
function getWorkspaceViews(workspaceId) {
  if (!viewsByWorkspace.has(workspaceId)) {
    viewsByWorkspace.set(workspaceId, Array(ACCOUNT_COUNT).fill(null));
    urlsByWorkspace.set(workspaceId, Array(ACCOUNT_COUNT).fill(''));
  }
  return viewsByWorkspace.get(workspaceId);
}

function createPaneView(workspaceId, accountIndex) {
  const partition = partitionFor(workspaceId, accountIndex);
  const view = new WebContentsView({
    webPreferences: {
      partition,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  view.setBounds(OFFSCREEN_BOUNDS);
  view.setVisible(false);
  view.webContents.setAudioMuted(true);
  view.webContents.setWindowOpenHandler(({ url }) => {
    const allowedUrl = validateUrl(url);
    if (!allowedUrl) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: mainWindow,
        width: 1100,
        height: 820,
        autoHideMenuBar: true,
        webPreferences: {
          partition,
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      }
    };
  });
  view.webContents.on('will-navigate', (event, url) => {
    if (!validateUrl(url)) event.preventDefault();
  });
  view.webContents.on('did-start-loading', () => sendPaneStatus(workspaceId, accountIndex, 'loading', 'Carregando jogo'));
  view.webContents.on('did-finish-load', () => {
    if (view.webContents.getURL() !== 'about:blank') {
      sendPaneStatus(workspaceId, accountIndex, 'ready', 'Página carregada · confira o login no jogo');
    }
  });
  view.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) sendPaneStatus(workspaceId, accountIndex, 'error', `Falha ao carregar: ${description}`);
  });
  view.webContents.on('render-process-gone', () => sendPaneStatus(workspaceId, accountIndex, 'error', 'O processo do jogo foi encerrado'));
  view.webContents.on('unresponsive', () => sendPaneStatus(workspaceId, accountIndex, 'warning', 'Jogo sem resposta'));
  view.webContents.on('responsive', () => sendPaneStatus(workspaceId, accountIndex, 'ready', 'Jogo responsivo'));
  mainWindow.contentView.addChildView(view);
  getWorkspaceViews(workspaceId)[accountIndex] = view;
  return view;
}

function getOrCreatePane(workspaceId, accountIndex) {
  if (!validWorkspaceId(workspaceId) || !validAccountIndex(accountIndex)) return null;
  const views = getWorkspaceViews(workspaceId);
  return views[accountIndex] || createPaneView(workspaceId, accountIndex);
}

function setPaneLayout(workspaceId, layout) {
  if (!validWorkspaceId(workspaceId) || !Array.isArray(layout) || layout.length !== ACCOUNT_COUNT) return;

  // Inactive workspaces stay alive in background:
  // Hide their native views and mute audio, but DO NOT navigate away, destroy them, or collapse bounds to 1x1.
  for (const [otherWorkspaceId, views] of viewsByWorkspace) {
    if (otherWorkspaceId === workspaceId) continue;
    views.forEach((view) => {
      if (!view || view.webContents.isDestroyed()) return;
      view.setVisible(false);
      view.setBounds(OFFSCREEN_BOUNDS);
      view.webContents.setAudioMuted(true);
    });
  }

  layout.forEach((entry, accountIndex) => {
    if (!entry || ![entry.x, entry.y, entry.width, entry.height].every(Number.isFinite)) return;
    
    // Lazy creation: only instantiate WebContentsView if visible or already exists or has URL configured
    const configuredUrl = urlsByWorkspace.get(workspaceId)?.[accountIndex];
    if (!entry.visible && !viewsByWorkspace.get(workspaceId)?.[accountIndex] && !configuredUrl) {
      return;
    }

    const view = getOrCreatePane(workspaceId, accountIndex);
    if (!view || view.webContents.isDestroyed()) return;

    const visible = entry.visible === true && entry.width > 0 && entry.height > 0;
    if (!visible) {
      view.setVisible(false);
      view.setBounds(OFFSCREEN_BOUNDS);
      view.webContents.setAudioMuted(true);
      return;
    }

    const bounds = mainWindow.getContentBounds();
    const x = Math.max(0, Math.min(bounds.width - 1, Math.round(entry.x)));
    const y = Math.max(0, Math.min(bounds.height - 1, Math.round(entry.y)));
    const width = Math.max(1, Math.min(bounds.width - x, Math.round(entry.width)));
    const height = Math.max(1, Math.min(bounds.height - y, Math.round(entry.height)));
    view.setBounds({ x, y, width, height });
    view.setVisible(true);
    view.webContents.setAudioMuted(false);
    if (view.webContents.isLoading()) {
      sendPaneStatus(workspaceId, accountIndex, 'loading', 'Carregando jogo');
    } else if (view.webContents.getURL() !== 'about:blank') {
      sendPaneStatus(workspaceId, accountIndex, 'ready', 'Sessão mantida em execução');
    }
  });
}

async function navigatePane(workspaceId, accountIndex, rawUrl, force = false) {
  const url = validateUrl(rawUrl);
  if (!url) return false;
  const view = getOrCreatePane(workspaceId, accountIndex);
  if (!view || view.webContents.isDestroyed()) return false;
  urlsByWorkspace.get(workspaceId)[accountIndex] = url;

  const currentUrl = view.webContents.getURL();
  // CRITICAL FIX: If the view has already loaded a webpage and force is false,
  // DO NOT RELOAD! This prevents the game from resetting/closing when switching workspaces A <-> B!
  if (force || !currentUrl || currentUrl === 'about:blank') {
    await view.webContents.loadURL(url);
  }
  return true;
}

async function clearWorkspaceCache(workspaceId) {
  if (!validWorkspaceId(workspaceId)) throw new Error('Identificador de aba inválido.');
  const urls = urlsByWorkspace.get(workspaceId) || Array(ACCOUNT_COUNT).fill('');
  const partitions = Array.from({ length: ACCOUNT_COUNT }, (_, index) => partitionFor(workspaceId, index));
  await Promise.all(partitions.map((partition) => session.fromPartition(partition).clearCache()));

  const views = getWorkspaceViews(workspaceId);
  await Promise.all(views.map(async (view, index) => {
    const url = urls[index];
    if (view && !view.webContents.isDestroyed() && url) await view.webContents.loadURL(url);
  }));
  return { ok: true };
}

async function optimizeAllMemory() {
  // 1. Trigger V8 GC in each active WebContentsView
  for (const views of viewsByWorkspace.values()) {
    for (const view of views) {
      if (view && !view.webContents.isDestroyed()) {
        try {
          view.webContents.executeJavaScript('if (window.gc) { window.gc(); }', true).catch(() => {});
        } catch {}
      }
    }
  }

  // 2. Clear network caches across active sessions
  for (const workspaceId of viewsByWorkspace.keys()) {
    for (let i = 0; i < ACCOUNT_COUNT; i++) {
      try {
        session.fromPartition(partitionFor(workspaceId, i)).clearCache().catch(() => {});
      } catch {}
    }
  }

  // 3. Trigger main process V8 GC if available
  if (global.gc) {
    try { global.gc(); } catch {}
  }

  return { ok: true, timestamp: new Date().toISOString() };
}

function destroyWorkspaceViews(workspaceId) {
  if (workspaceId === POKE_WORKSPACE_ID) return false;
  const views = viewsByWorkspace.get(workspaceId);
  if (views) {
    views.forEach((view) => {
      if (view && !view.webContents.isDestroyed()) {
        try {
          mainWindow.contentView.removeChildView(view);
          view.webContents.close();
        } catch {}
      }
    });
  }
  viewsByWorkspace.delete(workspaceId);
  urlsByWorkspace.delete(workspaceId);
  return true;
}

function setPaneLayoutFromRenderer(event, workspaceId, layout) {
  if (isMainRenderer(event)) setPaneLayout(workspaceId, layout);
}

function registerIpcHandlers() {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;
  ipcMain.on('board:set-pane-layout', setPaneLayoutFromRenderer);
  ipcMain.handle('board:navigate-pane', (event, workspaceId, accountIndex, url, force) => {
    if (!isMainRenderer(event)) return false;
    return navigatePane(workspaceId, accountIndex, url, Boolean(force)).catch((error) => {
      sendPaneStatus(workspaceId, accountIndex, 'error', `Falha ao navegar: ${error.message}`);
      return false;
    });
  });
  ipcMain.handle('board:open-pane-window', (event, workspaceId, accountIndex, rawUrl) => {
    if (!isMainRenderer(event) || !validWorkspaceId(workspaceId) || !validAccountIndex(accountIndex)) return false;
    const url = validateUrl(rawUrl);
    if (!url) return false;
    const popup = new BrowserWindow({
      parent: mainWindow,
      width: 1100,
      height: 820,
      autoHideMenuBar: true,
      webPreferences: {
        partition: partitionFor(workspaceId, accountIndex),
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    popup.loadURL(url);
    return true;
  });
  ipcMain.handle('board:clear-workspace-cache', async (event, workspaceId) => {
    if (!isMainRenderer(event)) throw new Error('Origem do pedido inválida.');
    return clearWorkspaceCache(workspaceId);
  });
  ipcMain.handle('board:optimize-memory', async (event) => {
    if (!isMainRenderer(event)) throw new Error('Origem do pedido inválida.');
    return optimizeAllMemory();
  });
  ipcMain.handle('board:remove-workspace', async (event, workspaceId) => {
    if (!isMainRenderer(event)) throw new Error('Origem do pedido inválida.');
    return destroyWorkspaceViews(workspaceId);
  });
  ipcMain.handle('board:start-resource-monitor', (event) => isMainRenderer(event) && startResourceSampler());
  ipcMain.handle('board:stop-resource-monitor', (event) => {
    if (!isMainRenderer(event)) return false;
    stopResourceSampler();
    return true;
  });
}

function stopResourceSampler() {
  if (!resourceSampler) return;
  const sampler = resourceSampler;
  resourceSampler = null;
  sampler.kill();
}

function startResourceSampler() {
  if (resourceSampler || !mainWindow || mainWindow.isDestroyed()) return false;
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = String.raw`
$ErrorActionPreference = 'Stop'
while ($true) {
  try {
    $cpuRow = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -ErrorAction Stop | Select-Object -First 1
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    $cpu = [double]$cpuRow.PercentProcessorTime
    $totalMb = [math]::Round(([double]$os.TotalVisibleMemorySize / 1024), 1)
    $availableMb = [math]::Round(([double]$os.FreePhysicalMemory / 1024), 1)
    $usedMb = [math]::Max(0, $totalMb - $availableMb)
    $ramPercent = if ($totalMb -gt 0) { [math]::Round(($usedMb / $totalMb) * 100, 1) } else { 0 }
    $gpuPercent = $null; $gpuName = $null
    try {
      $gpuRows = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $null -ne $_.UtilizationPercentage })
      if ($gpuRows.Count -gt 0) {
        $gpuRow = $gpuRows | Sort-Object -Property UtilizationPercentage -Descending | Select-Object -First 1
        $gpuPercent = [math]::Min(100, [math]::Max(0, [double]$gpuRow.UtilizationPercentage))
        $gpuName = [string]$gpuRow.Name
        if ($gpuName -match 'engtype_([^_]+)') { $gpuName = $Matches[1] }
      }
    } catch { $gpuName = 'Contador de GPU indisponível' }
    [pscustomobject]@{ cpuPercent=[math]::Min(100,[math]::Max(0,$cpu)); ramPercent=$ramPercent; ramUsedMb=$usedMb; ramTotalMb=$totalMb; ramAvailableMb=$availableMb; gpuPercent=$gpuPercent; gpuName=$gpuName; timestamp=(Get-Date).ToString('o') } | ConvertTo-Json -Compress
  } catch { [pscustomobject]@{ error=$_.Exception.Message; timestamp=(Get-Date).ToString('o') } | ConvertTo-Json -Compress }
  Start-Sleep -Seconds 2
}
`;
  try {
    const sampler = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    resourceSampler = sampler;
    const output = readline.createInterface({ input: sampler.stdout });
    sampler.stderr.on('data', (chunk) => {
      if (sampler !== resourceSampler) return;
      const detail = String(chunk).trim();
      if (detail && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('board:resource-sample', { error: detail });
    });
    output.on('line', (line) => {
      if (!mainWindow || mainWindow.isDestroyed() || sampler !== resourceSampler) return;
      try { mainWindow.webContents.send('board:resource-sample', JSON.parse(line)); }
      catch { mainWindow.webContents.send('board:resource-sample', { error: 'Resposta inválida dos contadores do Windows' }); }
    });
    sampler.on('error', (error) => {
      if (sampler !== resourceSampler) return;
      resourceSampler = null;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('board:resource-sample', { error: `Não foi possível iniciar o monitor: ${error.message}` });
    });
    sampler.on('exit', (code) => {
      if (sampler !== resourceSampler) return;
      resourceSampler = null;
      if (code !== 0 && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('board:resource-sample', { error: `O monitor encerrou (código ${code ?? 'desconhecido'})` });
    });
    return true;
  } catch (error) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('board:resource-sample', { error: `Não foi possível iniciar o monitor: ${error.message}` });
    return false;
  }
}

// Background memory optimization sweep every 15 minutes
const memorySweepInterval = setInterval(() => {
  optimizeAllMemory().catch(() => {});
}, 15 * 60 * 1000);

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: '#080e17',
    title: 'Poke Idle World — Multi Account Board',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  registerIpcHandlers();
  mainWindow.on('resize', () => {
    if (!mainWindow.webContents.isLoading()) mainWindow.webContents.send('board:request-layout');
  });
  mainWindow.webContents.on('did-finish-load', () => mainWindow.webContents.send('board:request-layout'));
  mainWindow.on('closed', () => {
    clearInterval(memorySweepInterval);
    stopResourceSampler();
    mainWindow = null;
    for (const views of viewsByWorkspace.values()) {
      for (const view of views) {
        if (view && !view.webContents.isDestroyed()) view.webContents.close();
      }
    }
    viewsByWorkspace.clear();
    urlsByWorkspace.clear();
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
}
