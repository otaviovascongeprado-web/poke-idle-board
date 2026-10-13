const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('isolatedBoard', Object.freeze({
  setPaneLayout(workspaceId, layout) {
    ipcRenderer.send('board:set-pane-layout', workspaceId, layout);
  },
  navigatePane(workspaceId, accountIndex, url, force = false) {
    return ipcRenderer.invoke('board:navigate-pane', workspaceId, accountIndex, url, Boolean(force));
  },
  openPaneWindow(workspaceId, accountIndex, url) {
    return ipcRenderer.invoke('board:open-pane-window', workspaceId, accountIndex, url);
  },
  clearWorkspaceCache(workspaceId) {
    return ipcRenderer.invoke('board:clear-workspace-cache', workspaceId);
  },
  optimizeMemory() {
    return ipcRenderer.invoke('board:optimize-memory');
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
  },
  startResourceMonitor() {
    return ipcRenderer.invoke('board:start-resource-monitor');
  },
  stopResourceMonitor() {
    return ipcRenderer.invoke('board:stop-resource-monitor');
  },
  onResourceSample(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, sample) => callback(sample);
    ipcRenderer.on('board:resource-sample', listener);
    return () => ipcRenderer.removeListener('board:resource-sample', listener);
  }
}));
