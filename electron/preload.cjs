const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('isolatedBoard', Object.freeze({
  setPaneLayout(workspaceId, layout) {
    ipcRenderer.send('board:set-pane-layout', workspaceId, layout);
  },
  setOverlayOpen(isOpen) {
    ipcRenderer.send('board:set-overlay-open', Boolean(isOpen));
  },
  navigatePane(workspaceId, accountIndex, url, force = false) {
    return ipcRenderer.invoke('board:navigate-pane', workspaceId, accountIndex, url, Boolean(force));
  },
  openPaneWindow(workspaceId, accountIndex, url) {
    return ipcRenderer.invoke('board:open-pane-window', workspaceId, accountIndex, url);
  },
  pickProgram() {
    return ipcRenderer.invoke('board:pick-program');
  },
  listOpenPrograms() {
    return ipcRenderer.invoke('board:list-open-programs');
  },
  attachOpenProgram(workspaceId, accountIndex, hwnd) {
    return ipcRenderer.invoke('board:attach-open-program', workspaceId, accountIndex, hwnd);
  },
  launchProgram(workspaceId, accountIndex, executable, args, windowTitle) {
    return ipcRenderer.invoke('board:launch-program', workspaceId, accountIndex, executable, args, windowTitle);
  },
  stopProgram(workspaceId, accountIndex) {
    return ipcRenderer.invoke('board:stop-program', workspaceId, accountIndex);
  },
  clearWorkspaceCache(workspaceId) {
    return ipcRenderer.invoke('board:clear-workspace-cache', workspaceId);
  },
  removeWorkspace(workspaceId) {
    return ipcRenderer.invoke('board:remove-workspace', workspaceId);
  },
  onPaneStatus(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('board:pane-status', listener);
    return () => ipcRenderer.removeListener('board:pane-status', listener);
  },
  onLayoutRequested(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('board:request-layout', listener);
    return () => ipcRenderer.removeListener('board:request-layout', listener);
  }
}));
