// Inicia o cotador: lê o .env, abre o banco, sobe os servidores e abre o navegador.
import { exec } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Banco } from "./db.js";
import { CODIGO_REINICIAR, criarSistema } from "./sistema.js";
import { criarApp } from "./app.js";
import { criarResgate } from "./resgate.js";
import { criarRegua } from "./regua.js";
import { criarEnviadorDeEmail } from "./email.js";
import { criarAppExterna, criarAppPublica, enderecoDosLinks } from "./publico.js";
import { hojeLocal } from "../public/js/mensalidade.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(join(raiz, ".env"));
} catch {
  // Sem .env o cotador usa os padrões; só a leitura automática fica indisponível.
}

const porta = Number(process.env.PORT) || 3210;
// Na internet, as propostas abrem sem login e a tela do cotador exige login.
const portaPublica = Number(process.env.PORT_PUBLICA) || 9090;
const hostPublico = process.env.HOST_PUBLICO || "0.0.0.0";
const endereco = `http://localhost:${porta}`;
const abrirNavegador = () => {
  if (process.env.COTADOR_NAO_ABRIR) return;
  exec(`start "" "${endereco}"`);
};

const pastaDados = process.env.COTADOR_PASTA_DADOS || join(raiz, "dados");
mkdirSync(pastaDados, { recursive: true });
const banco = new Banco(join(pastaDados, "cotador.db"), join(raiz, "dados", "planos.json"));
const pastaPublica = join(raiz, "public"), pastaUploads = join(pastaDados, "uploads");
let estadoLinks = { estado: "conectando", url: null, local: true };
const sistema = criarSistema({
  raiz,
  podeReiniciar: () => process.env.COTADOR_PELO_BAT === "1",
  reiniciar: () => {
    servidorPublico?.close();
    servidor.close();
    banco.fechar();
    process.exit(CODIGO_REINICIAR);
  },
});
// O resgate é um só para as duas portas: a fila de envio e o intervalo entre as mensagens ficam juntos.
const resgate = criarResgate({ banco });
const opcoesCotador = {
  sistema,
  banco,
  resgate,
  pastaPublica,
  pastaUploads,
  pastaBackups: join(raiz, "backups"),
  exigirLogin: true,
  linkPublico: () => estadoLinks,
};
const app = criarApp(opcoesCotador);
// Lembretes das mensalidades: o mesmo WhatsApp do resgate e o e-mail do servidor.
const regua = criarRegua({ banco, evolution: resgate.evolution, enviarEmail: criarEnviadorDeEmail(process.env) });

const servidor = app.listen(porta, "127.0.0.1", (erro) => {
  if (erro) return tratarErroDePorta(erro);
  console.log(`Cotador disponível em ${endereco}`);
  resgate.iniciar();
  iniciarMensalidades();
  if (resgate.configurado) console.log("Resgate: envio automático pelo WhatsApp ligado (Evolution API).");
  abrirNavegador();
  iniciarLinks();
});

// Mensalidades: cria os meses novos e aplica o bloqueio por atraso ao abrir e de hora em hora,
// mesmo que ninguém abra a tela.
function iniciarMensalidades() {
  const rodar = () => {
    try {
      const { bloqueados, liberados } = banco.processarMensalidades(hojeLocal());
      if (bloqueados.length) console.log(`Mensalidades: ${bloqueados.length} login(s) bloqueado(s) por atraso.`);
      if (liberados.length) console.log(`Mensalidades: ${liberados.length} login(s) liberado(s).`);
    } catch (e) {
      console.error("Mensalidades: não deu para conferir os vencimentos agora.", e.message);
    }
  };
  rodar();
  setInterval(rodar, 60 * 60 * 1000).unref();
  regua.iniciar();
}

let servidorPublico = null;
function iniciarLinks() {
  const publica = criarAppPublica({ banco, pastaPublica, pastaUploads });
  const cotador = criarApp({ ...opcoesCotador, aceitarQualquerHost: true });
  servidorPublico = criarAppExterna({ publica, cotador }).listen(portaPublica, hostPublico, (erro) => {
    if (erro) {
      console.error(`A porta ${portaPublica} está ocupada: os links das propostas ficam desligados. Troque PORT_PUBLICA no arquivo .env.`);
      estadoLinks = { estado: "indisponivel", url: null, local: true };
      return;
    }
    estadoLinks = { estado: "ativo", ...enderecoDosLinks(process.env.PUBLIC_URL, portaPublica) };
    console.log(`Cotador e propostas na internet pela porta ${portaPublica}. Links: ${estadoLinks.url}`);
  });
}

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

for (const sinal of ["SIGINT", "SIGTERM", "SIGBREAK", "SIGHUP"]) {
  process.on(sinal, () => {
    servidorPublico?.close();
    servidor.close();
    banco.fechar();
    process.exit(0);
  });
}
