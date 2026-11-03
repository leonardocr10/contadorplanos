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

echo Backup salvo em backups\cotador-%CARIMBO%.db
pause
