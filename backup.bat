@echo off
chcp 65001 >nul
title Backup do Cotador
cd /d "%~dp0"

if not exist dados\cotador.db (
  echo Ainda não existe banco para copiar. Abra o cotador uma vez antes.
  pause
  exit /b 1
)

if not exist backups mkdir backups
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set CARIMBO=%%i
copy /y dados\cotador.db "backups\cotador-%CARIMBO%.db" >nul
if errorlevel 1 (
  echo Não consegui copiar o banco.
  pause
  exit /b 1
)

rem O robocopy usa códigos abaixo de 8 para indicar que deu certo.
if exist dados\uploads (
  robocopy dados\uploads "backups\uploads-%CARIMBO%" /E /NFL /NDL /NJH /NJS /NP >nul
  if errorlevel 8 (
    echo O banco foi copiado, mas não consegui copiar as imagens.
    pause
    exit /b 1
  )
  echo Imagens salvas em backups\uploads-%CARIMBO%
)

echo Backup salvo em backups\cotador-%CARIMBO%.db
pause
