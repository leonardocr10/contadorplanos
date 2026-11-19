@echo off
chcp 65001 >nul
title Evolution API (WhatsApp do cotador)
rem Mantém a Evolution API rodando sem Docker: se ela cair, volta sozinha em 10 segundos.
rem A pasta da Evolution é C:\evolution-api; para outra, passe o caminho: evolution.bat D:\evolution-api
set "PASTA=%~1"
if "%PASTA%"=="" set "PASTA=C:\evolution-api"

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 goto semnode
if not exist "%PASTA%\dist\main.js" goto seminstalar
if not exist "%PASTA%\.env" goto seminstalar

rem A Evolution não pode ser aberta pela internet: só o cotador, nesta máquina, fala com ela.
rem A regra bloqueia a porta 8080 de fora; o acesso pelo próprio servidor (127.0.0.1) continua livre.
netsh advfirewall firewall show rule name="Evolution API 8080 bloqueada" >nul 2>nul
if not errorlevel 1 goto portafechada
netsh advfirewall firewall add rule name="Evolution API 8080 bloqueada" dir=in action=block protocol=TCP localport=8080 >nul 2>nul
if not errorlevel 1 goto portafechada
echo ATENÇÃO: não consegui fechar a porta 8080 no firewall.
echo Clique com o botão direito neste arquivo e escolha Executar como administrador.
echo.
:portafechada

cd /d "%PASTA%"
echo Evolution API rodando em http://127.0.0.1:8080. Feche esta janela para encerrar.
echo.
:rodar
node dist\main.js
echo.
echo A Evolution API parou. Abrindo de novo em 10 segundos (feche a janela para encerrar).
timeout /t 10 /nobreak >nul
goto rodar

:semnode
echo O Node.js não está instalado. Abra primeiro o iniciar.bat do cotador, que instala o Node.js.
pause
exit /b 1

:seminstalar
echo Não achei a Evolution API instalada em %PASTA%.
echo Siga o passo a passo "Evolution API sem Docker" na seção Resgate do README.
pause
exit /b 1
