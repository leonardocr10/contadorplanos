import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { criarLogin } from "../server/login.js";

function subir(t, env) {
  const app = express();
  app.use(criarLogin(env));
  app.get("/api/segredo", (_req, res) => res.json({ ok: true }));
  app.get("/", (_req, res) => res.send("cotador"));
  return new Promise((ok) => {
    const s = app.listen(0, "127.0.0.1", () => {
      t.after(() => new Promise((fim) => { s.closeAllConnections(); s.close(fim); }));
      ok(`http://127.0.0.1:${s.address().port}`);
    });
  });
}
const entrar = (base, usuario, senha) => fetch(base + "/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ usuario, senha }) });
const ENV = { LOGIN_USUARIO: "fulano", LOGIN_SENHA: "1234" };

test("sem login a API e a tela ficam bloqueadas", async (t) => {
  const base = await subir(t, ENV);
  assert.equal((await fetch(base + "/api/segredo")).status, 401);
  const r = await fetch(base + "/", { redirect: "manual" });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "/login");
});

test("senha certa abre e sair encerra a sessão", async (t) => {
  const base = await subir(t, ENV);
  const r = await entrar(base, "fulano", "1234");
  assert.equal(r.status, 303);
  const set = r.headers.get("set-cookie");
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  const cookie = set.split(";")[0];
  assert.equal((await fetch(base + "/api/segredo", { headers: { cookie } })).status, 200);
  await fetch(base + "/sair", { method: "POST", redirect: "manual", headers: { cookie } });
  assert.equal((await fetch(base + "/api/segredo", { headers: { cookie } })).status, 401);
});

test("senha errada não entra e 5 erros bloqueiam até a senha certa", async (t) => {
  const base = await subir(t, ENV);
  for (let i = 0; i < 5; i++) assert.equal((await entrar(base, "fulano", "errada")).status, 401);
  assert.equal((await entrar(base, "fulano", "1234")).status, 429);
});

test("sem usuário e senha no .env ninguém entra", async (t) => {
  const base = await subir(t, {});
  assert.equal((await entrar(base, "", "")).status, 503);
  assert.equal((await fetch(base + "/api/segredo")).status, 401);
  assert.ok((await (await fetch(base + "/login")).text()).includes("LOGIN_USUARIO"));
});
