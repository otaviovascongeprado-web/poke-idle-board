# Sincronize

Aplicativo desktop para organizar sites e aplicativos do Windows em painéis separados. Cada aba tem quatro painéis; sites usam sessões persistentes isoladas por conta.

## Executar

- Windows 10/11 e Node.js LTS.
- Na primeira execução, instale as dependências com `npm install`.
- Inicie com `npm start` ou abra `Abrir Sincronize.bat` / `Abrir Sincronize.vbs`.

## Sites

Escolha **Sites**, crie uma aba e informe endereços HTTP/HTTPS pelo botão **Endereços**. Cada painel tem sessão própria. Alternar de aba oculta os outros painéis; as `WebContentsView` continuam abertas, não navegam para `about:blank` e usam `backgroundThrottling: false`. O áudio de sessões carregadas não é silenciado ao alternar.

## Aplicativos do computador

Escolha **Computador** e crie uma aba de aplicativos. Configure cada painel com um executável `.exe`, argumentos opcionais e, se necessário, parte do título da janela. O Sincronize tenta encaixar a janela Windows no painel. Os processos continuam executando ao alternar as abas; a janela fica oculta enquanto seu painel não está selecionado.

Esse encaixe nativo só está implementado para Windows e depende do comportamento do aplicativo. Programas que reutilizam janelas antigas, abrem processos separados sem um título identificável, exigem elevação, usam anti-cheat ou tela cheia exclusiva podem não aceitar o encaixe. Quando um launcher abre a janela em outro processo, preencha o filtro de título. O Sincronize não guarda credenciais. Mesmo com o processo mantido, o próprio programa pode pausar sua atividade quando sua janela está oculta.

## Controles e monitoramento

- **Restaurar grade** mostra os quatro painéis da aba atual.
- **Limpar cache** (em Sites) limpa o cache de rede da aba selecionada e recarrega páginas configuradas. Cookies e `localStorage` são preservados.
- O indicador **FPS** mostra a taxa de atualização da interface do Sincronize em tempo real; ele não mede o FPS interno dos aplicativos encaixados.
- Arraste as divisórias da grade para ajustar os painéis. Os botões de renomear, focar, abrir e ocultar atuam no painel correspondente.

Dados dos sites ficam nas partições persistentes do Electron, separadas por aba e conta. A aba antiga Poke Idle mantém seus identificadores de sessão para preservar logins existentes. O preview HTML estático não fornece sessões Electron nem integração com janelas do Windows.
