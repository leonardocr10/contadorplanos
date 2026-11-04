import test from "node:test";
import assert from "node:assert/strict";
import { criarSistema } from "../server/sistema.js";

const falso = (commits, extra = {}) => {
  const chamadas = [];
  let i = 0, reinicios = 0;
  const s = criarSistema({
    raiz: "x", podeReiniciar: () => true, reiniciar: () => reinicios++,
    rodarGit: async (...a) => { chamadas.push(a.join(" ")); if (a[0] === "pull" && extra.falha) throw new Error("falhou"); if (a[0] === "pull") i = 1; return commits[i]; },
    ...extra,
  });
  return { s, chamadas, reinicios: () => reinicios };
};

test("sem versão nova não reinicia", async () => {
  const f = falso(["a", "a"]);
  assert.deepEqual(await f.s.atualizar(), { atualizado: false });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(f.reinicios(), 0);
  assert.ok(f.chamadas.includes("pull --ff-only"));
});

test("com versão nova reinicia", async () => {
  const f = falso(["a", "b"]);
  assert.deepEqual(await f.s.atualizar(), { atualizado: true, reiniciando: true });
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(f.reinicios(), 1);
});

test("fora do iniciar.bat só baixa e avisa", async () => {
  const f = falso(["a", "b"], { podeReiniciar: () => false });
  assert.deepEqual(await f.s.atualizar(), { atualizado: true, reiniciando: false });
});

test("falha no git não trava novas tentativas", async () => {
  const f = falso(["a", "a"], { falha: true });
  await assert.rejects(f.s.atualizar());
  await assert.rejects(f.s.atualizar());
});
