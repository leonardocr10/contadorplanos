@echo off
chcp 65001 >nul
title Instalar a Evolution API (WhatsApp do cotador)
cd /d "%~dp0"
rem Instala a Evolution API sem Docker em C:\evolution-api (ou na pasta passada: instalar-evolution.bat D:\evolution-api).
rem Precisa ser executado como administrador, porque instala o Git e o PostgreSQL.

net session >nul 2>nul
if errorlevel 1 goto semadmin

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 goto semnode

node scripts\instalar-evolution.js %1
echo.
pause
exit /b

:semadmin
echo Este instalador precisa de permissão de administrador.
echo Clique com o botão direito no instalar-evolution.bat e escolha Executar como administrador.
echo.
pause
exit /b 1

:semnode
echo O Node.js não está instalado. Abra primeiro o iniciar.bat do cotador, que instala o Node.js.
echo.
pause
exit /b 1
