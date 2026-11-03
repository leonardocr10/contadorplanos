@echo off
chcp 65001 >nul
title Cotador de Planos
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto semnode

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAIOR=%%a
if %NODE_MAIOR% LSS 22 goto nodeantigo

if exist node_modules goto instalado
echo Primeira execução: instalando o cotador. Isso pode levar alguns minutos.
call npm install --omit=dev --no-fund --no-audit
if errorlevel 1 goto falhainstalar
:instalado

if not exist .env copy .env.example .env >nul

echo Cotador rodando. Feche esta janela para encerrar.
echo.
node --disable-warning=ExperimentalWarning server\index.js
if errorlevel 1 pause
exit /b

:semnode
echo O Node.js não está instalado neste computador.
echo Baixe a versão LTS em https://nodejs.org , instale e abra este arquivo de novo.
echo.
pause
exit /b 1

:nodeantigo
echo A versão do Node.js deste computador é antiga demais para o cotador.
echo Baixe a versão LTS em https://nodejs.org , instale e abra este arquivo de novo.
echo.
pause
exit /b 1

:falhainstalar
echo Não consegui instalar o cotador. Verifique a internet e tente de novo.
echo.
pause
exit /b 1
