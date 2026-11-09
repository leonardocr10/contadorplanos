import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { criarAppPublica } from "../server/publico.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

async function subir(t) {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-cache-"));
  const banco = new Banco(join(pasta, "c.db"), join(raiz, "dados", "planos.json"));
  const pastaUploads = join(pasta, "u");
  mkdirSync(pastaUploads, { recursive: true });
  writeFileSync(join(pastaUploads, "imagem-teste.png"), "png");
  const opcoes = { banco, pastaPublica: join(raiz, "public"), pastaUploads };
  const ouvir = (app) => new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  const [cotador, publica] = await Promise.all([ouvir(criarApp({ ...opcoes, pastaBackups: join(pasta, "b"), env: {} })), ouvir(criarAppPublica(opcoes))]);
  t.after(() => new Promise((fim) => {
    for (const s of [cotador, publica]) s.closeAllConnections();
    cotador.close(() => publica.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }));
  }));
  const cache = async (porta, rota) => (await fetch(`http://127.0.0.1:${porta.address().port}${rota}`)).headers.get("cache-control");
  return { cotador: (rota) => cache(cotador, rota), publica: (rota) => cache(publica, rota) };
}

test("dados da API não ficam guardados no navegador", async (t) => {
  const { cotador } = await subir(t);
  for (const rota of ["/api/cotacoes", "/api/status", "/api/backup", "/api/nao-existe"]) assert.equal(await cotador(rota), "no-store", rota);
  // A lista de planos (sem dados de clientes) fica guardada e é conferida a cada abertura.
  assert.equal(await cotador("/api/planos"), "private, no-cache");
});

test("lista de planos vem comprimida e responde 304 quando nada mudou", async (t) => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-gzip-"));
  const banco = new Banco(join(pasta, "c.db"), join(raiz, "dados", "planos.json"));
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "u"), pastaBackups: join(pasta, "b"), env: {} });
  const servidor = await new Promise((ok) => { const s = app.listen(0, "127.0.0.1", () => ok(s)); });
  t.after(() => new Promise((fim) => { servidor.closeAllConnections(); servidor.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
  const url = `http://127.0.0.1:${servidor.address().port}/api/planos`;
  const r = await fetch(url, { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(r.headers.get("content-encoding"), "gzip");
  assert.ok((await r.json()).length > 0);
  const etag = r.headers.get("etag");
  assert.ok(etag);
  // Como o navegador faz: só o If-None-Match (o fetch do Node acrescentaria Cache-Control: no-cache).
  const status = (cabecalhos) => new Promise((ok) => get(url, { headers: cabecalhos }, (res) => { res.resume(); ok(res.statusCode); }));
  assert.equal(await status({ "If-None-Match": etag }), 304);
  // Depois de salvar um plano, a lista muda e vem de novo.
  const p = banco.listarPlanos()[0];
  banco.gravarPlano(p.id, { ...p, subtitulo: "Outro subtítulo" });
  assert.equal(await status({ "If-None-Match": etag }), 200);
  // A tela e os scripts também vêm comprimidos.
  const js = await fetch(url.replace("/api/planos", "/js/cotacao.js"), { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(js.headers.get("content-encoding"), "gzip");
});

test("telas e scripts são sempre conferidos, e fontes e imagens ficam guardadas", async (t) => {
  const { cotador, publica } = await subir(t);
  // Telas e scripts: a versão nova de uma atualização vale na próxima abertura.
  for (const rota of ["/", "/index.html", "/js/app.js", "/css/app.css"]) assert.equal(await cotador(rota), "private, no-cache", rota);
  assert.match(await cotador("/fonts/figtree-latin-wght-normal.woff2"), /^public, max-age=2592000$/);
  assert.match(await cotador("/img/logo-plam.png"), /^public, max-age=86400$/);
  // A imagem enviada tem nome único: nunca muda, então pode ficar guardada.
  assert.match(await cotador("/uploads/imagem-teste.png"), /^private, max-age=\d+, immutable$/);
  // Na porta pública, o que é dos planos pode ser guardado por qualquer um; o script da página é sempre conferido.
  assert.match(await publica("/uploads/imagem-teste.png"), /^public, max-age=\d+, immutable$/);
  assert.match(await publica("/img/logo-plam.png"), /^public, max-age=86400$/);
  assert.equal(await publica("/proposta-pagina.js"), "public, no-cache");
  assert.equal(await publica("/p/tokenquenaoexistedeverdade123"), null);
});
