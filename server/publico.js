// Servidor público: é o único ligado ao túnel. Entrega só as páginas das propostas e os arquivos que
// elas usam. A API, o histórico e o backup ficam no outro servidor, que não sai deste computador.
import express from "express";
import { join } from "node:path";
import { renderizarProposta } from "./proposta-html.js";

const paginaErro = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Proposta não encontrada</title><body style="font-family:system-ui,sans-serif;padding:32px"><h1>Proposta não encontrada</h1><p>Confira o link ou peça um novo ao seu corretor.</p></body></html>`;

export function criarAppPublica({ banco, pastaPublica, pastaUploads }) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    next();
  });

  app.get("/p/:token", (req, res) => {
    const proposta = /^[\w-]{20,}$/.test(req.params.token) ? banco.obterProposta(req.params.token) : null;
    if (!proposta) return res.status(404).type("html").send(paginaErro);
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(renderizarProposta(proposta));
  });

  const estaticos = { index: false, dotfiles: "deny" };
  app.use("/fonts", express.static(join(pastaPublica, "fonts"), estaticos));
  app.use("/img", express.static(join(pastaPublica, "img"), estaticos));
  app.use("/uploads", express.static(pastaUploads, estaticos));

  app.use((_req, res) => res.status(404).type("html").send(paginaErro));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).type("html").send(paginaErro);
  });
  return app;
}
