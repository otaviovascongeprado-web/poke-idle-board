# Transferência do projeto — Poke Idle World Session Deck

Este arquivo fornece contexto para outra IA continuar o projeto sem depender da conversa anterior.

## Objetivo

Aplicativo desktop Windows para gerir vários jogos em abas/workspaces nomeáveis, cada um com quatro contas numa grade 2×2 e sessões de navegador isoladas. Interface roxo/preto. Abas de jogo em segundo plano devem continuar rodando. Monitorar o computador inteiro sem suspender jogos automaticamente.

## Projeto e execução

- Cópia atualmente usada pelo launcher/processos Electron: `D:\Users\Potávio\Desktop\poke-idle-board`.
- Há também uma cópia de trabalho em `C:\Users\Potávio\Desktop\poke-idle-board`; manter as duas sincronizadas se ambas continuarem sendo usadas.
- Requisitos: Windows 10/11 e Node.js LTS (npm vem junto).
- Instalar dependências uma vez: `npm.cmd install`.
- Iniciar o desktop: `npm.cmd start`, ou dar duplo clique em `Abrir Board.bat` depois da instalação.
- `http://localhost:8000` é somente o preview estático. Ele não cria as sessões isoladas nem tem acesso ao monitor do Windows.

## Arquitetura

- `index.html`, `theme.css`, `app.js`: interface e controles no renderer.
- `electron/main.cjs`: janela principal, views dinâmicas por workspace/conta, navegação, sessões persistentes, IPC, cache e telemetria.
- `electron/preload.cjs`: API isolada (`contextBridge`) para layout, navegação e cache por workspace, janelas auxiliares, status e telemetria.
- `resource-monitor.js`: UI do monitor do computador, canvas dos gráficos e tabela atual.
- `package.json`: Electron é a única dependência de execução do desktop.
- O workspace `poke-idle` preserva as partições antigas `persist:poke-idle-account-01` até `04` para manter os logins existentes. Outros workspaces usam `persist:<workspaceId>-account-01` até `04`.
- Não trocar `WebContentsView` por iframes HTML: isso recriaria o compartilhamento de sessões.
- Preferências ficam em `localStorage` na chave `poke-idle-board.workspaces.v3`, como coleção de workspaces; há migração automática dos dados antigos `poke-idle-board.settings.v2` para Poke Idle.
- Workspaces novos começam com quatro slots/contas e URLs em branco. O usuário configura URLs em “Endereços”. Não implementar remoção de workspace sem fluxo de confirmação/limpeza.

## Estado atual da interface

- Tema roxo/preto e grade 2×2 redimensionável.
- Barra lateral contém lista dinâmica de jogos/workspaces, botão de nova aba, edição de nomes das abas, “Restaurar grade” e “Limpar cache”.
- Controles por painel: renomear, focar, abrir em janela separada e ocultar.
- URLs ficam recolhidas até selecionar “Endereços”.
- Não há controle para descarregar abas/janelas ocultas. A decisão explícita é manter todos os jogos ativos enquanto se alterna entre workspaces.
- O preview no browser exibe placeholders; as janelas reais do jogo são `WebContentsView` posicionadas sobre os hosts da grade pelo IPC.

## Monitor de desempenho (implementado nesta versão)

- Botão “Desempenho” abre/fecha um painel com CPU total, RAM e GPU, mais gráficos de aproximadamente 60 s e tabela de valores.
- A coleta é do computador inteiro, atualiza a cada 2 segundos e deve rodar apenas enquanto o painel estiver aberto.
- A origem são contadores WMI/CIM do Windows consultados por um processo PowerShell filho iniciado por `electron/main.cjs`.
- CPU: `Win32_PerfFormattedData_PerfOS_Processor`, `_Total`.
- RAM: `Win32_OperatingSystem` (`TotalVisibleMemorySize`, `FreePhysicalMemory`).
- GPU: maior `UtilizationPercentage` encontrado em `Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine`. É o motor de GPU mais ocupado, NÃO soma dos motores, nem necessariamente porcentagem agregada da placa inteira. Se não houver contador, exibir indisponível em vez de inventar valor.
- O preload expõe `startResourceMonitor()`, `stopResourceMonitor()` e `onResourceSample(callback)`.
- Limpeza de cache: `clearWorkspaceCache(workspaceId)` chama `session.fromPartition(...).clearCache()` nas quatro partições do workspace selecionado e recarrega as páginas configuradas. Limpa cache de rede, NÃO cookies nem `localStorage`; confirmação informa que as páginas recarregam.
- O IPC de layout/navegação inclui `workspaceId`. Eventos de estado incluem ambos `workspaceId` e `accountIndex`; a UI só mostra status da aba ativa.
- `WebContentsView` deve usar `backgroundThrottling: false`; ao trocar de workspace, views inativas ficam ocultas/fora da grade e com áudio silenciado, mas permanecem criadas e não navegam para `about:blank`. Isso mantém timers/websocket do idle em execução e consome RAM/CPU/GPU por workspace.
- O sampler deve ser parado ao fechar o painel e ao fechar a janela do app. Não desativar serviços, segurança, drivers ou políticas globais do Windows.
- No computador em que as leituras foram testadas, uma amostra do Windows retornou CPU 26%, RAM 82,1% (13,4/16,3 GB) e motor GPU `3D` em 43%. É uma fotografia momentânea, não um benchmark.

## Cuidados ao transferir para outra pessoa/IA

1. Envie esta pasta/código, mas exclua `node_modules` do arquivo de transferência; a outra pessoa pode restaurá-lo com `npm install`.
2. Não envie os dados Electron de usuário (`app.getPath('userData')`), cookies, partições de sessão, senhas, perfis do navegador ou diretórios de instalação/configuração do usuário. Eles contêm logins salvos. Eles não são necessários para reconstruir o app.
3. Antes de aceitar mudanças em `electron/main.cjs` ou `preload.cjs`, preservar `contextIsolation: true`, `nodeIntegration: false`, sandbox, validação de IDs/URLs e partições distintas para cada jogo+conta.
4. Verificar qual cópia (C: ou D:) o launcher realmente usa antes de concluir que uma alteração não apareceu.

## Validação conhecida e pendente

- Foi verificado que as classes CIM de CPU/RAM/GPU existem no computador e que uma amostra PowerShell real é retornada.
- Os arquivos HTML/CSS/JS e Electron passaram pela verificação estática do editor sem diagnósticos.
- Ainda é necessário reiniciar o Electron para exercitar o painel através de IPC e conferir o desenho dos gráficos no app desktop. Se o Electron estiver aberto, relançar o BAT existente apenas foca a instância em execução; fechar todos os processos/janelas do app e abrir novamente para carregar a nova versão.
- Testar workspaces: criar, renomear, alternar, recarregar e validar que URLs/nomes/layouts persistem separadamente; verificar que Poke Idle mantém as quatro partições/logins antigas.
- Testar back-end: trocar A→B→A sem reload dos jogos inativos; `backgroundThrottling:false`; áudio dos workspaces inativos silenciado; jogos ocultos continuam ativos.
- Testar cache: confirmação, limpar as quatro partições do workspace atual, preservar cookies/login e recarregar apenas as views desse jogo.
- Testar monitor: abre/fecha, sampler começa/termina, três valores atualizam, GPU indisponível não mostra valor inventado, todas as sessões continuam abertas.

## Otimizações de Memória e Correção de Alternância de Abas (Atualizado)

1. **Correção do fechamento/reload ao alternar abas A ↔ B:**
   - O método `navigatePane` agora aceita parâmetro booleano `force`. Ao alternar de workspace, ele NÃO recarrega páginas já carregadas (`force = false`), impedindo que jogos em abas secundárias fechem ou reiniciem a sessão.
   - Os limites de tela de views em background (`OFFSCREEN_BOUNDS`) foram ajustados para 800×600 (em vez de 1×1), prevenindo perda de contexto WebGL e quebra de layout de viewport nos jogos.
2. **Otimizações Chromium & V8 de Memória RAM:**
   - `--js-flags="--max-old-space-size=256 --optimize_for_size --expose-gc"`: Força coleta de lixo periódica nos renderers e restringe heap V8.
   - Limitação de caches de disco (64 MB) e mídia (32 MB) por partição.
   - `--force-device-scale-factor=1` e `--disable-gpu-shader-disk-cache`: Reduzem o uso de memória e buffers de texturas da GPU.
   - Recursos nativos do Chromium `PurgeAndSuspend` e `MemoryPurge` ativados.
3. **Gerenciamento de Abas e Memória Sob Demanda:**
   - Adicionado botão "⚡ Otimizar RAM" na barra superior que dispara `window.gc()` em todos os renderers e limpa cache de rede.
   - Rotina automática de varredura de memória a cada 15 minutos em background.
   - Criação preguiçosa (lazy) de views apenas quando houver URL configurada.
   - Adicionado botão de exclusão de abas secundárias com liberação e destruição dos WebContents associados.
