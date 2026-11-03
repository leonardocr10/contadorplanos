// Inicia o cotador: lê o .env, abre o banco, sobe o servidor e abre o navegador.
import { exec } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Banco } from "./db.js";
import { criarApp } from "./app.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(join(raiz, ".env"));
} catch {
  // Sem .env o cotador usa os padrões; só a leitura automática fica indisponível.
}

const porta = Number(process.env.PORT) || 3210;
const endereco = `http://localhost:${porta}`;
const abrirNavegador = () => {
  if (process.env.COTADOR_NAO_ABRIR) return;
  exec(`start "" "${endereco}"`);
};

const pastaDados = join(raiz, "dados");
mkdirSync(pastaDados, { recursive: true });
const banco = new Banco(join(pastaDados, "cotador.db"), join(pastaDados, "planos.json"));
const app = criarApp({
  banco,
  pastaPublica: join(raiz, "public"),
  pastaUploads: join(pastaDados, "uploads"),
  pastaBackups: join(raiz, "backups"),
});

const servidor = app.listen(porta, "127.0.0.1", (erro) => {
  if (erro) return tratarErroDePorta(erro);
  console.log(`Cotador disponível em ${endereco}`);
  abrirNavegador();
});

async function tratarErroDePorta(erro) {
  banco.fechar();
  if (erro.code !== "EADDRINUSE") {
    console.error("Não consegui iniciar o cotador:", erro.message);
    process.exit(1);
  }
  let jaRodando = false;
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/api/status`, { signal: AbortSignal.timeout(2000) });
    jaRodando = (await r.json()).app === "cotador";
  } catch {
    // A porta está com outro programa.
  }
  if (jaRodando) {
    console.log(`O cotador já está rodando em ${endereco}. Abrindo no navegador.`);
    abrirNavegador();
    process.exit(0);
  }
  console.error(`A porta ${porta} está ocupada por outro programa. Troque PORT no arquivo .env e tente de novo.`);
  process.exit(1);
}

for (const sinal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(sinal, () => {
    servidor.close();
    banco.fechar();
    process.exit(0);
  });
}
