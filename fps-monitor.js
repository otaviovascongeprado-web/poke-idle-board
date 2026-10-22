(() => {
  const value = document.getElementById('fpsValue');
  if (!value) return;

  let frames = 0;
  let lastSample = performance.now();
  function sampleFrame(now) {
    frames += 1;
    const elapsed = now - lastSample;
    if (elapsed >= 1000) {
      value.textContent = String(Math.round((frames * 1000) / elapsed));
      frames = 0;
      lastSample = now;
    }
    requestAnimationFrame(sampleFrame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) value.textContent = '—';
    frames = 0;
    lastSample = performance.now();
  });
  requestAnimationFrame(sampleFrame);
})();
