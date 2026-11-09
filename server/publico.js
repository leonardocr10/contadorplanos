// Servidor das páginas das propostas: entrega só elas e os arquivos que usam. A API, o histórico e o
// backup ficam no outro servidor, então só esta porta deve ser exposta quando houver um domínio.
import express from "express";
import { comprimir } from "./compressao.js";
import { join } from "node:path";
import { opcoesDeAceite, renderizarProposta } from "./proposta-html.js";
import { cacheDoArquivo, cacheDoEnvio } from "./cache.js";

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
  const daProposta = /^\/(p\/|proposta-pagina\.js$|filtro-select\.js$|fonts\/|img\/|uploads\/(?!foto-))/;
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
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    next();
  });

  const buscar = (token) => (/^[\w-]{20,}$/.test(token) ? banco.obterProposta(token) : null);

  app.get("/p/:token", (req, res) => {
    const proposta = buscar(req.params.token);
    if (!proposta) return res.status(404).type("html").send(paginaErro);
    res.setHeader("Cache-Control", "no-store");
    // Telefone atual do corretor que fez a proposta. As propostas de antes dos logins usam o telefone geral.
    const c = proposta.dados.corretor, dono = c?.usuarioId ? banco.obterUsuario(c.usuarioId) : null;
    const foneCorretor = dono?.fone || (c?.usuarioId ? c.fone : banco.lerConfig().fone);
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

  const enviar = (arquivo) => (_req, res) => res.sendFile(arquivo, { headers: { "Cache-Control": "public, no-cache" } });
  app.get("/proposta-pagina.js", enviar(join(pastaPublica, "proposta-pagina.js")));
  app.get("/filtro-select.js", enviar(join(pastaPublica, "js", "filtro-select.js")));

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
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).type("html").send(paginaErro);
  });
  return app;
}
