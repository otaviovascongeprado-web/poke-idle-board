(() => {
  const panel = document.getElementById('performancePanel');
  const toggle = document.getElementById('performanceToggle');
  const close = document.getElementById('performanceClose');
  const status = document.getElementById('performanceStatus');
  const bridge = window.isolatedBoard;
  const history = { cpu: [], ram: [], gpu: [] };
  const historyLimit = 30;
  let redrawQueued = false;

  function setStatus(message, state = '') {
    status.dataset.state = state;
    status.lastElementChild.textContent = message;
  }

  function formatMemory(mb) {
    if (!Number.isFinite(mb)) return '—';
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  function scheduleCharts() {
    if (redrawQueued) return;
    redrawQueued = true;
    requestAnimationFrame(() => {
      redrawQueued = false;
      drawChart('cpuChart', history.cpu, 'cpu');
      drawChart('ramChart', history.ram, 'ram');
      drawChart('gpuChart', history.gpu, 'gpu');
    });
  }

  function drawChart(id, values, colorName) {
    const canvas = document.getElementById(id);
    if (!canvas || panel.hidden) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    const style = getComputedStyle(document.documentElement);
    const color = style.getPropertyValue(`--metric-${colorName}`).trim();
    const padding = { top: 5, right: 2, bottom: 5, left: 2 };
    const chartWidth = rect.width - padding.left - padding.right;
    const chartHeight = rect.height - padding.top - padding.bottom;

    context.strokeStyle = 'rgba(198,170,229,0.09)';
    context.lineWidth = 1;
    for (let line = 1; line <= 2; line += 1) {
      const y = padding.top + (chartHeight * line) / 3;
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(rect.width - padding.right, y);
      context.stroke();
    }

    const valid = values.map((value) => Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null);
    if (valid.length < 2 || valid.every((value) => value === null)) return;
    const points = valid.map((value, index) => ({
      x: padding.left + (chartWidth * index) / Math.max(historyLimit - 1, 1),
      y: value === null ? null : padding.top + chartHeight * (1 - value / 100)
    }));

    context.strokeStyle = color;
    context.lineWidth = 1.8;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();
    let started = false;
    points.forEach((point) => {
      if (point.y === null) { started = false; return; }
      if (!started) { context.moveTo(point.x, point.y); started = true; }
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
  }

  function acceptSample(sample) {
    if (!sample || sample.error) {
      setStatus(sample?.error || 'Falha na leitura do Windows', 'error');
      return;
    }

    const cpu = Number(sample.cpuPercent);
    const ram = Number(sample.ramPercent);
    const gpu = sample.gpuPercent === null || sample.gpuPercent === undefined ? null : Number(sample.gpuPercent);
    history.cpu.push(Number.isFinite(cpu) ? cpu : null);
    history.ram.push(Number.isFinite(ram) ? ram : null);
    history.gpu.push(Number.isFinite(gpu) ? gpu : null);
    Object.values(history).forEach((values) => { if (values.length > historyLimit) values.shift(); });

    const cpuText = Number.isFinite(cpu) ? `${Math.round(cpu)}%` : '—';
    const used = Number(sample.ramUsedMb);
    const total = Number(sample.ramTotalMb);
    const ramText = Number.isFinite(ram) ? `${Math.round(ram)}%` : '—';
    const gpuText = Number.isFinite(gpu) ? `${Math.round(gpu)}%` : '—';
    document.getElementById('cpuValue').textContent = cpuText;
    document.getElementById('cpuDetail').textContent = 'uso total do processador';
    document.getElementById('ramValue').textContent = ramText;
    document.getElementById('ramDetail').textContent = `${formatMemory(used)} de ${formatMemory(total)} usados`;
    document.getElementById('gpuValue').textContent = gpuText;
    document.getElementById('gpuDetail').textContent = sample.gpuName || (Number.isFinite(gpu) ? 'motor mais ocupado' : 'contador sem dados');
    document.getElementById('cpuTableValue').textContent = cpuText;
    document.getElementById('ramTableValue').textContent = `${formatMemory(used)} (${ramText})`;
    document.getElementById('ramTableDetail').textContent = `${formatMemory(total)} total · ${formatMemory(Number(sample.ramAvailableMb))} disponíveis`;
    document.getElementById('gpuTableValue').textContent = gpuText;
    document.getElementById('gpuTableDetail').textContent = sample.gpuName || 'Motor mais ocupado reportado pelo Windows';
    setStatus(`Ao vivo · ${new Date(sample.timestamp).toLocaleTimeString('pt-BR')}`, 'ready');
    scheduleCharts();
  }

  function openPanel() {
    panel.hidden = false;
    document.body.classList.add('performance-open');
    toggle.setAttribute('aria-expanded', 'true');
    if (!bridge) {
      setStatus('Disponível no aplicativo desktop', 'error');
      return;
    }
    setStatus('Conectando aos contadores do Windows', 'loading');
    bridge.startResourceMonitor().then((started) => {
      if (!started) setStatus('Monitor já está em execução ou não pôde iniciar', 'error');
    }).catch((error) => setStatus(`Falha ao iniciar monitor: ${error.message}`, 'error'));
    scheduleCharts();
  }

  function closePanel() {
    panel.hidden = true;
    document.body.classList.remove('performance-open');
    toggle.setAttribute('aria-expanded', 'false');
    if (bridge) bridge.stopResourceMonitor();
  }

  toggle.addEventListener('click', () => panel.hidden ? openPanel() : closePanel());
  close.addEventListener('click', closePanel);
  window.addEventListener('resize', scheduleCharts, { passive: true });
  if (bridge) bridge.onResourceSample(acceptSample);
  else setStatus('Abra o aplicativo desktop para monitorar o Windows', 'error');
})();
