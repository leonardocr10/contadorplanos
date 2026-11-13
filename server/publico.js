// Servidor das páginas das propostas: entrega só elas e os arquivos que usam. A API, o histórico e o
// backup ficam no outro servidor, então só esta porta deve ser exposta quando houver um domínio.
import express from "express";
import { comprimir } from "./compressao.js";
import { join } from "node:path";
import { opcoesDeAceite, renderizarProposta } from "./proposta-html.js";
import { cacheDoArquivo, cacheDoEnvio } from "./cache.js";
import { timingSafeEqual } from "node:crypto";
import { normFone } from "../public/js/calculo.js";
import { linkConversaDireta } from "../public/js/mensagem.js";
import { MAX_ARQUIVO, nomeDoArquivo, tipoDoDocumento } from "./arquivos.js";
import { OUTROS, paginaEntrada, paginaEnvio } from "./documentos-html.js";

// Envio de documentos pelo cliente: o acesso dura 30 dias em cada aparelho e vale só para a proposta dele.
const COOKIE_DOCS = "cotador_docs";
const DURACAO_DOCS = 30 * 24 * 60 * 60;
const MAX_ARQUIVOS_POR_PROPOSTA = 60;
const MAX_TENTATIVAS = 5, ESPERA_TENTATIVAS = 60 * 1000;
// O mesmo número com ou sem o nono dígito é aceito: vale o DDD e os oito últimos dígitos.
const mesmoFone = (a, b) => a.length >= 10 && b.length >= 10 && a.slice(0, 2) === b.slice(0, 2) && a.slice(-8) === b.slice(-8);

const paginaErro = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Proposta não encontrada</title><body style="font-family:system-ui,sans-serif;padding:32px"><h1>Proposta não encontrada</h1><p>Confira o link ou peça um novo ao seu corretor.</p></body></html>`;

// Sem PUBLIC_URL, o link é local e só abre neste computador.
export function enderecoDosLinks(publicUrl, portaPublica) {
  const url = String(publicUrl ?? "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(url)) return { url, local: false };
  if (url) console.error("PUBLIC_URL inválido no arquivo .env: usando o link local.");
  return { url: `http://127.0.0.1:${portaPublica}`, local: true };
}

// Porta da internet: as propostas abrem sem login; todo o resto vai para a tela do cotador, que exige login.
export function criarAppExterna({ publica, cotador }) {
  const app = express();
  app.disable("x-powered-by");
  const daProposta = /^\/(p\/|proposta-pagina\.js$|documentos-pagina\.js$|filtro-select\.js$|fonts\/|img\/|uploads\/(?!foto-))/;
  app.use((req, res, next) => {
    if (daProposta.test(req.path)) return publica(req, res, next);
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    cotador(req, res, next);
  });
  return app;
}

export function criarAppPublica({ banco, pastaPublica, pastaUploads }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(comprimir());
  app.use((_req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    next();
  });

  const buscar = (token) => (/^[\w-]{20,}$/.test(token) ? banco.obterProposta(token) : null);

  // Telefone atual do corretor que fez a proposta. As propostas de antes dos logins usam o telefone geral.
  const foneDoCorretor = (proposta) => {
    const c = proposta.dados.corretor, dono = c?.usuarioId ? banco.obterUsuario(c.usuarioId) : null;
    return dono?.fone || (c?.usuarioId ? c.fone : banco.lerConfig().fone);
  };

  app.get("/p/:token", (req, res) => {
    const proposta = buscar(req.params.token);
    if (!proposta) return res.status(404).type("html").send(paginaErro);
    res.setHeader("Cache-Control", "no-store");
    const foneCorretor = foneDoCorretor(proposta);
    res.type("html").send(renderizarProposta(proposta.dados, { token: proposta.token, aceite: proposta, foneCorretor, agente: req.get("user-agent") }));
  });

  // O aceite só acontece por POST: quem apenas abre o link, como a prévia do WhatsApp, não aceita nada.
  app.post("/p/:token/aceite", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    const proposta = buscar(req.params.token);
    if (!proposta) return res.status(404).type("html").send(paginaErro);
    const opcao = opcoesDeAceite(proposta.dados).find((o) => o.nome === req.body?.acomodacao);
    if (opcao && req.body?.confirmo === "1") banco.aceitarProposta(proposta.token, opcao.nome, opcao.valor);
    res.redirect(303, `/p/${proposta.token}`);
  });

  /* ---------- envio de documentos pelo cliente ---------- */
  const tentativas = new Map();
  const bloqueado = (token) => (tentativas.get(token)?.ate ?? 0) > Date.now();
  const registrarFalha = (token) => {
    if (tentativas.size > 1000) tentativas.clear();
    const f = tentativas.get(token) ?? { n: 0, ate: 0 };
    f.n++;
    if (f.n >= MAX_TENTATIVAS) { f.ate = Date.now() + ESPERA_TENTATIVAS; f.n = 0; }
    tentativas.set(token, f);
  };
  const AVISO_TENTATIVAS = "Muitas tentativas. Aguarde um minuto e tente de novo.";
  const semMemoria = (res) => res.setHeader("Cache-Control", "no-store");
  const aceita = (req) => { const p = buscar(req.params.token); return p?.aceitoEm ? p : null; };
  const cookieDe = (req) => String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE_DOCS}=([\\w-]+)`))?.[1] ?? "";
  const entrou = (req, proposta) => {
    const a = Buffer.from(cookieDe(req)), b = Buffer.from(proposta.docsChave ?? "");
    return b.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  };
  const cookie = (token, valor, duracao) => `${COOKIE_DOCS}=${valor}; Path=/p/${token}/documentos; HttpOnly; SameSite=Lax; Max-Age=${duracao}`;

  // O que a página mostra: cada documento do plano com o que já chegou, sem o conteúdo dos arquivos.
  const estado = (proposta) => {
    const nomes = banco.documentosDaProposta(proposta.dados), arquivos = banco.arquivosDaProposta(proposta.token);
    const paraTela = (a) => ({ id: a.id, nome: a.nome, tamanho: a.tamanho });
    return {
      documentos: nomes.map((nome) => ({ nome, arquivos: arquivos.filter((a) => a.documento === nome).map(paraTela) })),
      // Fora da lista ficam os extras e o que foi enviado para um documento que o plano deixou de pedir.
      outros: { nome: OUTROS, arquivos: arquivos.filter((a) => !nomes.includes(a.documento)).map(paraTela) },
      concluidoEm: proposta.docsConcluidoEm,
      limite: MAX_ARQUIVO,
    };
  };

  app.get("/p/:token/documentos", (req, res) => {
    const proposta = buscar(req.params.token);
    if (!proposta) return res.status(404).type("html").send(paginaErro);
    semMemoria(res);
    if (!proposta.aceitoEm) return res.redirect(303, `/p/${proposta.token}`);
    if (!entrou(req, proposta)) return res.type("html").send(paginaEntrada(proposta, bloqueado(proposta.token) ? { erro: AVISO_TENTATIVAS, bloqueado: true } : {}));
    const fone = normFone(foneDoCorretor(proposta) ?? "");
    const whatsapp = fone.length >= 10 ? linkConversaDireta(fone, `Olá! Estou enviando os documentos do plano ${proposta.dados.plano.nome}.`, req.get("user-agent")) : "";
    res.type("html").send(paginaEnvio(proposta, { whatsapp }));
  });

  app.post("/p/:token/documentos/entrar", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    const proposta = aceita(req);
    if (!proposta) return res.status(404).type("html").send(paginaErro);
    semMemoria(res);
    const digitado = String(req.body?.fone ?? "").slice(0, 30), fone = normFone(digitado);
    if (bloqueado(proposta.token)) return res.status(429).type("html").send(paginaEntrada(proposta, { erro: AVISO_TENTATIVAS, bloqueado: true }));
    if (fone.length < 10 || fone.length > 11) return res.status(400).type("html").send(paginaEntrada(proposta, { erro: "Informe o telefone com DDD, como (34) 99999-0000.", fone: digitado }));
    const esperado = proposta.fone || proposta.docsFone;
    if (esperado && !mesmoFone(fone, esperado)) {
      registrarFalha(proposta.token);
      return res.status(401).type("html").send(paginaEntrada(proposta, { erro: "Este número não confere com o da proposta. Use o WhatsApp em que você recebeu a proposta ou fale com o seu corretor.", fone: digitado }));
    }
    if (!esperado) banco.definirFoneDosDocumentos(proposta.token, fone);
    tentativas.delete(proposta.token);
    res.setHeader("Set-Cookie", cookie(proposta.token, banco.chaveDosDocumentos(proposta.token), DURACAO_DOCS));
    res.redirect(303, `/p/${proposta.token}/documentos`);
  });

  app.post("/p/:token/documentos/sair", (req, res) => {
    const proposta = buscar(req.params.token);
    if (!proposta) return res.status(404).type("html").send(paginaErro);
    res.setHeader("Set-Cookie", cookie(proposta.token, "", 0));
    res.redirect(303, `/p/${proposta.token}/documentos`);
  });

  // Daqui para baixo, só com o telefone conferido.
  const comAcesso = (req, res, next) => {
    semMemoria(res);
    const proposta = aceita(req);
    if (!proposta || !entrou(req, proposta)) return res.status(401).json({ erro: "Informe o seu telefone para continuar.", codigo: "sem_acesso" });
    req.proposta = proposta;
    next();
  };

  app.get("/p/:token/documentos/estado", comAcesso, (req, res) => res.json(estado(req.proposta)));

  // Um arquivo por envio: o documento a que pertence e o nome vêm nos cabeçalhos.
  app.post("/p/:token/documentos/arquivos", comAcesso, express.raw({ type: () => true, limit: MAX_ARQUIVO }), (req, res) => {
    const { proposta } = req;
    let documento = "";
    try { documento = decodeURIComponent(String(req.get("X-Documento") || "")); } catch { /* cai na conferência abaixo */ }
    if (documento !== OUTROS && !banco.documentosDaProposta(proposta.dados).includes(documento)) return res.status(400).json({ erro: "Este documento não faz parte da lista. Atualize a página e tente de novo." });
    const tipo = tipoDoDocumento(req.body);
    if (!tipo) return res.status(400).json({ erro: "Envie uma foto (JPG, PNG ou WebP) ou um arquivo PDF." });
    if (banco.arquivosDaProposta(proposta.token).length >= MAX_ARQUIVOS_POR_PROPOSTA) return res.status(400).json({ erro: "Você chegou ao limite de arquivos. Fale com o seu corretor." });
    banco.guardarArquivoDaProposta(proposta.token, { documento, nome: nomeDoArquivo(req, tipo), tipo, dados: req.body });
    res.status(201).json(estado(proposta));
  });

  app.delete("/p/:token/documentos/arquivos/:arquivo", comAcesso, (req, res) => {
    if (!banco.excluirArquivoDaProposta(req.proposta.token, req.params.arquivo)) return res.status(404).json({ erro: "Arquivo não encontrado." });
    res.json(estado(req.proposta));
  });

  // O cliente avisa o corretor que terminou; pode reabrir para trocar ou acrescentar algum arquivo.
  app.post("/p/:token/documentos/concluir", comAcesso, express.json({ limit: "1kb" }), (req, res) => {
    res.json(estado(banco.concluirDocumentos(req.proposta.token, req.body?.concluido !== false)));
  });

  const enviar = (arquivo) => (_req, res) => res.sendFile(arquivo, { headers: { "Cache-Control": "public, no-cache" } });
  app.get("/proposta-pagina.js", enviar(join(pastaPublica, "proposta-pagina.js")));
  app.get("/filtro-select.js", enviar(join(pastaPublica, "js", "filtro-select.js")));
  app.get("/documentos-pagina.js", enviar(join(pastaPublica, "documentos-pagina.js")));

  const estaticos = { index: false, dotfiles: "deny", setHeaders: (res, caminho) => cacheDoArquivo(res, caminho, { privado: false }) };
  app.use("/fonts", express.static(join(pastaPublica, "fonts"), estaticos));
  app.use("/img", express.static(join(pastaPublica, "img"), estaticos));
  // As fotos dos usuários são do sistema: só as imagens dos planos abrem sem login.
  const eFoto = (caminho) => {
    try {
      return /^\/foto-/i.test(decodeURIComponent(caminho));
    } catch {
      return false;
    }
  };
  app.use("/uploads", (req, res, next) => (eFoto(req.path) ? res.status(404).end() : next()), express.static(pastaUploads, { ...estaticos, setHeaders: cacheDoEnvio({ privado: false }) }));

  app.use((_req, res) => res.status(404).type("html").send(paginaErro));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    // O envio de documentos conversa em JSON: o erro precisa chegar legível à página.
    if (/^\/p\/[\w-]+\/documentos\//.test(req.path)) {
      if (err.type === "entity.too.large") return res.status(413).json({ erro: "Este arquivo passa de 20 MB. Envie uma foto ou um PDF menor." });
      console.error(err);
      return res.status(500).json({ erro: "Não deu para concluir agora. Tente de novo em instantes." });
    }
    console.error(err);
    res.status(500).type("html").send(paginaErro);
  });
  return app;
}
