# Poke Idle World Multi Account Board

Desktop board for multiple named game tabs, each containing four account panes. Every game/account pair runs in a separate persistent Electron session partition, so cookies, local storage, and other site storage are not shared.

## Requirements

- Windows 10/11
- Node.js LTS (includes npm)

## Run

1. Dê duplo clique no atalho **Poke Idle Board** na Área de Trabalho (abre diretamente o Electron sem CMD).
   - Alternativamente, use `Abrir Board.vbs` (silencioso, sem janela de CMD) ou `Abrir Board.bat`.
2. Se estiver executando pela primeira vez após clonar/baixar, execute `npm install` no terminal uma vez.
3. As quatro contas da aba padrão **Poke Idle** mantêm suas sessões isoladas e logins salvos. Adicione mais abas com **Nova aba de jogo** e configure suas URLs em **Endereços**.

Use the pane's rename, focus, open-window, and hide controls as before. Adjust the grid by dragging its splitters. Switching game tabs only hides their native views and mutes their audio: it does not unload them, navigate away, or enable background timer throttling. Idle games continue running in the background, so each extra game tab adds four live browser views and increases CPU/RAM/GPU use.

Create additional tabs only as needed. Because every configured account remains an active browser session, several games with four accounts each can use substantial memory and processing power. The performance panel helps observe whole-computer usage while you add games.

**Limpar cache** clears network cache for the four account partitions of the currently selected game tab, then reloads any configured pages. It does not clear cookies or local storage, so logins/preferences should remain. A reload can still interrupt the current in-page state.

Open **Desempenho** to view whole-computer CPU and RAM readings and the busiest Windows GPU-engine counter, sampled every two seconds with a 60-second chart. The monitor starts only while its panel is open and stops when closed. GPU is the busiest reported engine, not a sum or a per-card total.

## Important

The browser-only preview at `http://localhost:8000` cannot isolate embedded sessions or sample Windows performance counters; launch the Electron app with `npm start` to use isolated sessions and the native monitor. Performance monitoring reads whole-computer CPU/RAM and the busiest Windows GPU-engine counter every two seconds only while the panel is open. Site storage and login data are stored locally in Electron's per-game/per-account persistent partitions. The game must permit simultaneous accounts for all sessions to remain connected. Do not share this Windows user profile if other people should not be able to access those saved logins.
