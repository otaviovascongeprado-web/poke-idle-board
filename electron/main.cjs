const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, WebContentsView, ipcMain, session, dialog } = require('electron');
const nativeWindows = require('./native-windows.cjs');

const ACCOUNT_COUNT = 4;
const POKE_WORKSPACE_ID = 'poke-idle';
app.setName('Sincronize');
if (process.platform === 'win32') app.setAppUserModelId('com.sincronize.desktop');
// Do NOT crush offscreen dimensions to 1x1, as that can crash WebGL/Canvas viewports:
const OFFSCREEN_BOUNDS = { x: -10000, y: -10000, width: 800, height: 600 };
const viewsByWorkspace = new Map();
const urlsByWorkspace = new Map();
const nativeApps = new Map();
const reservedNativeHandles = new Set();
const layoutsByWorkspace = new Map();
let mainWindow;
let modalOverlayOpen = false;
let lastLayoutWorkspaceId = null;
let nativeWindowsDetached = false;
let nativeClosePending = false;
let ipcHandlersRegistered = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow(true);
  });
  app.whenReady().then(createMainWindow);
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    return;
  }
  showMainWindow(true);
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function validWorkspaceId(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);
}
function showMainWindow(maximize = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (maximize && !mainWindow.isMaximized()) mainWindow.maximize();
  mainWindow.show();
  mainWindow.focus();
}
function validAccountIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < ACCOUNT_COUNT;
}
function nativeAppKey(workspaceId, accountIndex) { return `${workspaceId}:${accountIndex}`; }
function sendNativeStatus(workspaceId, accountIndex, state, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('board:pane-status', { workspaceId, accountIndex, state, message, source: 'native' });
  }
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
function paneLayoutFor(workspaceId, accountIndex) {
  return layoutsByWorkspace.get(workspaceId)?.[accountIndex] || null;
}
function nativeBounds(entry, visibleOverride) {
  const layout = paneLayoutFor(entry.workspaceId, entry.accountIndex);
  const visible = visibleOverride ?? Boolean(!modalOverlayOpen && layout?.mode === 'app' && layout.visible);
  // Renderer bounds use device-independent pixels; Win32 SetWindowPos uses physical pixels.
  const scale = Number.isFinite(layout?.scale) ? Math.min(4, Math.max(0.5, layout.scale)) : 1;
  return {
    x: Math.round((layout?.x || 0) * scale),
    y: Math.round((layout?.y || 0) * scale),
    width: Math.max(1, Math.round((layout?.width || 800) * scale)),
    height: Math.max(1, Math.round((layout?.height || 600) * scale)),
    visible
  };
}
async function positionNativeEntry(entry, visibleOverride) {
  if (!entry.hwnd) return { ok: false };
  const parent = mainWindowHandle();
  return nativeWindows.ensureEmbedded(entry.hwnd, parent, nativeBounds(entry, visibleOverride), entry.originalStyle);
}
async function hideNativeEntry(entry) {
  if (entry.hwnd) return nativeWindows.position(entry.hwnd, mainWindowHandle(), nativeBounds(entry, false));
  return { ok: true };
}
function mainWindowHandle() {
  const windowHandle = mainWindow.getNativeWindowHandle();
  return windowHandle.length >= 8 ? windowHandle.readBigUInt64LE().toString() : String(windowHandle.readUInt32LE());
}
async function attachNativeWindow(entry, candidate) {
  if (String(candidate.pid) === String(process.pid)) throw new Error('Não é possível encaixar uma janela do próprio Sincronize.');
  entry.hwnd = String(candidate.hwnd);
  entry.targetPid = Number(candidate.pid);
  entry.originalBounds = candidate.bounds || { x: 80, y: 80, width: 1100, height: 800 };
  entry.originalStyle = String(candidate.style || 0);
  entry.originalParent = String(candidate.parent || 0);
  reservedNativeHandles.add(entry.hwnd);
  const parent = mainWindowHandle();
  if (!await nativeWindows.isWindow(parent)) throw new Error('A janela principal do Sincronize não está disponível para encaixe.');
  const result = await nativeWindows.attach(entry.hwnd, parent, nativeBounds(entry), entry.originalStyle, parent, entry.originalParent);
  if (!result?.ok) throw new Error('O Windows não conseguiu posicionar a janela dentro do painel.');
  const positioned = await positionNativeEntry(entry);
  if (!positioned?.ok) throw new Error('O Windows não conseguiu ajustar a janela ao tamanho do painel.');
  return result;
}
async function pollNativeAppWindow(entry) {
  if (entry.polling || !nativeApps.has(entry.key)) return;
  entry.polling = true;
  try {
    if (entry.hwnd) {
      const alive = await nativeWindows.isWindow(entry.hwnd);
      if (!alive) {
        finishNativeProgram(entry, 'closed', 'Aplicativo encerrado');
        return;
      }
      const positioned = await positionNativeEntry(entry);
      if (!positioned?.ok && !entry.warnedEmbedRepair) {
        entry.warnedEmbedRepair = true;
        sendNativeStatus(entry.workspaceId, entry.accountIndex, 'warning', 'Não foi possível manter a janela encaixada. O aplicativo pode ter ativado tela cheia exclusiva.');
      } else if (positioned?.ok) {
        entry.warnedEmbedRepair = false;
      }
      return;
    }
    const windows = await nativeWindows.listWindows();
    if (entry.ownsProcess && entry.child?.pid) {
      const processIds = await nativeWindows.listProcessTree(entry.child.pid);
      for (const processId of processIds) entry.processIds.add(Number(processId));
    }
    const titleNeedle = entry.windowTitle.trim().toLocaleLowerCase();
    let candidate = windows.find((candidateWindow) => {
      if (entry.knownHandles.has(String(candidateWindow.hwnd)) || reservedNativeHandles.has(String(candidateWindow.hwnd)) || entry.rejectedHandles?.has(String(candidateWindow.hwnd))) return false;
      if (Number(candidateWindow.pid) === Number(process.pid)) return false;
      if (titleNeedle) return String(candidateWindow.title || '').toLocaleLowerCase().includes(titleNeedle);
      return entry.processIds.has(Number(candidateWindow.pid))
        || (candidateWindow.ancestors || []).some((pid) => entry.processIds.has(Number(pid)));
    });
    // Launchers such as Roblox often exit after handing the game to a detached process.
    // If ancestry is gone, safely attach only a single new, stable, ordinary top-level window.
    if (!candidate && !titleNeedle && entry.ownsProcess && entry.childExited) {
      const newCandidates = windows.filter((candidateWindow) => {
        const style = Number(candidateWindow.style) >>> 0;
        const bounds = candidateWindow.bounds || {};
        return !entry.knownHandles.has(String(candidateWindow.hwnd))
          && !reservedNativeHandles.has(String(candidateWindow.hwnd))
          && !entry.rejectedHandles?.has(String(candidateWindow.hwnd))
          && Number(candidateWindow.pid) !== Number(process.pid)
          && candidateWindow.title
          && candidateWindow.executable && path.isAbsolute(candidateWindow.executable)
          && String(candidateWindow.parent || '0') === '0'
          && (style & 0x10000000) !== 0
          && (style & 0x40000000) === 0
          && Number(bounds.width) >= 280 && Number(bounds.height) >= 160;
      });
      if (newCandidates.length === 1) {
        const handle = String(newCandidates[0].hwnd);
        entry.fallbackWindowCount = entry.fallbackWindowHandle === handle ? (entry.fallbackWindowCount || 0) + 1 : 1;
        entry.fallbackWindowHandle = handle;
        if (entry.fallbackWindowCount >= 2) candidate = newCandidates[0];
      } else {
        entry.fallbackWindowHandle = null;
        entry.fallbackWindowCount = 0;
      }
    }
    if (!candidate) {
      if (!entry.warnedNoWindow && Date.now() - entry.startedAt > 45000) {
        entry.warnedNoWindow = true;
        sendNativeStatus(entry.workspaceId, entry.accountIndex, 'warning', 'Ainda não encontrei uma janela nova. Confira o título da janela alvo ou se o app abriu em outro processo.');
      }
      return;
    }
    const result = await attachNativeWindow(entry, candidate);
    if (!result?.ok) throw new Error('O Windows não conseguiu encaixar a janela selecionada.');
    entry.nativeReadySent = true;
    sendNativeStatus(entry.workspaceId, entry.accountIndex, 'ready', 'Janela conectada ao painel');
    clearInterval(entry.pollTimer);
    entry.pollTimer = setInterval(() => pollNativeAppWindow(entry), 500);
    entry.pollTimer.unref?.();
  } catch (error) {
    if (entry.hwnd && entry.originalBounds) {
      entry.rejectedHandles ||= new Set();
      entry.rejectedHandles.add(String(entry.hwnd));
      try { await nativeWindows.detach(entry.hwnd, entry.originalBounds, entry.originalStyle, entry.originalParent); } catch {}
      reservedNativeHandles.delete(entry.hwnd);
      entry.hwnd = null;
    }
    sendNativeStatus(entry.workspaceId, entry.accountIndex, 'warning', `Não foi possível encaixar a janela: ${error.message}`);
  } finally {
    entry.polling = false;
  }
}
function finishNativeProgram(entry, state, message) {
  if (entry.pollTimer) clearInterval(entry.pollTimer);
  if (entry.hwnd) nativeWindows.disconnectInput(entry.hwnd).catch(() => {});
  if (entry.hwnd) reservedNativeHandles.delete(entry.hwnd);
  nativeApps.delete(entry.key);
  sendNativeStatus(entry.workspaceId, entry.accountIndex, state, message);
}
async function launchNativeProgram(workspaceId, accountIndex, executable, args, windowTitle = '') {
  if (process.platform !== 'win32') return { ok: false, error: 'Aplicativos instalados em painéis estão disponíveis no Windows.' };
  if (!validWorkspaceId(workspaceId) || !validAccountIndex(accountIndex)) return { ok: false, error: 'Painel inválido.' };
  if (typeof executable !== 'string' || !path.isAbsolute(executable) || path.extname(executable).toLowerCase() !== '.exe') {
    return { ok: false, error: 'Selecione o caminho completo de um executável .exe.' };
  }
  if (!require('node:fs').existsSync(executable)) return { ok: false, error: 'O executável selecionado não existe mais.' };
  if (!Array.isArray(args) || args.length > 48 || args.some((value) => typeof value !== 'string' || value.length > 2048)) {
    return { ok: false, error: 'A lista de argumentos é inválida.' };
  }
  if (typeof windowTitle !== 'string' || windowTitle.length > 128) return { ok: false, error: 'O título da janela alvo é inválido.' };
  const key = nativeAppKey(workspaceId, accountIndex);
  if (nativeApps.has(key)) return { ok: false, error: 'Este painel já tem um aplicativo em execução.' };

  let knownHandles;
  try {
    knownHandles = new Set((await nativeWindows.listWindows()).map((windowInfo) => String(windowInfo.hwnd)));
  } catch (error) {
    return { ok: false, error: `Não foi possível preparar a integração com janelas do Windows: ${error.message}` };
  }
  let child;
  try {
    child = spawn(executable, args, { cwd: path.dirname(executable), windowsHide: false, stdio: 'ignore' });
  } catch (error) {
    return { ok: false, error: `Não foi possível iniciar: ${error.message}` };
  }
  const entry = { key, workspaceId, accountIndex, child, hwnd: null, targetPid: null, originalBounds: null, knownHandles, rejectedHandles: new Set(), processIds: new Set(child.pid ? [Number(child.pid)] : []), windowTitle, startedAt: Date.now(), pollTimer: null, polling: false, warnedNoWindow: false, ownsProcess: true };
  nativeApps.set(key, entry);
  child.once('spawn', () => {
    sendNativeStatus(workspaceId, accountIndex, 'loading', 'Aguardando a janela do aplicativo');
    entry.pollTimer = setInterval(() => pollNativeAppWindow(entry), 1000);
    entry.pollTimer.unref?.();
    pollNativeAppWindow(entry);
  });
  child.once('error', (error) => {
    finishNativeProgram(entry, 'error', `Falha ao iniciar o aplicativo: ${error.message}`);
  });
  child.once('exit', (code) => {
    if (!nativeApps.has(key)) return;
    entry.childExited = true;
    if (entry.hwnd && entry.targetPid !== child.pid) {
      sendNativeStatus(workspaceId, accountIndex, 'ready', 'O iniciador encerrou; a janela do aplicativo continua ativa');
      return;
    }
    if (!entry.hwnd) {
      const exitNote = code === 0 ? '' : ` (código ${code ?? 'desconhecido'})`;
      sendNativeStatus(workspaceId, accountIndex, 'warning', `O iniciador encerrou${exitNote}; procurando a janela do aplicativo.`);
      return;
    }
    finishNativeProgram(entry, 'closed', code === 0 ? 'Aplicativo encerrado' : `Aplicativo encerrado (código ${code ?? 'desconhecido'})`);
  });
  return { ok: true };
}
async function stopNativeProgram(workspaceId, accountIndex) {
  const entry = nativeApps.get(nativeAppKey(workspaceId, accountIndex));
  if (!entry) return { ok: true };
  if (entry.ownsProcess === false) {
    try { if (entry.hwnd && await nativeWindows.isWindow(entry.hwnd)) await nativeWindows.detach(entry.hwnd, entry.originalBounds, entry.originalStyle, entry.originalParent); } catch {}
    finishNativeProgram(entry, 'closed', 'Janela desencaixada; o aplicativo continua aberto');
    return { ok: true };
  }
  if (entry.hwnd) {
    try { await nativeWindows.closeWindow(entry.hwnd); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      if (await nativeWindows.isWindow(entry.hwnd)) {
        await nativeWindows.detach(entry.hwnd, entry.originalBounds, entry.originalStyle, entry.originalParent);
      }
    } catch {}
  }
  if (entry.child.exitCode === null) entry.child.kill();
  finishNativeProgram(entry, 'closed', 'Aplicativo fechado');
  return { ok: true };
}
async function listAttachableWindows() {
  if (process.platform !== 'win32') return [];
  const windows = await nativeWindows.listWindows();
  const unsupportedHosts = new Set(['applicationframehost', 'runtimebroker', 'searchhost', 'searchapp', 'shellexperiencehost', 'startmenuexperiencehost', 'textinputhost', 'lockapp', 'dwm']);
  const isCompatibleCandidate = (item) => {
    const style = Number(item.style) >>> 0;
    const bounds = item.bounds || {};
    const processName = String(item.processName || '').toLowerCase();
    return Boolean(item.title && item.executable && path.isAbsolute(item.executable)
      && Number(item.pid) !== Number(process.pid)
      && !unsupportedHosts.has(processName)
      && !reservedNativeHandles.has(String(item.hwnd))
      && String(item.parent || '0') === '0'
      && (style & 0x10000000) !== 0 // WS_VISIBLE
      && (style & 0x40000000) === 0 // not WS_CHILD
      && Number(bounds.width) >= 280 && Number(bounds.height) >= 160);
  };
  return windows
    .filter((item) => item.title && Number(item.pid) !== Number(process.pid))
    .map((item) => {
      const compatible = isCompatibleCandidate(item);
      const style = Number(item.style) >>> 0;
      const processName = String(item.processName || '').toLowerCase();
      let compatibilityReason = 'Não compatível: janela não atende aos requisitos de incorporação.';
      if (compatible) compatibilityReason = 'Compatível com o encaixe no painel do Sincronize.';
      else if (!item.executable || !path.isAbsolute(item.executable)) compatibilityReason = 'Não compatível: caminho do aplicativo indisponível.';
      else if (unsupportedHosts.has(processName)) compatibilityReason = 'Não compatível: janela auxiliar do Windows.';
      else if (reservedNativeHandles.has(String(item.hwnd))) compatibilityReason = 'Não compatível: janela já está encaixada.';
      else if (String(item.parent || '0') !== '0' || (style & 0x40000000) !== 0) compatibilityReason = 'Não compatível: janela filha ou incorporada.';
      else if ((style & 0x10000000) === 0) compatibilityReason = 'Não compatível: janela não está visível.';
      else if (Number(item.bounds?.width) < 280 || Number(item.bounds?.height) < 160) compatibilityReason = 'Não compatível: janela menor que 280 × 160.';
      return {
        hwnd: String(item.hwnd), pid: Number(item.pid), processName: String(item.processName || ''),
        executable: String(item.executable || ''), title: String(item.title || ''), compatible, compatibilityReason
      };
    });
}
async function attachExistingWindow(workspaceId, accountIndex, hwnd) {
  if (process.platform !== 'win32') return { ok: false, error: 'Esta função está disponível no Windows.' };
  if (!validWorkspaceId(workspaceId) || !validAccountIndex(accountIndex) || typeof hwnd !== 'string' || !/^\d{1,20}$/.test(hwnd)) return { ok: false, error: 'Janela inválida.' };
  const key = nativeAppKey(workspaceId, accountIndex);
  if (nativeApps.has(key)) return { ok: false, error: 'Este painel já tem um aplicativo associado.' };
  const unsupportedHosts = new Set(['applicationframehost', 'runtimebroker', 'searchhost', 'searchapp', 'shellexperiencehost', 'startmenuexperiencehost', 'textinputhost', 'lockapp', 'dwm']);
  const candidate = (await nativeWindows.listWindows()).find((item) => {
    if (String(item.hwnd) !== hwnd || !item.title || !item.executable || !path.isAbsolute(item.executable)) return false;
    if (Number(item.pid) === Number(process.pid) || reservedNativeHandles.has(hwnd)) return false;
    if (unsupportedHosts.has(String(item.processName || '').toLowerCase()) || String(item.parent || '0') !== '0') return false;
    const style = Number(item.style) >>> 0;
    return (style & 0x10000000) !== 0 && (style & 0x40000000) === 0 && Number(item.bounds?.width) >= 280 && Number(item.bounds?.height) >= 160;
  });
  if (!candidate || Number(candidate.pid) === Number(process.pid) || reservedNativeHandles.has(hwnd)) return { ok: false, error: 'A janela escolhida não está mais disponível.' };
  const entry = { key, workspaceId, accountIndex, child: null, hwnd: null, targetPid: null, originalBounds: null, knownHandles: new Set(), rejectedHandles: new Set(), windowTitle: '', startedAt: Date.now(), pollTimer: null, polling: false, warnedNoWindow: false, ownsProcess: false };
  nativeApps.set(key, entry);
  try {
    const result = await attachNativeWindow(entry, candidate);
    if (!result?.ok) throw new Error('O Windows não conseguiu encaixar essa janela. Apps elevados, exclusivos ou que não permitem incorporação não são compatíveis.');
    sendNativeStatus(workspaceId, accountIndex, 'loading', `Integrando ${candidate.processName || candidate.title} ao painel`);
    entry.pollTimer = setInterval(() => pollNativeAppWindow(entry), 500);
    entry.pollTimer.unref?.();
    return { ok: true };
  } catch (error) {
    try { if (entry.hwnd && await nativeWindows.isWindow(entry.hwnd)) await nativeWindows.detach(entry.hwnd, entry.originalBounds, entry.originalStyle, entry.originalParent); } catch {}
    reservedNativeHandles.delete(entry.hwnd);
    nativeApps.delete(key);
    return { ok: false, error: error.message };
  }
}
async function detachNativeApps() {
  const entries = [...nativeApps.values()];
  await Promise.all(entries.map(async (entry) => {
    if (entry.pollTimer) clearInterval(entry.pollTimer);
    if (entry.hwnd && entry.originalBounds) {
      try { await nativeWindows.detach(entry.hwnd, entry.originalBounds, entry.originalStyle, entry.originalParent); } catch {}
      reservedNativeHandles.delete(entry.hwnd);
    }
  }));
  nativeWindows.close();
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
  view.webContents.on('did-start-loading', () => sendPaneStatus(workspaceId, accountIndex, 'loading', 'Carregando página'));
  view.webContents.on('did-finish-load', () => {
    if (view.webContents.getURL() !== 'about:blank') {
      sendPaneStatus(workspaceId, accountIndex, 'ready', 'Página carregada · confira a sessão');
    }
  });
  view.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) sendPaneStatus(workspaceId, accountIndex, 'error', `Falha ao carregar: ${description}`);
  });
  view.webContents.on('render-process-gone', () => sendPaneStatus(workspaceId, accountIndex, 'error', 'O processo da página foi encerrado'));
  view.webContents.on('unresponsive', () => sendPaneStatus(workspaceId, accountIndex, 'warning', 'Página sem resposta'));
  view.webContents.on('responsive', () => sendPaneStatus(workspaceId, accountIndex, 'ready', 'Página responsiva'));
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
  layoutsByWorkspace.set(workspaceId, layout);
  lastLayoutWorkspaceId = workspaceId;

  if (modalOverlayOpen) {
    for (const views of viewsByWorkspace.values()) {
      views.forEach((view) => {
        if (view && !view.webContents.isDestroyed()) view.setVisible(false);
      });
    }
    for (const entry of nativeApps.values()) if (entry.hwnd) hideNativeEntry(entry).catch(() => {});
    return;
  }

  // Inactive workspaces stay alive in background:
  // Hide their native views, but do not navigate away, destroy them, mute them, or collapse bounds to 1x1.
  for (const [otherWorkspaceId, views] of viewsByWorkspace) {
    if (otherWorkspaceId === workspaceId) continue;
    views.forEach((view) => {
      if (!view || view.webContents.isDestroyed()) return;
      view.setVisible(false);
      view.setBounds(OFFSCREEN_BOUNDS);
    });
  }
  for (const entry of nativeApps.values()) {
    if (entry.workspaceId !== workspaceId && entry.hwnd) {
      hideNativeEntry(entry).catch(() => {});
    }
  }

  layout.forEach((entry, accountIndex) => {
    if (!entry || ![entry.x, entry.y, entry.width, entry.height].every(Number.isFinite)) return;
    const appEntry = nativeApps.get(nativeAppKey(workspaceId, accountIndex));
    if (entry.mode === 'app') {
      const existingView = viewsByWorkspace.get(workspaceId)?.[accountIndex];
      if (existingView && !existingView.webContents.isDestroyed()) {
        existingView.setVisible(false);
        existingView.setBounds(OFFSCREEN_BOUNDS);
      }
      if (appEntry?.hwnd) {
        const visible = entry.visible === true && entry.width > 0 && entry.height > 0;
        positionNativeEntry(appEntry).then((result) => {
          if (!result?.ok) {
            sendNativeStatus(workspaceId, accountIndex, 'warning', 'O Windows não conseguiu atualizar a imagem deste painel.');
          } else if (visible && !appEntry.nativeReadySent) {
            appEntry.nativeReadySent = true;
            sendNativeStatus(workspaceId, accountIndex, 'ready', 'Janela conectada ao painel');
          }
        }).catch((error) => sendNativeStatus(workspaceId, accountIndex, 'warning', `Não foi possível posicionar a janela: ${error.message}`));
      } else if (existingView && !existingView.webContents.isDestroyed()) {
        existingView.setVisible(false);
        existingView.setBounds(OFFSCREEN_BOUNDS);
      }
      return;
    }
    if (appEntry?.hwnd) hideNativeEntry(appEntry).catch(() => {});
    
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
      sendPaneStatus(workspaceId, accountIndex, 'loading', 'Carregando página');
    } else if (view.webContents.getURL() !== 'about:blank') {
      sendPaneStatus(workspaceId, accountIndex, 'ready', 'Sessão mantida em execução');
    }
  });
}

function setOverlayOpenFromRenderer(event, isOpen) {
  if (!isMainRenderer(event)) return;
  const next = Boolean(isOpen);
  if (next === modalOverlayOpen) return;
  modalOverlayOpen = next;
  if (modalOverlayOpen) {
    for (const views of viewsByWorkspace.values()) {
      views.forEach((view) => {
        if (view && !view.webContents.isDestroyed()) view.setVisible(false);
      });
    }
    for (const entry of nativeApps.values()) if (entry.hwnd) hideNativeEntry(entry).catch(() => {});
    return;
  }
  const layout = lastLayoutWorkspaceId && layoutsByWorkspace.get(lastLayoutWorkspaceId);
  if (layout) setPaneLayout(lastLayoutWorkspaceId, layout);
}

async function navigatePane(workspaceId, accountIndex, rawUrl, force = false) {
  const url = validateUrl(rawUrl);
  if (!url) return false;
  const view = getOrCreatePane(workspaceId, accountIndex);
  if (!view || view.webContents.isDestroyed()) return false;
  urlsByWorkspace.get(workspaceId)[accountIndex] = url;

  const currentUrl = view.webContents.getURL();
  // When force is false, leave an already loaded session untouched during workspace switches.
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

async function destroyWorkspaceViews(workspaceId) {
  if (workspaceId === POKE_WORKSPACE_ID) return false;
  const workspaceApps = [...nativeApps.values()].filter((entry) => entry.workspaceId === workspaceId);
  await Promise.all(workspaceApps.map((entry) => stopNativeProgram(workspaceId, entry.accountIndex)));
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
  layoutsByWorkspace.delete(workspaceId);
  return true;
}

function setPaneLayoutFromRenderer(event, workspaceId, layout) {
  if (isMainRenderer(event)) setPaneLayout(workspaceId, layout);
}

function registerIpcHandlers() {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;
  ipcMain.on('board:set-pane-layout', setPaneLayoutFromRenderer);
  ipcMain.on('board:set-overlay-open', setOverlayOpenFromRenderer);
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
      hasShadow: false,
      thickFrame: false,
      backgroundColor: '#080e17',
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
  ipcMain.handle('board:pick-program', async (event) => {
    if (!isMainRenderer(event) || process.platform !== 'win32') return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolher aplicativo instalado',
      properties: ['openFile'],
      filters: [{ name: 'Aplicativos do Windows', extensions: ['exe'] }]
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle('board:list-open-programs', (event) => {
    if (!isMainRenderer(event)) return [];
    return listAttachableWindows();
  });
  ipcMain.handle('board:attach-open-program', (event, workspaceId, accountIndex, hwnd) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Origem do pedido inválida.' };
    return attachExistingWindow(workspaceId, accountIndex, hwnd);
  });
  ipcMain.handle('board:launch-program', (event, workspaceId, accountIndex, executable, args, windowTitle) => {
    if (!isMainRenderer(event)) return { ok: false, error: 'Origem do pedido inválida.' };
    return launchNativeProgram(workspaceId, accountIndex, executable, args, windowTitle);
  });
  ipcMain.handle('board:stop-program', (event, workspaceId, accountIndex) => {
    if (!isMainRenderer(event) || !validWorkspaceId(workspaceId) || !validAccountIndex(accountIndex)) return { ok: false };
    return stopNativeProgram(workspaceId, accountIndex);
  });
  ipcMain.handle('board:clear-workspace-cache', async (event, workspaceId) => {
    if (!isMainRenderer(event)) throw new Error('Origem do pedido inválida.');
    return clearWorkspaceCache(workspaceId);
  });
  ipcMain.handle('board:remove-workspace', async (event, workspaceId) => {
    if (!isMainRenderer(event)) throw new Error('Origem do pedido inválida.');
    return destroyWorkspaceViews(workspaceId);
  });
}

function createMainWindow() {
  // DirectComposition Flip Model: Janela otimizada sem duplicação de camadas alfa
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 920,
    minHeight: 640,
    show: true,
    skipTaskbar: false,
    backgroundColor: '#080e17',
    icon: path.join(__dirname, '..', 'assets', 'sincronize.ico'),
    hasShadow: false,
    thickFrame: false,
    title: 'Sincronize — Abas e aplicativos',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.once('ready-to-show', () => {
    showMainWindow(true);
  });
  mainWindow.on('restore', () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMaximized()) mainWindow.maximize();
  });
  registerIpcHandlers();
  mainWindow.on('resize', () => {
    if (!mainWindow.webContents.isLoading()) mainWindow.webContents.send('board:request-layout');
  });
  mainWindow.webContents.on('did-finish-load', () => mainWindow.webContents.send('board:request-layout'));
  mainWindow.on('close', (event) => {
    if (!nativeApps.size || nativeWindowsDetached) return;
    event.preventDefault();
    if (nativeClosePending) return;
    nativeClosePending = true;
    detachNativeApps().finally(() => {
      nativeWindowsDetached = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const views of viewsByWorkspace.values()) {
      for (const view of views) {
        if (view && !view.webContents.isDestroyed()) view.webContents.close();
      }
    }
    viewsByWorkspace.clear();
    urlsByWorkspace.clear();
    layoutsByWorkspace.clear();
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
}
