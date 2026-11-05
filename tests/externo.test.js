import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { criarAppExterna, criarAppPublica } from "../server/publico.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

let uploadsDoTeste;
function subir(t) {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-externo-"));
  const banco = new Banco(join(pasta, "cotador.db"), join(raiz, "dados", "planos.json"));
  const pastaPublica = join(raiz, "public"), pastaUploads = join(pasta, "uploads");
  uploadsDoTeste = pastaUploads;
  const env = { LOGIN_USUARIO: "fulano", LOGIN_SENHA: "1234" };
  const cotador = criarApp({ banco, pastaPublica, pastaUploads, pastaBackups: join(pasta, "b"), env, exigirLogin: true, aceitarQualquerHost: true });
  const app = criarAppExterna({ publica: criarAppPublica({ banco, pastaPublica, pastaUploads }), cotador });
  return new Promise((ok) => {
    const s = app.listen(0, "127.0.0.1", () => {
      t.after(() => new Promise((fim) => { s.closeAllConnections(); s.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
      ok(s.address().port);
    });
  });
}
// Simula o acesso pelo IP público, que o navegador envia no cabeçalho Host.
const pedir = (port, path, { method = "GET", headers = {}, corpo } = {}) => new Promise((ok, erro) => {
  const r = http.request({ port, host: "127.0.0.1", path, method, headers: { Host: "66.94.100.166:9090", ...headers } }, (res) => {
    let texto = ""; res.on("data", (d) => (texto += d)); res.on("end", () => ok({ status: res.statusCode, headers: res.headers, texto }));
  });
  r.on("error", erro); r.end(corpo);
});

test("a foto do usuário exige login, e a imagem do plano continua aberta", async (t) => {
  const p = await subir(t);
  writeFileSync(join(uploadsDoTeste, "foto-teste.jpg"), "foto");
  writeFileSync(join(uploadsDoTeste, "plano-teste.jpg"), "plano");
  assert.equal((await pedir(p, "/uploads/plano-teste.jpg")).status, 200);
  const foto = await pedir(p, "/uploads/foto-teste.jpg");
  assert.notEqual(foto.status, 200);
  assert.ok(!foto.texto.includes("foto"));
  assert.notEqual((await pedir(p, "/uploads/FOTO-teste.jpg")).status, 200);
  assert.notEqual((await pedir(p, "/uploads/%66oto-teste.jpg")).status, 200);
});

test("pelo IP público o cotador exige login e nada vaza sem ele", async (t) => {
  const p = await subir(t);
  const raizSite = await pedir(p, "/");
  assert.equal(raizSite.status, 303);
  assert.equal(raizSite.headers.location, "/login");
  assert.equal((await pedir(p, "/login")).status, 200);
  for (const rota of ["/api/planos", "/api/cotacoes", "/api/aceites", "/api/config", "/api/backup"]) assert.equal((await pedir(p, rota)).status, 401, rota);
  assert.equal((await pedir(p, "/api/cotacoes/x", { method: "DELETE" })).status, 401);
  assert.equal((await pedir(p, "/index.html")).status, 303);
  assert.equal((await pedir(p, "/js/app.js")).status, 401);
});

test("pelo IP público o login abre o cotador e as propostas seguem sem login", async (t) => {
  const p = await subir(t);
  const r = await pedir(p, "/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, corpo: "usuario=fulano&senha=1234" });
  assert.equal(r.status, 303);
  const cookie = r.headers["set-cookie"][0].split(";")[0];
  assert.equal((await pedir(p, "/api/planos", { headers: { cookie } })).status, 200);
  assert.equal((await pedir(p, "/", { headers: { cookie } })).status, 200);
  const proposta = await pedir(p, "/p/token-que-nao-existe-123456");
  assert.equal(proposta.status, 404);
  assert.ok(proposta.texto.includes("Proposta não encontrada"));
  assert.equal((await pedir(p, "/proposta-pagina.js")).status, 200);
});
