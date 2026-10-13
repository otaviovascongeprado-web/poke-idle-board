const STORAGE_KEY = 'poke-idle-board.workspaces.v3';
const LEGACY_STORAGE_KEY = 'poke-idle-board.settings.v2';
const POKE_WORKSPACE_ID = 'poke-idle';
const GAME_URL = 'https://poke.idleworld.online/play';
const POKE_NAMES = ['Azulon', 'Verdeira', 'Rubi', 'Prism'];
const ACCOUNT_COUNT = 4;
const desktopBridge = window.isolatedBoard || null;

function makeSettings(isPokeWorkspace = false, source = {}) {
  const base = {
    names: isPokeWorkspace ? POKE_NAMES : Array.from({ length: ACCOUNT_COUNT }, (_, i) => `Conta ${String(i + 1).padStart(2, '0')}`),
    urls: Array(ACCOUNT_COUNT).fill(isPokeWorkspace ? GAME_URL : ''),
    hidden: [],
    slots: [0, 1, 2, 3],
    focused: null,
    rightColumnHidden: false,
    leftPercent: 50,
    topPercent: 50
  };
  const settings = { ...base, ...source };
  settings.names = Array.from({ length: ACCOUNT_COUNT }, (_, i) =>
    typeof source.names?.[i] === 'string' && source.names[i].trim() ? source.names[i].trim().slice(0, 32) : base.names[i]
  );
  settings.urls = Array.from({ length: ACCOUNT_COUNT }, (_, i) =>
    typeof source.urls?.[i] === 'string' ? source.urls[i] : base.urls[i]
  );
  settings.hidden = Array.isArray(source.hidden)
    ? [...new Set(source.hidden.filter((i) => Number.isInteger(i) && i >= 0 && i < ACCOUNT_COUNT))]
    : [];
  const slots = Array.isArray(source.slots) ? source.slots : [];
  settings.slots = slots.length === ACCOUNT_COUNT && new Set(slots).size === ACCOUNT_COUNT && slots.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < ACCOUNT_COUNT)
    ? slots
    : [0, 1, 2, 3];
  settings.focused = Number.isInteger(source.focused) && source.focused >= 0 && source.focused < ACCOUNT_COUNT ? source.focused : null;
  settings.rightColumnHidden = source.rightColumnHidden === true;
  settings.leftPercent = Number.isFinite(source.leftPercent) ? Math.min(78, Math.max(22, source.leftPercent)) : 50;
  settings.topPercent = Number.isFinite(source.topPercent) ? Math.min(78, Math.max(22, source.topPercent)) : 50;
  return settings;
}

function makeWorkspace(id, title, settings) {
  return {
    id,
    title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 40) : 'Novo jogo',
    settings: makeSettings(id === POKE_WORKSPACE_ID, settings)
  };
}

function readAppData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && Array.isArray(saved.workspaces)) {
      const ids = new Set();
      const workspaces = saved.workspaces
        .filter((ws) => ws && typeof ws.id === 'string' && /^[a-z0-9-]{1,64}$/.test(ws.id) && !ids.has(ws.id) && ids.add(ws.id))
        .map((ws) => makeWorkspace(ws.id, ws.title, ws.settings));
      if (workspaces.length) {
        if (!workspaces.some((ws) => ws.id === POKE_WORKSPACE_ID)) {
          workspaces.unshift(makeWorkspace(POKE_WORKSPACE_ID, 'Poke Idle'));
        }
        return {
          activeWorkspaceId: workspaces.some((ws) => ws.id === saved.activeWorkspaceId) ? saved.activeWorkspaceId : workspaces[0].id,
          workspaces
        };
      }
    }
  } catch {
    /* migrate old preferences */
  }
  let legacy = {};
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || '{}') || {};
  } catch {
    /* defaults */
  }
  return {
    activeWorkspaceId: POKE_WORKSPACE_ID,
    workspaces: [makeWorkspace(POKE_WORKSPACE_ID, 'Poke Idle', legacy)]
  };
}

let appData = readAppData();
let activeWorkspace = appData.workspaces.find((ws) => ws.id === appData.activeWorkspaceId) || appData.workspaces[0];
let settings = activeWorkspace.settings;

const grid = document.querySelector('.screen-grid');
const windows = [...document.querySelectorAll('.game-window')];
const workspaceList = document.getElementById('workspaceList');
const workspaceCount = document.getElementById('workspaceCount');
const activeWorkspaceTitle = document.getElementById('activeWorkspaceTitle');
const renameDialog = document.getElementById('renameDialog');
const renameInput = document.getElementById('renameInput');
const workspaceNameDialog = document.getElementById('workspaceNameDialog');
const workspaceNameInput = document.getElementById('workspaceNameInput');

let renamingAccountIndex = null;
let renamingWorkspaceId = null;
let layoutFrame = 0;

const byAccount = (i) => windows.find((el) => Number(el.dataset.accountIndex) === i);
const findWorkspace = (id) => appData.workspaces.find((ws) => ws.id === id);

function normalizeUrl(value) {
  const text = value.trim();
  if (!text) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function saveActiveWorkspaceSettings() {
  settings.hidden = windows.filter((el) => el.classList.contains('is-hidden')).map((el) => Number(el.dataset.accountIndex));
  settings.slots = windows.map((el) => Number(el.dataset.slot));
  settings.urls = windows.map((el) => el.querySelector('.site-url').value);
  settings.names = windows.map((el) => el.querySelector('.window-meta strong').textContent);
  activeWorkspace.settings = { ...settings };
}

function saveAppData() {
  saveActiveWorkspaceSettings();
  appData.activeWorkspaceId = activeWorkspace.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

function setPaneStatus(windowEl, message, state) {
  const status = windowEl.querySelector('.pane-status');
  if (!status) return;
  status.querySelector('.status-label').textContent = message;
  status.dataset.state = state;
}

function paneIsVisible(windowEl) {
  const index = Number(windowEl.dataset.accountIndex);
  if (settings.hidden.includes(index)) return false;
  if (settings.focused !== null && settings.focused !== index) return false;
  if (settings.rightColumnHidden && [1, 3].includes(Number(windowEl.dataset.slot))) return false;
  return true;
}

function syncNativePaneLayout() {
  if (!desktopBridge) return;
  const layout = windows.map((windowEl) => {
    const bounds = windowEl.querySelector('.frame-shell').getBoundingClientRect();
    const visible = paneIsVisible(windowEl) && getComputedStyle(windowEl).display !== 'none' && bounds.width > 0 && bounds.height > 0;
    return {
      accountIndex: Number(windowEl.dataset.accountIndex),
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
      visible
    };
  });
  desktopBridge.setPaneLayout(activeWorkspace.id, layout);
}

function scheduleNativePaneLayout() {
  if (!desktopBridge || layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    syncNativePaneLayout();
  });
}

// Initial navigation only: force=false ensures running game sessions NEVER reload on workspace switch!
function initWorkspacePanes(workspace) {
  if (!desktopBridge) return;
  workspace.settings.urls.forEach((savedUrl, index) => {
    const url = normalizeUrl(savedUrl || '');
    if (!url) {
      if (workspace.id === activeWorkspace.id) setPaneStatus(byAccount(index), 'Adicione o endereço deste jogo', '');
      return;
    }
    desktopBridge.navigatePane(workspace.id, index, url, false).then((ok) => {
      if (!ok && workspace.id === activeWorkspace.id) setPaneStatus(byAccount(index), 'Não foi possível abrir este endereço', 'error');
    }).catch(() => {
      if (workspace.id === activeWorkspace.id) setPaneStatus(byAccount(index), 'Falha ao abrir a sessão', 'error');
    });
  });
}

function applyLayout() {
  grid.classList.toggle('focus-mode', settings.focused !== null);
  grid.classList.toggle('right-column-hidden', settings.rightColumnHidden);

  windows.forEach((el) => {
    const index = Number(el.dataset.accountIndex);
    const slot = Number(settings.slots[index] ?? index);
    const name = settings.names[index];
    const savedUrl = settings.urls[index];

    el.classList.toggle('is-hidden', settings.hidden.includes(index));
    el.classList.toggle('is-focused', settings.focused === index || (settings.focused === null && index === 0));
    el.classList.toggle('is-right-column', [1, 3].includes(slot));
    el.classList.toggle('is-left-top', slot === 0);
    el.classList.toggle('is-left-bottom', slot === 2);

    el.dataset.slot = String(slot);
    el.style.setProperty('--mobile-order', String(slot));
    el.querySelector('.window-meta strong').textContent = name;
    el.querySelector('.site-url').value = savedUrl;

    el.querySelector('.frame-placeholder strong').textContent = savedUrl ? `Sessão isolada · ${name}` : `Configure a URL · ${name}`;
    el.querySelector('.frame-placeholder a').href = normalizeUrl(savedUrl || '') || GAME_URL;
    el.querySelector('.frame-placeholder a').hidden = !savedUrl;
    el.querySelector('.frame-placeholder > span:not(.placeholder-icon)').textContent = savedUrl
      ? 'A sessão desta conta continua ativa mesmo quando outra aba de jogo está aberta.'
      : 'Abra Endereços, informe a URL do jogo e selecione Abrir.';
  });

  grid.style.setProperty('--left-fr', `${settings.leftPercent}fr`);
  grid.style.setProperty('--right-fr', `${100 - settings.leftPercent}fr`);
  grid.style.setProperty('--top-fr', `${settings.topPercent}fr`);
  grid.style.setProperty('--bottom-fr', `${100 - settings.topPercent}fr`);

  activeWorkspaceTitle.textContent = activeWorkspace.title;
  document.getElementById('columnToggle').innerHTML = `<span>◫</span> ${settings.rightColumnHidden ? 'Mostrar coluna direita' : 'Coluna direita'}`;
  document.getElementById('focusAll').innerHTML = `<span>▦</span> ${settings.focused === null ? 'Grade 2 × 2' : 'Voltar à grade'}`;
  document.getElementById('visibleCount').textContent = String(windows.filter(paneIsVisible).length).padStart(2, '0');

  scheduleNativePaneLayout();
}

function deleteWorkspace(id) {
  if (id === POKE_WORKSPACE_ID) return;
  const ws = findWorkspace(id);
  if (!ws) return;
  if (!window.confirm(`Excluir a aba "${ws.title}"? Todas as sessões deste jogo serão fechadas e sua memória RAM será liberada imediatamente.`)) return;

  if (desktopBridge?.removeWorkspace) {
    desktopBridge.removeWorkspace(id);
  }

  appData.workspaces = appData.workspaces.filter((w) => w.id !== id);
  if (activeWorkspace.id === id) {
    activeWorkspace = appData.workspaces[0];
    appData.activeWorkspaceId = activeWorkspace.id;
    syncPaneFieldsFromWorkspace();
  }
  renderWorkspaces();
  applyLayout();
  saveAppData();
}

function renderWorkspaces() {
  workspaceList.replaceChildren();
  workspaceCount.textContent = String(appData.workspaces.length).padStart(2, '0');

  appData.workspaces.forEach((workspace, index) => {
    const row = document.createElement('div');
    row.className = `workspace-tab${workspace.id === activeWorkspace.id ? ' is-active' : ''}`;

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'workspace-select';
    select.setAttribute('aria-current', workspace.id === activeWorkspace.id ? 'page' : 'false');

    const icon = document.createElement('span');
    icon.className = 'workspace-tab-icon';
    icon.textContent = String(index + 1).padStart(2, '0');

    const title = document.createElement('span');
    title.className = 'workspace-tab-title';
    title.textContent = workspace.title;

    select.append(icon, title);
    select.addEventListener('click', () => switchWorkspace(workspace.id));

    const actions = document.createElement('div');
    actions.className = 'workspace-tab-actions';

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.title = `Renomear ${workspace.title}`;
    rename.setAttribute('aria-label', `Renomear ${workspace.title}`);
    rename.textContent = '✎';
    rename.addEventListener('click', () => openWorkspaceRename(workspace));
    actions.append(rename);

    if (workspace.id !== POKE_WORKSPACE_ID) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'workspace-delete-btn';
      del.title = `Excluir ${workspace.title}`;
      del.setAttribute('aria-label', `Excluir ${workspace.title}`);
      del.textContent = '✕';
      del.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteWorkspace(workspace.id);
      });
      actions.append(del);
    }

    row.append(select, actions);
    workspaceList.append(row);
  });
}

function syncPaneFieldsFromWorkspace() {
  settings = activeWorkspace.settings;
  activeWorkspaceTitle.textContent = activeWorkspace.title;
}

function switchWorkspace(id) {
  if (id === activeWorkspace.id) return;
  const target = findWorkspace(id);
  if (!target) return;

  saveActiveWorkspaceSettings();
  activeWorkspace = target;
  appData.activeWorkspaceId = target.id;

  syncPaneFieldsFromWorkspace();
  renderWorkspaces();
  applyLayout();
  saveAppData();

  // Load only uninitialized slots (does not reload already running games)
  initWorkspacePanes(target);
}

function createWorkspaceId() {
  return `game-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function addWorkspace() {
  saveActiveWorkspaceSettings();
  const ws = makeWorkspace(createWorkspaceId(), 'Novo jogo', makeSettings(false));
  appData.workspaces.push(ws);
  activeWorkspace = ws;
  appData.activeWorkspaceId = ws.id;

  syncPaneFieldsFromWorkspace();
  renderWorkspaces();
  applyLayout();
  saveAppData();
}

function openWorkspaceRename(ws) {
  renamingWorkspaceId = ws.id;
  workspaceNameInput.value = ws.title;
  workspaceNameDialog.showModal();
  workspaceNameInput.focus();
  workspaceNameInput.select();
}

function openAccountRename(index) {
  renamingAccountIndex = index;
  renameInput.value = settings.names[index];
  renameDialog.showModal();
  renameInput.focus();
  renameInput.select();
}

function applyUrl(windowEl) {
  const index = Number(windowEl.dataset.accountIndex);
  const input = windowEl.querySelector('.site-url');
  const url = normalizeUrl(input.value);

  if (!url) {
    input.setCustomValidity('Informe uma URL válida começando por http:// ou https://.');
    input.reportValidity();
    return;
  }

  input.setCustomValidity('');
  input.value = url;
  settings.urls[index] = url;
  setPaneStatus(windowEl, 'Carregando endereço solicitado', 'loading');

  if (desktopBridge) {
    // force=true: user explicitly clicked 'Abrir'
    desktopBridge.navigatePane(activeWorkspace.id, index, url, true).then((ok) => {
      if (!ok) setPaneStatus(windowEl, 'Endereço recusado: use HTTP ou HTTPS', 'error');
    }).catch(() => {
      setPaneStatus(windowEl, 'Falha ao abrir esta sessão', 'error');
    });
  }
  saveAppData();
}

function setFocusedPane(index) {
  settings.hidden = settings.hidden.filter((hiddenIndex) => hiddenIndex !== index);
  settings.rightColumnHidden = false;
  settings.focused = settings.focused === index ? null : index;
  applyLayout();
  saveAppData();
}

function handleDrop(sourceIndex, targetIndex) {
  if (sourceIndex === targetIndex) return;
  const source = byAccount(sourceIndex);
  const target = byAccount(targetIndex);
  if (!source || !target) return;

  const sourceSlot = Number(source.dataset.slot);
  source.dataset.slot = target.dataset.slot;
  target.dataset.slot = String(sourceSlot);

  settings.slots[sourceIndex] = Number(source.dataset.slot);
  settings.slots[targetIndex] = Number(target.dataset.slot);

  applyLayout();
  saveAppData();
}

windows.forEach((windowEl, index) => {
  windowEl.dataset.slot = String(settings.slots[index]);
  windowEl.querySelector('.load-site-btn').addEventListener('click', () => applyUrl(windowEl));
  windowEl.querySelector('.site-url').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyUrl(windowEl);
  });
  windowEl.querySelector('.window-actions').addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'rename') openAccountRename(index);
    if (action === 'focus') setFocusedPane(index);
    if (action === 'hide') {
      settings.hidden = [...new Set([...settings.hidden, index])];
      if (settings.focused === index) settings.focused = null;
      applyLayout();
      saveAppData();
    }
    if (action === 'open') {
      const url = normalizeUrl(settings.urls[index] || '');
      if (!url) return;
      if (desktopBridge) desktopBridge.openPaneWindow(activeWorkspace.id, index, url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    }
  });

  const chrome = windowEl.querySelector('.window-chrome');
  chrome.draggable = true;
  chrome.addEventListener('dragstart', (event) => {
    if (event.target.closest('button')) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData('application/x-session-deck-account', String(index));
    event.dataTransfer.effectAllowed = 'move';
  });
  windowEl.addEventListener('dragover', (event) => event.preventDefault());
  windowEl.addEventListener('drop', (event) => {
    const payload = event.dataTransfer.getData('application/x-session-deck-account');
    if (!/^[0-3]$/.test(payload)) return;
    event.preventDefault();
    handleDrop(Number(payload), index);
  });
});

renameDialog.addEventListener('close', () => {
  const name = renameInput.value.trim();
  if (renameDialog.returnValue !== 'save' || !name || renamingAccountIndex === null) return;
  settings.names[renamingAccountIndex] = name.slice(0, 32);
  applyLayout();
  saveAppData();
  renamingAccountIndex = null;
});

workspaceNameDialog.addEventListener('close', () => {
  const title = workspaceNameInput.value.trim();
  if (workspaceNameDialog.returnValue !== 'save' || !title || !renamingWorkspaceId) return;
  const ws = findWorkspace(renamingWorkspaceId);
  if (ws) {
    ws.title = title.slice(0, 40);
    if (ws.id === activeWorkspace.id) activeWorkspaceTitle.textContent = ws.title;
    renderWorkspaces();
    saveAppData();
  }
  renamingWorkspaceId = null;
});

document.getElementById('addWorkspaceBtn').addEventListener('click', addWorkspace);
document.getElementById('showAll').addEventListener('click', () => {
  settings.hidden = [];
  settings.focused = null;
  settings.rightColumnHidden = false;
  applyLayout();
  saveAppData();
});

document.getElementById('clearCacheAll').addEventListener('click', async () => {
  if (!desktopBridge) {
    window.alert('A limpeza de cache só está disponível no aplicativo desktop Electron.');
    return;
  }
  if (!window.confirm(`Limpar o cache das quatro contas da aba “${activeWorkspace.title}”? Os logins serão preservados, mas os quatro jogos serão recarregados.`)) return;
  const button = document.getElementById('clearCacheAll');
  button.disabled = true;
  try {
    const result = await desktopBridge.clearWorkspaceCache(activeWorkspace.id);
    window.alert(result?.ok ? 'Cache das quatro contas limpo. Os jogos estão recarregando; cookies e logins foram mantidos.' : `Não foi possível limpar o cache: ${result?.error || 'erro desconhecido'}`);
  } catch (error) {
    window.alert(`Falha ao limpar o cache: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

const optimizeBtn = document.getElementById('optimizeMemoryBtn');
if (optimizeBtn) {
  optimizeBtn.addEventListener('click', async () => {
    if (!desktopBridge?.optimizeMemory) {
      window.alert('A otimização de memória só está disponível no aplicativo desktop.');
      return;
    }
    optimizeBtn.disabled = true;
    const originalHtml = optimizeBtn.innerHTML;
    optimizeBtn.innerHTML = '<span>⏳</span> Otimizando...';
    try {
      await desktopBridge.optimizeMemory();
      optimizeBtn.innerHTML = '<span>✓</span> Memória limpa!';
      setTimeout(() => {
        optimizeBtn.innerHTML = originalHtml;
        optimizeBtn.disabled = false;
      }, 2000);
    } catch (error) {
      optimizeBtn.innerHTML = originalHtml;
      optimizeBtn.disabled = false;
      window.alert(`Falha ao otimizar memória: ${error.message}`);
    }
  });
}

document.getElementById('columnToggle').addEventListener('click', () => {
  settings.rightColumnHidden = !settings.rightColumnHidden;
  applyLayout();
  saveAppData();
});

document.getElementById('focusAll').addEventListener('click', () => {
  settings.focused = null;
  settings.rightColumnHidden = false;
  applyLayout();
  saveAppData();
});

document.getElementById('urlToggle').addEventListener('click', (event) => {
  const visible = document.body.classList.toggle('show-site-controls');
  event.currentTarget.innerHTML = `<span>⌁</span> ${visible ? 'Ocultar endereços' : 'Endereços'}`;
  event.currentTarget.setAttribute('aria-expanded', String(visible));
});

function addSplitter(className, axis, label) {
  const splitter = document.createElement('button');
  splitter.type = 'button';
  splitter.className = className;
  splitter.dataset.axis = axis;
  splitter.setAttribute('aria-label', label);
  splitter.title = label;
  grid.append(splitter);
  return splitter;
}

const verticalSplitter = addSplitter('splitter', 'x', 'Arraste para ajustar a largura das colunas');
const horizontalSplitter = addSplitter('splitter', 'y', 'Arraste para ajustar a altura das linhas');
const cornerSplitter = addSplitter('splitter-corner', 'both', 'Arraste para ajustar linhas e colunas');
let activeSplitter = null;

function updateSplit(event) {
  if (!activeSplitter) return;
  const bounds = grid.getBoundingClientRect();
  if (activeSplitter !== horizontalSplitter) settings.leftPercent = Math.min(78, Math.max(22, ((event.clientX - bounds.left) / bounds.width) * 100));
  if (activeSplitter !== verticalSplitter) settings.topPercent = Math.min(78, Math.max(22, ((event.clientY - bounds.top) / bounds.height) * 100));
  grid.style.setProperty('--left-fr', `${settings.leftPercent}fr`);
  grid.style.setProperty('--right-fr', `${100 - settings.leftPercent}fr`);
  grid.style.setProperty('--top-fr', `${settings.topPercent}fr`);
  grid.style.setProperty('--bottom-fr', `${100 - settings.topPercent}fr`);
  scheduleNativePaneLayout();
}

[verticalSplitter, horizontalSplitter, cornerSplitter].forEach((splitter) => {
  splitter.addEventListener('pointerdown', (event) => {
    if (settings.focused !== null || settings.rightColumnHidden) return;
    activeSplitter = splitter;
    splitter.setPointerCapture(event.pointerId);
    event.preventDefault();
    updateSplit(event);
  });
  splitter.addEventListener('pointermove', updateSplit);
  splitter.addEventListener('pointerup', () => {
    if (!activeSplitter) return;
    activeSplitter = null;
    saveAppData();
  });
  splitter.addEventListener('pointercancel', () => {
    activeSplitter = null;
  });
});

if (desktopBridge) {
  desktopBridge.onPaneStatus((payload) => {
    if (payload.workspaceId === activeWorkspace.id) {
      const el = byAccount(payload.accountIndex);
      if (el) setPaneStatus(el, payload.message, payload.state);
    }
  });
  window.addEventListener('resize', scheduleNativePaneLayout, { passive: true });
  desktopBridge.onLayoutRequested(scheduleNativePaneLayout);
  const observer = new ResizeObserver(scheduleNativePaneLayout);
  observer.observe(grid);
  windows.forEach((el) => observer.observe(el.querySelector('.frame-shell')));
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  appData = readAppData();
  activeWorkspace = findWorkspace(appData.activeWorkspaceId) || appData.workspaces[0];
  syncPaneFieldsFromWorkspace();
  renderWorkspaces();
  applyLayout();
  initWorkspacePanes(activeWorkspace);
});

renderWorkspaces();
syncPaneFieldsFromWorkspace();
applyLayout();
initWorkspacePanes(activeWorkspace);
scheduleNativePaneLayout();
