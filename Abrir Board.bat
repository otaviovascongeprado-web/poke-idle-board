@echo off
setlocal
set "APP_DIR=%~dp0"
if exist "%~dp0poke-idle-board\node_modules\electron" set "APP_DIR=%~dp0poke-idle-board\"
cd /d "%APP_DIR%"

if not exist "node_modules\electron\dist\electron.exe" (
  where npm.cmd >nul 2>nul
  if errorlevel 1 (
    echo Node.js/npm nao foi encontrado.
    echo Instale o Node.js LTS e tente novamente.
    pause
    exit /b 1
  )
  echo Instalando dependencias do board...
  call npm.cmd install
  if errorlevel 1 (
    echo Erro ao instalar dependencias.
    pause
    exit /b 1
  )
)

start "" "%APP_DIR%node_modules\electron\dist\electron.exe" "%APP_DIR%."
exit
