@echo off
chcp 65001 >nul
title Cotador de Planos
cd /d "%~dp0"

rem Um Node recém-instalado ainda pode não estar no PATH desta janela.
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"

where node >nul 2>nul
if not errorlevel 1 goto temnode

echo O Node.js não está instalado. Instalando agora, o que pode levar alguns minutos.
echo Se o Windows pedir permissão, clique em Sim.
where winget >nul 2>nul
if errorlevel 1 goto semnode
winget install --id OpenJS.NodeJS.LTS --exact --version 24.22.1 --source winget --silent --accept-package-agreements --accept-source-agreements
if not exist "%ProgramFiles%\nodejs\node.exe" winget install --id OpenJS.NodeJS.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements
if not exist "%ProgramFiles%\nodejs\node.exe" goto semnode
set "PATH=%ProgramFiles%\nodejs;%PATH%"
:temnode

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAIOR=%%a
if %NODE_MAIOR% LSS 22 goto nodeantigo

node scripts\verificar-dependencias.js
if not errorlevel 1 goto instalado
echo Instalando as dependências do cotador. Isso pode levar alguns minutos.
call npm ci --omit=dev --no-fund --no-audit
if errorlevel 1 goto falhainstalar
node scripts\verificar-dependencias.js
if errorlevel 1 goto falhainstalar
:instalado

if not exist .env copy .env.example .env >nul

rem Abre a porta das propostas no firewall do Windows. Só funciona como administrador.
netsh advfirewall firewall show rule name="Cotador Propostas 9090" >nul 2>nul
if not errorlevel 1 goto portaliberada
netsh advfirewall firewall add rule name="Cotador Propostas 9090" dir=in action=allow protocol=TCP localport=9090 >nul 2>nul
if not errorlevel 1 goto portaliberada
echo ATENÇÃO: não consegui liberar a porta 9090 no firewall.
echo Clique com o botão direito neste arquivo e escolha Executar como administrador.
echo.
:portaliberada

findstr /b /r /c:"PUBLIC_URL=." .env >nul 2>nul
if not errorlevel 1 goto temendereco
echo ATENÇÃO: os links das propostas só abrem nesta máquina.
echo No arquivo .env, preencha PUBLIC_URL com o endereço público, por exemplo:
echo PUBLIC_URL=http://IP_DA_MAQUINA:9090
echo.
:temendereco

echo Cotador rodando. Feche esta janela para encerrar.
echo.
node --disable-warning=ExperimentalWarning server\index.js
if errorlevel 1 pause
exit /b

:semnode
echo Não consegui instalar o Node.js automaticamente.
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
echo Não consegui instalar as dependências. Verifique a internet e tente de novo.
echo.
pause
exit /b 1
