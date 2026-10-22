# Contexto do projeto — Sincronize

## Propósito

Aplicativo Electron para organizar sites em sessões isoladas e aplicativos do Windows em painéis. A interface separa as categorias **Sites** e **Computador**, cada aba com quatro painéis. Ao trocar de aba/categoria, as sessões continuam existindo em segundo plano.

## Arquivos principais

- `index.html`, `theme.css`, `workspaces.css`, `app.js`: interface, abas, categorias e ações.
- `electron/main.cjs`, `electron/preload.cjs`: `WebContentsView`, partições persistentes e API segura entre renderer e processo principal.
- `electron/native-windows.cjs`, `electron/native-windows.ps1`: iniciar executáveis Windows e encaixar janelas nativas.
- `fps-monitor.js`: indicador leve de FPS da interface principal.
- `assets/sincronize-mark.svg`, `assets/sincronize.ico`, `assets/sincronize-icon.png`: marca, ícone Electron e favicon.

## Decisões que devem ser preservadas

- Usar `contextIsolation: true`, `nodeIntegration: false`, sandbox e validação de IPC/URLs.
- Cada site/aba/conta tem sua própria partição Electron. Preservar os IDs `persist:poke-idle-account-01` até `04` para não apagar os logins da aba antiga Poke Idle.
- Views web em segundo plano não devem ser destruídas, navegar para `about:blank`, sofrer throttling, ter áudio silenciado automaticamente ou ser recarregadas ao alternar abas.
- Janelas nativas ocultas permanecem com seus processos ativos. Não presumir que todo programa continua sua atividade interna quando oculto; alguns pausam por conta própria.
- Não limpar caches nem reiniciar o processo GPU automaticamente. **Limpar cache** é uma ação separada e explícita, somente na categoria Sites. Não há botão de “otimização de RAM”: a coleta de lixo não oferecia garantia de reduzir o uso real de memória.
- A integração nativa é voltada a executáveis `.exe` no Windows. Para launchers que criam outra janela/processo, o filtro de título ajuda a selecionar a janela certa. Não armazenar credenciais.
- A janela nativa é encaixada como filha do contêiner visual do próprio painel, com dimensões convertidas de DIP para pixels físicos. Ainda assim, aplicativos com renderização exclusiva, protegida ou incompatível com reparenting do Windows podem não exibir imagem.

## Persistência e execução

- Preferências em `localStorage`, chave interna `poke-idle-board.workspaces.v3`, com migração de `poke-idle-board.settings.v2`.
- `npm install` instala Electron; `npm start` inicia o app. Os arquivos `Abrir Sincronize.bat` e `.vbs` também iniciam a aplicação.
- O projeto não configura um instalador/empacotador; o ícone da janela Electron usa `assets/sincronize.ico`.
- O preview HTML estático não consegue encaixar janelas nativas nem criar partições isoladas.

## Revisão mais recente

- Incluídos seletores separados de Sites e Computador e abas criadas com tipo definido.
- O estado legado com executáveis configurados preserva os controles de aplicativo para evitar tornar essas configurações inacessíveis.
- Alterado o ícone real da janela Electron para a marca vetorial Sincronize; removida a arte decorativa que estava aplicada ao cabeçalho.
- Removidos limites artificiais de heap/caches e reinicialização automática do processo GPU que poderiam prejudicar jogos e conteúdo acelerado.
- Botões de cache, grade, desempenho, endereços, foco, renomeação, ordenação, ocultação e executáveis precisam ser revalidados ao modificar os fluxos.
