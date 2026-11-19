// Instala a Evolution API (WhatsApp do Resgate e da régua de cobrança) sem Docker, no Windows.
// Chamado pelo instalar-evolution.bat, como administrador. Pode rodar de novo: o que já está pronto é aproveitado.
// Passos: Git, código da Evolution, PostgreSQL, banco e usuário, .env, dependências, banco da Evolution e montagem.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

export const VERSAO = "2.3.7";
const REPOSITORIO = "https://github.com/evolution-foundation/evolution-api.git";
// Chave de exemplo que vem no .env.example da Evolution: nunca pode ficar valendo.
const CHAVE_DE_EXEMPLO = "429683C4C977415CAAFCCE10F7D57E11";
const ARQUIVO_SENHA_POSTGRES = ".senha-postgres";

const segredo = () => randomBytes(20).toString("hex");

// Troca (ou acrescenta) as linhas CHAVE=valor de um .env, mantendo o resto do arquivo.
export function ajustarEnv(texto, valores) {
  let saida = texto.replace(/\r\n/g, "\n");
  for (const [chave, valor] of Object.entries(valores)) {
    const linha = `${chave}=${valor}`;
    const re = new RegExp(`^${chave}=.*$`, "m");
    saida = re.test(saida) ? saida.replace(re, () => linha) : `${saida.replace(/\n*$/, "\n")}${linha}\n`;
  }
  return saida;
}

export function lerEnv(texto, chave) {
  const m = texto.match(new RegExp(`^${chave}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1") : "";
}

// Senha do usuário evolution guardada na conexão do .env, para reaproveitar ao rodar de novo.
export function senhaDaConexao(uri) {
  const m = /^postgresql:\/\/evolution:([^@]+)@/.exec(uri || "");
  return m ? m[1] : "";
}

export function valoresDoEnv(atual, { senhaBanco }) {
  const chaveAtual = lerEnv(atual, "AUTHENTICATION_API_KEY");
  const chave = chaveAtual && chaveAtual !== CHAVE_DE_EXEMPLO ? chaveAtual : segredo();
  return {
    SERVER_URL: "http://127.0.0.1:8080",
    SERVER_PORT: "8080",
    AUTHENTICATION_API_KEY: chave,
    DATABASE_PROVIDER: "postgresql",
    DATABASE_CONNECTION_URI: `'postgresql://evolution:${senhaBanco}@localhost:5432/evolution?schema=evolution_api'`,
    CACHE_REDIS_ENABLED: "false",
    CACHE_LOCAL_ENABLED: "true",
    TELEMETRY_ENABLED: "false",
  };
}

/* ---------- execução ---------- */
const titulo = (n, texto) => console.log(`\n[${n}/8] ${texto}`);
const falhar = (texto) => { console.error(`\nERRO: ${texto}`); process.exit(1); };

function rodar(comando, args, opcoes = {}) {
  const r = spawnSync(comando, args, { stdio: "inherit", shell: true, ...opcoes });
  return r.status === 0;
}

function existe(comando) {
  return spawnSync("where", [comando], { stdio: "ignore", shell: true }).status === 0;
}

function instalarComWinget(id, extra = []) {
  if (!existe("winget")) falhar(`O winget não está disponível neste Windows. Instale ${id} à mão e rode este instalador de novo.`);
  return rodar("winget", ["install", "--id", id, "-e", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements", ...extra]);
}

// O psql da versão mais nova instalada em C:\Program Files\PostgreSQL.
function acharPsql() {
  const base = join(process.env.ProgramFiles || "C:\\Program Files", "PostgreSQL");
  if (!existsSync(base)) return null;
  const versoes = readdirSync(base).filter((v) => existsSync(join(base, v, "bin", "psql.exe"))).sort((a, b) => Number(b) - Number(a));
  return versoes.length ? join(base, versoes[0], "bin", "psql.exe") : null;
}

function psql(caminho, senha, sql) {
  const r = spawnSync(caminho, ["-U", "postgres", "-h", "localhost", "-p", "5432", "-tAc", sql], { env: { ...process.env, PGPASSWORD: senha }, encoding: "utf8" });
  return { ok: r.status === 0, saida: (r.stdout || "").trim(), erro: (r.stderr || "").trim() };
}

async function perguntar(texto) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(texto)).trim();
  } finally {
    rl.close();
  }
}

async function instalar(pasta) {
  console.log(`Instalando a Evolution API ${VERSAO} em ${pasta}. Isso pode levar uns 10 minutos.`);

  titulo(1, "Git");
  if (!existe("git")) {
    if (!instalarComWinget("Git.Git", ["--silent"])) falhar("Não consegui instalar o Git.");
    process.env.PATH = `${join(process.env.ProgramFiles || "C:\\Program Files", "Git", "cmd")};${process.env.PATH}`;
    if (!existe("git")) falhar("O Git foi instalado, mas ainda não aparece. Feche esta janela e rode o instalador de novo.");
  }
  console.log("Git pronto.");

  titulo(2, `Código da Evolution API ${VERSAO}`);
  if (!existsSync(join(pasta, "package.json"))) {
    if (existsSync(pasta) && readdirSync(pasta).length) falhar(`A pasta ${pasta} já existe e não está vazia. Apague ou escolha outra: instalar-evolution.bat D:\\outra-pasta`);
    if (!rodar("git", ["clone", "--branch", VERSAO, "--depth", "1", REPOSITORIO, `"${pasta}"`])) falhar("Não consegui baixar a Evolution API. Confira a internet.");
  } else {
    console.log("Já baixada.");
  }

  titulo(3, "PostgreSQL (banco da Evolution)");
  const arquivoSenha = join(pasta, ARQUIVO_SENHA_POSTGRES);
  let senhaPostgres = existsSync(arquivoSenha) ? readFileSync(arquivoSenha, "utf8").trim() : "";
  let caminhoPsql = acharPsql();
  if (!caminhoPsql) {
    senhaPostgres = segredo();
    // Guarda a senha do administrador do PostgreSQL antes de instalar, para uma nova rodada conseguir entrar.
    writeFileSync(arquivoSenha, senhaPostgres);
    const opcoes = `--mode unattended --unattendedmodeui none --superpassword ${senhaPostgres} --serverport 5432 --disable-components stackbuilder`;
    if (!instalarComWinget("PostgreSQL.PostgreSQL.16", ["--override", `"${opcoes}"`])) falhar("Não consegui instalar o PostgreSQL.");
    caminhoPsql = acharPsql();
    if (!caminhoPsql) falhar("O PostgreSQL foi instalado, mas não achei o psql.exe. Rode o instalador de novo.");
  }
  console.log(`PostgreSQL pronto (${caminhoPsql}).`);

  titulo(4, "Usuário e banco evolution");
  for (let tentativa = 0; !senhaPostgres || !psql(caminhoPsql, senhaPostgres, "SELECT 1").ok; tentativa++) {
    if (tentativa >= 3) falhar("Não consegui entrar no PostgreSQL com essa senha.");
    senhaPostgres = await perguntar("Digite a senha do usuário postgres (a que foi escolhida ao instalar o PostgreSQL): ");
  }
  const arquivoEnv = join(pasta, ".env");
  const envAtual = existsSync(arquivoEnv) ? readFileSync(arquivoEnv, "utf8") : readFileSync(join(pasta, ".env.example"), "utf8");
  const senhaBanco = senhaDaConexao(lerEnv(envAtual, "DATABASE_CONNECTION_URI")) || segredo();
  const temUsuario = psql(caminhoPsql, senhaPostgres, "SELECT 1 FROM pg_roles WHERE rolname = 'evolution'").saida === "1";
  const usuario = psql(caminhoPsql, senhaPostgres, `${temUsuario ? "ALTER" : "CREATE"} USER evolution WITH PASSWORD '${senhaBanco}'`);
  if (!usuario.ok) falhar(`Não consegui criar o usuário evolution: ${usuario.erro}`);
  if (psql(caminhoPsql, senhaPostgres, "SELECT 1 FROM pg_database WHERE datname = 'evolution'").saida !== "1") {
    const banco = psql(caminhoPsql, senhaPostgres, "CREATE DATABASE evolution OWNER evolution");
    if (!banco.ok) falhar(`Não consegui criar o banco evolution: ${banco.erro}`);
  }
  console.log("Usuário e banco prontos.");

  titulo(5, "Configuração (.env da Evolution)");
  const valores = valoresDoEnv(envAtual, { senhaBanco });
  writeFileSync(arquivoEnv, ajustarEnv(envAtual, valores));
  console.log("Configuração gravada.");

  titulo(6, "Dependências (npm install)");
  if (!rodar("npm", ["install", "--no-fund", "--no-audit"], { cwd: pasta })) falhar("Não consegui instalar as dependências da Evolution.");

  titulo(7, "Banco da Evolution (tabelas)");
  if (!rodar("npm", ["run", "db:generate"], { cwd: pasta })) falhar("Falhou o db:generate.");
  // O script do Windows copia as migrações com xcopy, que pergunta antes de sobrescrever: a pasta sai antes.
  rmSync(join(pasta, "prisma", "migrations"), { recursive: true, force: true });
  if (!rodar("npm", ["run", "db:deploy:win"], { cwd: pasta })) falhar("Falhou o db:deploy:win.");

  titulo(8, "Montagem (npm run build)");
  if (!rodar("npm", ["run", "build"], { cwd: pasta })) falhar("Falhou a montagem da Evolution.");

  console.log(`
==============================================================
Evolution API instalada em ${pasta}.

1. No arquivo .env do cotador, coloque estas duas linhas:

   EVOLUTION_URL=http://127.0.0.1:8080
   EVOLUTION_API_KEY=${valores.AUTHENTICATION_API_KEY}

2. Abra o evolution.bat (como administrador na primeira vez).
3. Feche a janela do cotador e abra o iniciar.bat de novo.
==============================================================`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  instalar(process.argv[2] || "C:\\evolution-api").catch((e) => falhar(e.message));
}
