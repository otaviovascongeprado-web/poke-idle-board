const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

let helper = null;
let nextRequestId = 1;
const pending = new Map();

function startHelper() {
  if (helper && !helper.killed) return helper;
  helper = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'native-windows.ps1')
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  const output = readline.createInterface({ input: helper.stdout });
  output.on('line', (line) => {
    let response;
    try { response = JSON.parse(line); } catch { return; }
    const item = pending.get(response.id);
    if (!item) return;
    pending.delete(response.id);
    clearTimeout(item.timeout);
    if (response.error) item.reject(new Error(response.error));
    else item.resolve(response.result);
  });
  helper.stderr.on('data', (chunk) => console.error('[Native window helper]', String(chunk).trim()));
  helper.stdin.on('error', () => {});
  helper.on('error', (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timeout);
      item.reject(error);
    }
    pending.clear();
    helper = null;
  });
  helper.on('exit', (code) => {
    for (const item of pending.values()) {
      clearTimeout(item.timeout);
      item.reject(new Error(`O auxiliar de janelas encerrou (${code ?? 'sem código'}).`));
    }
    pending.clear();
    helper = null;
  });
  return helper;
}

function request(op, values = {}) {
  const child = startHelper();
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('O Windows demorou para responder à operação de janela.'));
    }, 5000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(`${JSON.stringify({ id, op, ...values })}\n`, (error) => {
      if (!error) return;
      clearTimeout(timeout);
      pending.delete(id);
      reject(error);
    });
  });
}

module.exports = Object.freeze({
  findWindow(pid) { return request('find', { pid }); },
  async listWindows() {
    const windows = await request('list');
    return Array.isArray(windows) ? windows : (windows ? [windows] : []);
  },
  async listProcessTree(pid) {
    const processIds = await request('processTree', { pid });
    return Array.isArray(processIds) ? processIds.map(Number).filter(Number.isFinite) : [];
  },
  isWindow(hwnd) { return request('isWindow', { hwnd }); },
  disconnectInput(hwnd) { return request('disconnectInput', { hwnd }); },
  closeWindow(hwnd) { return request('closeWindow', { hwnd }); },
  attach(hwnd, parent, bounds, style, owner = '0', originalParent = '0') { return request('attach', { hwnd, parent, owner, originalParent, style, ...bounds }); },
  position(hwnd, bounds) { return request('position', { hwnd, ...bounds }); },
  detach(hwnd, bounds, style, parent = '0') { return request('detach', { hwnd, style, parent, ...bounds }); },
  close() {
    if (helper && !helper.killed) helper.kill();
  }
});
