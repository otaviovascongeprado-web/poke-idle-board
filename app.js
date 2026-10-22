const STORAGE_KEY = 'poke-idle-board.workspaces.v3';
const LEGACY_STORAGE_KEY = 'poke-idle-board.settings.v2';
const POKE_WORKSPACE_ID = 'poke-idle';
const GAME_URL = 'https://poke.idleworld.online/play';
const POKE_NAMES = ['Azulon', 'Verdeira', 'Rubi', 'Prism'];
const ACCOUNT_COUNT = 4;
const APPEARANCE_KEY = 'sincronize.appearance.v1';
const APPEARANCES = ['aurora', 'oceano', 'brasa', 'claro', 'bosque'];
const DEFAULT_APPEARANCE_PROFILES = {
  aurora: { name: 'Aurora', background: '#08070d', accent: '#a855f7', surface: '#13101d', text: '#f5f0ff', dock: 'left', controls: 'right', gap: 8, radius: 13 },
  oceano: { name: 'Oceano', background: '#071019', accent: '#20c5e9', surface: '#0d2030', text: '#e8f8ff', dock: 'top', controls: 'below', gap: 10, radius: 10 },
  brasa: { name: 'Brasa', background: '#140d0b', accent: '#f29a38', surface: '#241610', text: '#fff2e7', dock: 'right', controls: 'leading', gap: 5, radius: 8 },
  claro: { name: 'Claro', background: '#e9e8ee', accent: '#6954bd', surface: '#ffffff', text: '#211d2d', dock: 'rail', controls: 'right', gap: 12, radius: 16 },
  bosque: { name: 'Bosque', background: '#07130f', accent: '#43ca89', surface: '#10241b', text: '#effbf2', dock: 'bottom', controls: 'below', gap: 8, radius: 18 }
};
const desktopBridge = window.isolatedBoard || null;

function makeSettings(isPokeWorkspace = false, source = {}) {
  const base = {
    names: isPokeWorkspace ? POKE_NAMES : Array.from({ length: ACCOUNT_COUNT }, (_, i) => `Conta ${String(i + 1).padStart(2, '0')}`),
    urls: Array(ACCOUNT_COUNT).fill(isPokeWorkspace ? GAME_URL : ''),
    modes: Array(ACCOUNT_COUNT).fill('web'),
    programs: Array.from({ length: ACCOUNT_COUNT }, () => ({ path: '', args: [] })),
    hidden: [],
    slots: [0, 1, 2, 3],
    focused: null,
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
  settings.modes = Array.from({ length: ACCOUNT_COUNT }, (_, i) => source.modes?.[i] === 'app' ? 'app' : 'web');
  settings.programs = Array.from({ length: ACCOUNT_COUNT }, (_, i) => {
    const program = source.programs?.[i];
    return {
      path: typeof program?.path === 'string' ? program.path.slice(0, 2048) : '',
      args: Array.isArray(program?.args) ? program.args.filter((arg) => typeof arg === 'string').slice(0, 48).map((arg) => arg.slice(0, 2048)) : [],
      windowTitle: typeof program?.windowTitle === 'string' ? program.windowTitle.slice(0, 128) : ''
    };
  });
  settings.hidden = Array.isArray(source.hidden)
    ? [...new Set(source.hidden.filter((i) => Number.isInteger(i) && i >= 0 && i < ACCOUNT_COUNT))]
    : [];
  const slots = Array.isArray(source.slots) ? source.slots : [];
  settings.slots = slots.length === ACCOUNT_COUNT && new Set(slots).size === ACCOUNT_COUNT && slots.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < ACCOUNT_COUNT)
    ? slots
    : [0, 1, 2, 3];
  settings.focused = Number.isInteger(source.focused) && source.focused >= 0 && source.focused < ACCOUNT_COUNT ? source.focused : null;
  settings.leftPercent = Number.isFinite(source.leftPercent) ? Math.min(78, Math.max(22, source.leftPercent)) : 50;
  settings.topPercent = Number.isFinite(source.topPercent) ? Math.min(78, Math.max(22, source.topPercent)) : 50;
  return settings;
}

function makeWorkspace(id, title, settings, kind = 'site', legacyMixed = false) {
  return {
    id,
    title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 40) : 'Nova aba',
    kind: kind === 'computer' ? 'computer' : 'site',
    legacyMixed: legacyMixed === true,
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
        .map((ws) => makeWorkspace(ws.id, ws.title, ws.settings, ws.kind, ws.legacyMixed === true || (!ws.kind && Array.isArray(ws.settings?.modes) && ws.settings.modes.includes('app'))));
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
let activeCategory = activeWorkspace.kind;
let settings = activeWorkspace.settings;

const grid = document.querySelector('.screen-grid');
const windows = [...document.querySelectorAll('.game-window')];
const workspaceList = document.getElementById('workspaceList');
const workspaceCount = document.getElementById('workspaceCount');
const workspaceSectionLabel = document.getElementById('workspaceSectionLabel');
const activeWorkspaceTitle = document.getElementById('activeWorkspaceTitle');
const renameDialog = document.getElementById('renameDialog');
const renameInput = document.getElementById('renameInput');
const workspaceNameDialog = document.getElementById('workspaceNameDialog');
const workspaceNameInput = document.getElementById('workspaceNameInput');
const programDialog = document.getElementById('programDialog');
const programPathInput = document.getElementById('programPath');
const programArgsInput = document.getElementById('programArgs');
const programWindowTitleInput = document.getElementById('programWindowTitle');
const openWindowList = document.getElementById('openWindowList');
const attachOpenWindowBtn = document.getElementById('attachOpenWindowBtn');
let selectedOpenWindow = null;
const appearanceDialog = document.getElementById('appearanceDialog');
const appearanceFields = {
  name: document.getElementById('appearanceName'),
  background: document.getElementById('appearanceBackground'),
  accent: document.getElementById('appearanceAccent'),
  surface: document.getElementById('appearanceSurface'),
  text: document.getElementById('appearanceText'),
  dock: document.getElementById('appearanceDock'),
  controls: document.getElementById('appearanceControls'),
  gap: document.getElementById('appearanceGap'),
  radius: document.getElementById('appearanceRadius')
};

let renamingAccountIndex = null;
let renamingWorkspaceId = null;
let configuringProgramIndex = null;
let launchAfterProgramSave = false;
const runningPrograms = new Set();
const existingProgramWindows = new Set();
let layoutFrame = 0;
let activeNoticeResolve = null;

function readAppearanceConfig() {
  const profiles = Object.fromEntries(Object.entries(DEFAULT_APPEARANCE_PROFILES).map(([key, profile]) => [key, { ...profile }]));
  let active = 'aurora';
  try {
    const stored = localStorage.getItem(APPEARANCE_KEY);
    let saved = null;
    if (stored) {
      try { saved = JSON.parse(stored); }
      catch { saved = stored; } // migrate the earlier plain-text preset value
    }
    if (typeof saved === 'string') active = saved;
    else if (saved && typeof saved === 'object') {
      if (APPEARANCES.includes(saved.active)) active = saved.active;
      for (const key of APPEARANCES) {
        const source = saved.profiles?.[key];
        if (!source || typeof source !== 'object') continue;
        const target = profiles[key];
        if (typeof source.name === 'string' && source.name.trim()) target.name = source.name.trim().slice(0, 24);
        for (const color of ['background', 'accent', 'surface', 'text']) {
          if (typeof source[color] === 'string' && /^#[0-9a-f]{6}$/i.test(source[color])) target[color] = source[color];
        }
        if (['left', 'top', 'right', 'rail', 'bottom'].includes(source.dock)) target.dock = source.dock;
        if (['right', 'below', 'leading'].includes(source.controls)) target.controls = source.controls;
        if (Number.isFinite(source.gap)) target.gap = Math.round(Math.min(24, Math.max(2, source.gap)));
        if (Number.isFinite(source.radius)) target.radius = Math.round(Math.min(28, Math.max(0, source.radius)));
      }
    }
  } catch { /* use the starter profiles */ }
  return { active: APPEARANCES.includes(active) ? active : 'aurora', profiles };
}

let appearanceConfig = readAppearanceConfig();
let appearanceSaveTimer = null;
let appearanceFrame = 0;
let appearanceNeedsPaneLayout = false;
let appearanceNeedsEditorSync = false;
function saveAppearanceConfig() {
  clearTimeout(appearanceSaveTimer);
  appearanceSaveTimer = setTimeout(() => {
    appearanceSaveTimer = null;
    try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearanceConfig)); } catch { /* storage unavailable */ }
  }, 180);
}
function refreshAppearanceCards() {
  document.querySelectorAll('.appearance-option').forEach((option) => {
    const profile = appearanceConfig.profiles[option.dataset.preset];
    const selected = option.dataset.preset === appearanceConfig.active;
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-pressed', String(selected));
    option.querySelector('strong').textContent = profile.name;
    option.querySelector('small').textContent = `Perfil · navegação ${profile.dock} · personalize cores e controles`;
    option.querySelector('.appearance-swatch').style.background = `linear-gradient(135deg,${profile.accent},${profile.background})`;
  });
}
function renderAppearanceEditor() {
  const profile = appearanceConfig.profiles[appearanceConfig.active];
  refreshAppearanceCards();
  appearanceFields.name.value = profile.name;
  for (const key of ['background', 'accent', 'surface', 'text']) appearanceFields[key].value = profile[key];
  appearanceFields.dock.value = profile.dock;
  appearanceFields.controls.value = profile.controls;
  appearanceFields.gap.value = profile.gap;
  appearanceFields.radius.value = profile.radius;
  document.getElementById('appearanceGapValue').value = `${profile.gap} px`;
  document.getElementById('appearanceRadiusValue').value = `${profile.radius} px`;
}
function applyAppearance(syncEditor = false, updatePaneLayout = false) {
  appearanceNeedsPaneLayout ||= updatePaneLayout;
  appearanceNeedsEditorSync ||= syncEditor;
  if (!appearanceFrame) appearanceFrame = requestAnimationFrame(() => {
    appearanceFrame = 0;
    const profile = appearanceConfig.profiles[appearanceConfig.active];
    const shell = document.querySelector('.app-shell');
    shell.dataset.layout = profile.dock;
    shell.dataset.controls = profile.controls;
    document.body.dataset.theme = appearanceConfig.active;
    document.body.style.setProperty('--bg', profile.background);
    document.body.style.setProperty('--purple', profile.accent);
    document.body.style.setProperty('--purple-bright', profile.accent);
    document.body.style.setProperty('--purple-deep', profile.accent);
    document.body.style.setProperty('--pink', profile.accent);
    document.body.style.setProperty('--panel', profile.surface);
    document.body.style.setProperty('--bg-raised', profile.surface);
    document.body.style.setProperty('--text', profile.text);
    document.body.style.setProperty('--muted', `color-mix(in srgb, ${profile.text} 52%, ${profile.background})`);
    document.body.style.setProperty('--muted-bright', `color-mix(in srgb, ${profile.text} 72%, ${profile.background})`);
    document.body.style.setProperty('--panel-hover', `color-mix(in srgb, ${profile.accent} 10%, ${profile.surface})`);
    document.body.style.setProperty('--line', `color-mix(in srgb, ${profile.accent} 18%, transparent)`);
    document.body.style.setProperty('--line-strong', `color-mix(in srgb, ${profile.accent} 34%, transparent)`);
    shell.style.setProperty('--pane-gap', `${profile.gap}px`);
    shell.style.setProperty('--pane-radius', `${profile.radius}px`);
    if (appearanceNeedsEditorSync) renderAppearanceEditor();
    else {
      const selected = document.querySelector(`.appearance-option[data-preset="${appearanceConfig.active}"] .appearance-swatch`);
      if (selected) selected.style.background = `linear-gradient(135deg,${profile.accent},${profile.background})`;
    }
    if (appearanceNeedsPaneLayout) requestAnimationFrame(scheduleNativePaneLayout);
    appearanceNeedsPaneLayout = false;
    appearanceNeedsEditorSync = false;
  });
  saveAppearanceConfig();
}

applyAppearance(true, true);

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

function showNotice(title, message, options = {}) {
  const dialog = document.getElementById('noticeDialog');
  if (!dialog) return Promise.resolve(false);
  if (dialog.open) return Promise.resolve(false);
  document.getElementById('noticeTitle').textContent = title;
  document.getElementById('noticeMessage').textContent = message;
  document.getElementById('noticeCancel').hidden = options.confirm !== true;
  document.getElementById('noticeAccept').textContent = options.confirm ? (options.acceptLabel || 'Confirmar') : 'Entendi';
  dialog.dataset.tone = options.tone || 'info';
  return new Promise((resolve) => {
    activeNoticeResolve = resolve;
    dialog.showModal();
  });
}

function confirmAction(title, message, acceptLabel = 'Confirmar') {
  return showNotice(title, message, { confirm: true, acceptLabel, tone: 'warning' });
}

const noticeDialog = document.getElementById('noticeDialog');
document.getElementById('noticeCancel').addEventListener('click', () => noticeDialog.close('cancel'));
noticeDialog.addEventListener('cancel', () => { noticeDialog.returnValue = 'cancel'; });
noticeDialog.addEventListener('close', () => {
  const resolve = activeNoticeResolve;
  activeNoticeResolve = null;
  resolve?.(noticeDialog.returnValue === 'accept');
});

function paneIsVisible(windowEl) {
  const index = Number(windowEl.dataset.accountIndex);
  if (settings.hidden.includes(index)) return false;
  if (settings.focused !== null && settings.focused !== index) return false;
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
      scale: window.devicePixelRatio || 1,
      visible,
      mode: settings.modes[Number(windowEl.dataset.accountIndex)]
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
    if (workspace.settings.modes[index] === 'app') return;
    const url = normalizeUrl(savedUrl || '');
    if (!url) {
      if (workspace.id === activeWorkspace.id) setPaneStatus(byAccount(index), 'Adicione um endereço para este painel', '');
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
  activeCategory = activeWorkspace.kind;
  document.querySelectorAll('[data-category]').forEach((item) => {
    const selected = item.dataset.category === activeCategory;
    item.classList.toggle('is-active', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  document.body.classList.toggle('computer-mode', activeWorkspace.kind === 'computer');
  document.body.classList.toggle('site-mode', activeWorkspace.kind !== 'computer');
  document.body.classList.toggle('legacy-mixed-mode', activeWorkspace.legacyMixed === true);
  document.getElementById('urlToggle').hidden = activeWorkspace.kind === 'computer';
  document.getElementById('urlToggle').setAttribute('aria-expanded', String(activeWorkspace.kind !== 'computer' && document.body.classList.contains('show-site-controls')));
  document.getElementById('clearCacheAll').hidden = activeWorkspace.kind === 'computer';
  document.getElementById('workspaceSectionLabel').textContent = activeWorkspace.kind === 'computer' ? 'APLICATIVOS · ABAS' : 'SITES · ABAS';
  document.getElementById('addWorkspaceBtn').innerHTML = activeWorkspace.kind === 'computer' ? '<span>+</span> Novo aplicativo' : '<span>+</span> Novo site';
  grid.classList.toggle('focus-mode', settings.focused !== null);

  windows.forEach((el) => {
    const index = Number(el.dataset.accountIndex);
    const slot = Number(settings.slots[index] ?? index);
    const name = settings.names[index];
    const savedUrl = settings.urls[index];
    const program = settings.programs[index];
    const paneLabel = activeWorkspace.kind === 'computer' ? 'painel' : 'conta';
    el.querySelector('[data-action="rename"]').title = `Renomear ${paneLabel} ${String(index + 1).padStart(2, '0')}`;
    el.querySelector('[data-action="rename"]').setAttribute('aria-label', `Renomear ${paneLabel} ${String(index + 1).padStart(2, '0')}`);
    el.querySelector('[data-action="focus"]').title = `Focar ${paneLabel} ${String(index + 1).padStart(2, '0')}`;
    el.querySelector('[data-action="focus"]').setAttribute('aria-label', `Focar ${paneLabel} ${String(index + 1).padStart(2, '0')}`);
    el.querySelector('[data-action="hide"]').title = `Ocultar ${paneLabel} ${String(index + 1).padStart(2, '0')}`;
    el.querySelector('[data-action="hide"]').setAttribute('aria-label', `Ocultar ${paneLabel} ${String(index + 1).padStart(2, '0')}`);

    el.classList.toggle('is-hidden', settings.hidden.includes(index));
    el.classList.toggle('is-focused', settings.focused === index || (settings.focused === null && index === 0));
    el.classList.toggle('is-left-top', slot === 0);
    el.classList.toggle('is-left-bottom', slot === 2);

    el.dataset.slot = String(slot);
    el.style.setProperty('--mobile-order', String(slot));
    el.querySelector('.window-meta strong').textContent = name;
    el.querySelector('.site-url').value = savedUrl;

    el.querySelector('.frame-placeholder strong').textContent = settings.modes[index] === 'app'
      ? (program.path ? `Aplicativo · ${name}` : `Configure um aplicativo · ${name}`)
      : (savedUrl ? `Sessão isolada · ${name}` : `Configure a URL · ${name}`);
    el.querySelector('.frame-placeholder a').href = normalizeUrl(savedUrl || '') || GAME_URL;
    el.querySelector('.frame-placeholder a').hidden = settings.modes[index] === 'app' || !savedUrl;
    el.querySelector('.frame-placeholder > span:not(.placeholder-icon)').textContent = settings.modes[index] === 'app'
      ? (program.path ? program.path.split(/[\\/]/).pop() : 'Use ⚙ para escolher um executável ou uma janela já aberta.')
      : (savedUrl ? 'Esta sessão continua ativa enquanto outra aba está selecionada.' : 'Abra Endereços, informe um endereço web e selecione Abrir.');
    const launchButton = el.querySelector('[data-action="launch-app"]');
    const isRunning = runningPrograms.has(`${activeWorkspace.id}:${index}`);
    launchButton.classList.toggle('is-running', isRunning);
    const isExistingWindow = existingProgramWindows.has(`${activeWorkspace.id}:${index}`);
    launchButton.textContent = isRunning ? (isExistingWindow ? '↙' : '■') : '▶';
    launchButton.title = isRunning ? (isExistingWindow ? `Desencaixar janela de ${name}` : `Fechar aplicativo de ${name}`) : `Iniciar aplicativo de ${name}`;
    launchButton.setAttribute('aria-label', launchButton.title);
    el.querySelector('[data-action="open"]').hidden = activeWorkspace.kind === 'computer';
    el.querySelector('[data-action="configure-app"]').hidden = activeWorkspace.kind !== 'computer' && !activeWorkspace.legacyMixed;
    launchButton.hidden = activeWorkspace.kind !== 'computer' && !activeWorkspace.legacyMixed;
    if (activeWorkspace.kind === 'computer' && !isRunning) {
      setPaneStatus(el, program.path ? 'Pronto para iniciar' : 'Configure um aplicativo', '');
    }
  });

  grid.style.setProperty('--left-fr', `${settings.leftPercent}fr`);
  grid.style.setProperty('--right-fr', `${100 - settings.leftPercent}fr`);
  grid.style.setProperty('--top-fr', `${settings.topPercent}fr`);
  grid.style.setProperty('--bottom-fr', `${100 - settings.topPercent}fr`);

  activeWorkspaceTitle.textContent = activeWorkspace.title;
  const gridReduced = settings.focused !== null || settings.hidden.length > 0;
  document.getElementById('focusAll').hidden = !gridReduced;
  document.getElementById('focusAll').innerHTML = '<span>▦</span> Restaurar painéis';
  document.getElementById('visibleCount').textContent = String(windows.filter(paneIsVisible).length).padStart(2, '0');

  scheduleNativePaneLayout();
}

async function deleteWorkspace(id) {
  if (id === POKE_WORKSPACE_ID) return;
  const ws = findWorkspace(id);
  if (!ws) return;
  if (!await confirmAction('Excluir esta aba?', `“${ws.title}” será removida. Sites abertos serão encerrados; aplicativos iniciados serão fechados e janelas vinculadas serão desencaixadas.`, 'Excluir aba')) return;

  if (desktopBridge?.removeWorkspace) {
    desktopBridge.removeWorkspace(id);
  }

  appData.workspaces = appData.workspaces.filter((w) => w.id !== id);
  if (activeWorkspace.id === id) {
    activeWorkspace = appData.workspaces[0];
    activeCategory = activeWorkspace.kind;
    appData.activeWorkspaceId = activeWorkspace.id;
    syncPaneFieldsFromWorkspace();
  }
  renderWorkspaces();
  applyLayout();
  saveAppData();
}

function renderWorkspaces() {
  workspaceList.replaceChildren();
  const visibleWorkspaces = appData.workspaces.filter((workspace) => workspace.kind === activeCategory || (activeCategory === 'site' && workspace.legacyMixed));
  workspaceCount.textContent = String(visibleWorkspaces.length).padStart(2, '0');

  visibleWorkspaces.forEach((workspace, index) => {
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
  activeCategory = target.kind;
  appData.activeWorkspaceId = target.id;

  syncPaneFieldsFromWorkspace();
  renderWorkspaces();
  applyLayout();
  saveAppData();

  // Load only uninitialized slots (does not reload already running sessions)
  initWorkspacePanes(target);
}

function createWorkspaceId() {
  return `game-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function addWorkspace() {
  saveActiveWorkspaceSettings();
  const isComputer = activeCategory === 'computer';
  const initialSettings = makeSettings(false);
  if (isComputer) initialSettings.modes = Array(ACCOUNT_COUNT).fill('app');
  const ws = makeWorkspace(createWorkspaceId(), isComputer ? 'Novo aplicativo' : 'Novo site', initialSettings, activeCategory);
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
  document.getElementById('renameTitle').textContent = activeWorkspace.kind === 'computer' ? 'Renomear painel' : 'Renomear conta';
  renameInput.value = settings.names[index];
  renameDialog.showModal();
  renameInput.focus();
  renameInput.select();
}

async function refreshOpenWindows() {
  if (!desktopBridge?.listOpenPrograms || !openWindowList) return;
  selectedOpenWindow = null;
  attachOpenWindowBtn.disabled = true;
  openWindowList.replaceChildren(Object.assign(document.createElement('p'), { className: 'open-window-empty', textContent: 'Procurando janelas abertas…' }));
  try {
    const candidates = await desktopBridge.listOpenPrograms();
    openWindowList.replaceChildren();
    for (const candidate of candidates) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `open-window-option${candidate.compatible ? ' is-compatible' : ' is-incompatible'}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.dataset.hwnd = candidate.hwnd;
      option.dataset.compatible = String(Boolean(candidate.compatible));
      option.title = candidate.compatibilityReason || (candidate.compatible ? 'Compatível com o encaixe no painel do Sincronize.' : 'Não compatível com o encaixe.');
      const mark = document.createElement('span');
      mark.className = 'open-window-compatibility';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = candidate.compatible ? '✓' : '';
      const label = document.createElement('span');
      label.className = 'open-window-option-label';
      const name = document.createElement('strong');
      name.textContent = candidate.processName || 'Aplicativo';
      const title = document.createElement('small');
      title.textContent = candidate.title;
      label.append(name, title);
      option.append(mark, label);
      option.addEventListener('click', () => {
        openWindowList.querySelectorAll('.open-window-option').forEach((item) => {
          item.setAttribute('aria-selected', String(item === option));
        });
        selectedOpenWindow = candidate;
        attachOpenWindowBtn.disabled = !candidate.compatible;
      });
      openWindowList.append(option);
    }
    if (!candidates.length) openWindowList.append(Object.assign(document.createElement('p'), { className: 'open-window-empty', textContent: 'Nenhuma janela aberta encontrada.' }));
  } catch (error) {
    openWindowList.replaceChildren(Object.assign(document.createElement('p'), { className: 'open-window-empty', textContent: `Não foi possível listar janelas: ${error.message}` }));
  }
}

async function openProgramDialog(index) {
  if (!desktopBridge?.pickProgram) {
    showNotice('Recurso indisponível', 'O encaixe de aplicativos instalados está disponível no Sincronize para Windows.');
    return;
  }
  configuringProgramIndex = index;
  const program = settings.programs[index];
  document.getElementById('programDialogTitle').textContent = `Aplicativo instalado · ${settings.names[index]}`;
  programPathInput.value = program.path;
  programArgsInput.value = program.args.join('\n');
  programWindowTitleInput.value = program.windowTitle;
  programDialog.showModal();
  await refreshOpenWindows();
}

async function toggleProgram(index) {
  if (!desktopBridge?.launchProgram) {
    showNotice('Recurso indisponível', 'O encaixe de aplicativos instalados está disponível na versão Windows do Sincronize.');
    return;
  }
  const key = `${activeWorkspace.id}:${index}`;
  if (runningPrograms.has(key)) {
    if (!existingProgramWindows.has(key) && !await confirmAction('Fechar aplicativo?', `Deseja fechar “${settings.names[index]}”?`, 'Fechar aplicativo')) return;
    await desktopBridge.stopProgram(activeWorkspace.id, index);
    return;
  }
  const program = settings.programs[index];
  if (!program.path) {
    launchAfterProgramSave = true;
    openProgramDialog(index);
    return;
  }
  settings.modes[index] = 'app';
  applyLayout();
  saveAppData();
  setPaneStatus(byAccount(index), 'Iniciando aplicativo instalado', 'loading');
  try {
    const result = await desktopBridge.launchProgram(activeWorkspace.id, index, program.path, program.args, program.windowTitle);
    if (!result?.ok) setPaneStatus(byAccount(index), result?.error || 'Não foi possível iniciar o aplicativo', 'error');
  } catch (error) {
    setPaneStatus(byAccount(index), error.message || 'Não foi possível iniciar o aplicativo', 'error');
  }
}

function applyUrl(windowEl) {
  const index = Number(windowEl.dataset.accountIndex);
  const input = windowEl.querySelector('.site-url');
  const url = normalizeUrl(input.value);

  if (!url) {
    input.setCustomValidity('');
    input.setAttribute('aria-invalid', 'true');
    showNotice('Endereço inválido', 'Informe um endereço de site válido para abrir neste painel.', { tone: 'warning' });
    return;
  }

  input.setCustomValidity('');
  input.removeAttribute('aria-invalid');
  input.value = url;
  settings.urls[index] = url;
  settings.modes[index] = 'web';
  applyLayout();
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
      if (!url) {
        setPaneStatus(windowEl, 'Informe um endereço em Endereços antes de abrir outra janela', 'warning');
        document.getElementById('urlToggle').click();
        windowEl.querySelector('.site-url').focus();
        return;
      }
      if (desktopBridge) desktopBridge.openPaneWindow(activeWorkspace.id, index, url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    }
    if (action === 'configure-app') openProgramDialog(index);
    if (action === 'launch-app') toggleProgram(index);
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
  if (renameDialog.returnValue !== 'save' || renamingAccountIndex === null) return;
  if (!name) {
    showNotice('Nome necessário', 'Digite um nome para este painel antes de salvar.', { tone: 'warning' });
    return;
  }
  settings.names[renamingAccountIndex] = name.slice(0, 32);
  applyLayout();
  saveAppData();
  renamingAccountIndex = null;
});

document.getElementById('pickProgramBtn').addEventListener('click', async () => {
  try {
    const selectedPath = await desktopBridge?.pickProgram();
    if (selectedPath) programPathInput.value = selectedPath;
  } catch (error) {
    showNotice('Não foi possível abrir a lista', error.message, { tone: 'error' });
  }
});

document.getElementById('refreshOpenWindowsBtn').addEventListener('click', refreshOpenWindows);
document.getElementById('attachOpenWindowBtn').addEventListener('click', async (event) => {
  const hwnd = selectedOpenWindow?.compatible ? selectedOpenWindow.hwnd : null;
  if (!hwnd || configuringProgramIndex === null || !desktopBridge?.attachOpenProgram) {
    showNotice('Selecione uma janela compatível', 'Somente janelas marcadas com ✓ podem ser encaixadas.', { tone: 'warning' });
    return;
  }
  const button = event.currentTarget;
  button.disabled = true;
  const workspaceId = activeWorkspace.id;
  const index = configuringProgramIndex;
  try {
    const result = await desktopBridge.attachOpenProgram(workspaceId, index, hwnd);
    if (!result?.ok) {
      showNotice('Não foi possível encaixar', result?.error || 'A janela selecionada não pôde ser incorporada.', { tone: 'error' });
      await refreshOpenWindows();
      return;
    }
    settings.modes[index] = 'app';
    existingProgramWindows.add(`${workspaceId}:${index}`);
    applyLayout();
    saveAppData();
    programDialog.close('cancel');
  } catch (error) {
    showNotice('Falha ao encaixar', error.message, { tone: 'error' });
  } finally {
    button.disabled = false;
  }
});

programDialog.addEventListener('close', () => {
  const index = configuringProgramIndex;
  configuringProgramIndex = null;
  const shouldLaunch = launchAfterProgramSave;
  launchAfterProgramSave = false;
  if (programDialog.returnValue !== 'save' || index === null) return;
  const selectedPath = programPathInput.value.trim();
  if (!selectedPath) {
    showNotice('Informe um aplicativo', 'Selecione um arquivo .exe antes de salvar esta configuração.', { tone: 'warning' });
    return;
  }
  const key = `${activeWorkspace.id}:${index}`;
  if (runningPrograms.has(key)) desktopBridge.stopProgram(activeWorkspace.id, index);
  settings.programs[index] = {
    path: selectedPath,
    args: programArgsInput.value.split(/\r?\n/).filter((argument) => argument.length > 0).slice(0, 48),
    windowTitle: programWindowTitleInput.value.trim().slice(0, 128)
  };
  settings.modes[index] = 'app';
  applyLayout();
  saveAppData();
  if (shouldLaunch) toggleProgram(index);
});

workspaceNameDialog.addEventListener('close', () => {
  const title = workspaceNameInput.value.trim();
  if (workspaceNameDialog.returnValue !== 'save' || !renamingWorkspaceId) return;
  if (!title) {
    showNotice('Nome necessário', 'Digite um nome para esta aba antes de salvar.', { tone: 'warning' });
    return;
  }
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
document.querySelectorAll('[data-category]').forEach((button) => {
  button.addEventListener('click', () => {
    const category = button.dataset.category;
    activeCategory = category === 'computer' ? 'computer' : 'site';
    document.querySelectorAll('[data-category]').forEach((item) => {
      const selected = item.dataset.category === activeCategory;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    const target = appData.workspaces.find((workspace) => workspace.kind === activeCategory);
    if (target) switchWorkspace(target.id);
    else addWorkspace();
    renderWorkspaces();
    applyLayout();
  });
});
document.getElementById('clearCacheAll').addEventListener('click', async () => {
  if (!desktopBridge) {
    showNotice('Recurso indisponível', 'A limpeza do cache está disponível no aplicativo desktop Sincronize.');
    return;
  }
  if (!await confirmAction('Limpar o cache?', `As páginas de “${activeWorkspace.title}” serão recarregadas. Seus cookies e logins serão preservados.`, 'Limpar cache')) return;
  const button = document.getElementById('clearCacheAll');
  button.disabled = true;
  try {
    const result = await desktopBridge.clearWorkspaceCache(activeWorkspace.id);
    await showNotice(result?.ok ? 'Cache limpo' : 'Não foi possível limpar o cache', result?.ok ? 'As páginas foram recarregadas. Seus cookies e logins foram mantidos.' : (result?.error || 'Ocorreu um erro inesperado.'), { tone: result?.ok ? 'success' : 'error' });
  } catch (error) {
    await showNotice('Falha ao limpar o cache', error.message, { tone: 'error' });
  } finally {
    button.disabled = false;
  }
});

document.getElementById('focusAll').addEventListener('click', () => {
  settings.hidden = [];
  settings.focused = null;
  applyLayout();
  saveAppData();
});

document.getElementById('appearanceToggle').addEventListener('click', () => {
  renderAppearanceEditor();
  appearanceDialog.showModal();
});
document.querySelectorAll('.appearance-option').forEach((option) => {
  option.addEventListener('click', () => {
    appearanceConfig.active = option.dataset.preset;
    applyAppearance(true, true);
  });
});
appearanceFields.name.addEventListener('input', () => {
  const profile = appearanceConfig.profiles[appearanceConfig.active];
  profile.name = appearanceFields.name.value.trim().slice(0, 24) || 'Meu estilo';
  const selected = document.querySelector(`.appearance-option[data-preset="${appearanceConfig.active}"] strong`);
  if (selected) selected.textContent = profile.name;
  saveAppearanceConfig();
});
for (const key of ['background', 'accent', 'surface', 'text']) {
  appearanceFields[key].addEventListener('input', () => {
    appearanceConfig.profiles[appearanceConfig.active][key] = appearanceFields[key].value;
    applyAppearance(false, false);
  });
}
for (const key of ['dock', 'controls', 'gap', 'radius']) {
  appearanceFields[key].addEventListener(key === 'dock' || key === 'controls' ? 'change' : 'input', () => {
    const profile = appearanceConfig.profiles[appearanceConfig.active];
    profile[key] = key === 'gap' || key === 'radius' ? Number(appearanceFields[key].value) : appearanceFields[key].value;
    if (key === 'gap') document.getElementById('appearanceGapValue').value = `${profile.gap} px`;
    if (key === 'radius') document.getElementById('appearanceRadiusValue').value = `${profile.radius} px`;
    applyAppearance(false, true);
  });
}
document.getElementById('resetAppearanceBtn').addEventListener('click', () => {
  const key = appearanceConfig.active;
  appearanceConfig.profiles[key] = { ...DEFAULT_APPEARANCE_PROFILES[key] };
  applyAppearance(true, true);
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
    if (settings.focused !== null) return;
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
    if (payload.source === 'native') {
      const key = `${payload.workspaceId}:${payload.accountIndex}`;
      if (payload.state === 'ready' || payload.state === 'loading' || payload.state === 'warning') runningPrograms.add(key);
      if (payload.state === 'closed' || payload.state === 'error') {
        runningPrograms.delete(key);
        existingProgramWindows.delete(key);
      }
      if (payload.workspaceId === activeWorkspace.id) {
        const el = byAccount(payload.accountIndex);
        if (el) setPaneStatus(el, payload.message, payload.state);
        applyLayout();
      }
      return;
    }
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
  activeCategory = activeWorkspace.kind;
  syncPaneFieldsFromWorkspace();
  renderWorkspaces();
  applyLayout();
  initWorkspacePanes(activeWorkspace);
});

window.addEventListener('pagehide', () => {
  if (!appearanceSaveTimer) return;
  clearTimeout(appearanceSaveTimer);
  appearanceSaveTimer = null;
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearanceConfig)); } catch { /* storage unavailable */ }
});

let nativeOverlayOpen = null;
const syncNativeOverlay = () => {
  const isOpen = [...document.querySelectorAll('dialog')].some((dialog) => dialog.open);
  if (isOpen === nativeOverlayOpen) return;
  nativeOverlayOpen = isOpen;
  desktopBridge?.setOverlayOpen(isOpen);
};
const dialogObserver = new MutationObserver(syncNativeOverlay);
dialogObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
syncNativeOverlay();

renderWorkspaces();
syncPaneFieldsFromWorkspace();
applyLayout();
initWorkspacePanes(activeWorkspace);
scheduleNativePaneLayout();
