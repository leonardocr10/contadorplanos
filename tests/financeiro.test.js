// Financeiro: corretoras, regras de comissão e a comissão de cada contrato vendido.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { calcularComissao, lerParcelas, somarMeses, textoDasParcelas, totalDaRegra } from "../public/js/comissao.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function subir(t) {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-fin-"));
  const banco = new Banco(join(pasta, "cotador.db"), join(raiz, "dados", "planos.json"));
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "uploads"), pastaBackups: join(pasta, "backups"), env: {} });
  return new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => {
      t.after(() => new Promise((fim) => { s.closeAllConnections(); s.close(() => { banco.fechar(); rmSync(pasta, { recursive: true, force: true }); fim(); }); }));
      const base = `http://127.0.0.1:${s.address().port}`;
      const api = async (rota, metodo = "GET", json) => {
        const r = await fetch(base + rota, { method: metodo, headers: json ? { "Content-Type": "application/json" } : {}, body: json ? JSON.stringify(json) : undefined });
        return { status: r.status, corpo: r.status === 204 ? null : await r.json() };
      };
      resolve({ banco, api });
    });
  });
}

test("parcelas aceitam lista e o formato N x P", () => {
  assert.deepEqual(lerParcelas("100, 100, 50"), [100, 100, 50]);
  assert.deepEqual(lerParcelas("100; 50%"), [100, 50]);
  assert.deepEqual(lerParcelas("100 -- 25"), [100, 0, 25]);
  assert.deepEqual(lerParcelas("10x30"), Array(10).fill(30));
  assert.deepEqual(lerParcelas("12,5"), [12.5]);
  assert.deepEqual(lerParcelas(""), []);
  assert.equal(lerParcelas("abc"), null);
  assert.equal(lerParcelas("30x10"), null);
  assert.equal(textoDasParcelas([100, 100, 50]), "100% · 100% · 50%");
  assert.equal(textoDasParcelas(Array(10).fill(30)), "10 × 30%");
  assert.equal(totalDaRegra({ angariacao: 100, parcelas: [25] }), 125);
  assert.equal(somarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(somarMeses("2026-11-20", 2), "2027-01-20");
});

test("comissão: angariação sobre a adesão e parcelas sobre a mensalidade, mês a mês", () => {
  const contrato = { valor: 400, ativacao: "2026-12-10", adesao: 150 };
  const pme = calcularComissao(contrato, { angariacao: 0, parcelas: [100, 100, 50] });
  assert.deepEqual(pme.itens.map((i) => [i.rotulo, i.data, i.valor]), [["1ª parcela", "2026-12-10", 400], ["2ª parcela", "2027-01-10", 400], ["3ª parcela", "2027-02-10", 200]]);
  assert.equal(pme.total, 1000);
  const adesao = calcularComissao(contrato, { angariacao: 100, parcelas: [0, 25] });
  assert.deepEqual(adesao.itens.map((i) => [i.rotulo, i.valor]), [["Taxa de angariação", 150], ["2ª parcela", 100]]);
  assert.equal(adesao.total, 250);
  // Sem o valor da adesão, a angariação conta zero.
  assert.equal(calcularComissao({ ...contrato, adesao: null }, { angariacao: 100, parcelas: [50] }).total, 200);
  assert.equal(calcularComissao(contrato, null).total, 0);
});

test("corretoras e regras: cadastro, importação, edição e exclusão", async (t) => {
  const { api } = await subir(t);
  assert.deepEqual((await api("/api/financeiro/corretoras")).corpo, []);
  const c = (await api("/api/financeiro/corretoras", "POST", { nome: "Corretora PJ" })).corpo;
  assert.equal((await api("/api/financeiro/corretoras", "POST", { nome: "corretora pj" })).status, 400);
  assert.equal((await api("/api/financeiro/corretoras", "POST", { nome: " " })).status, 400);

  const regra = (extra) => ({ nome: "Amil Saúde", segmento: "PME", angariacao: 0, parcelas: [100, 100, 50], ...extra });
  const amil = (await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", regra())).corpo;
  assert.deepEqual([amil.nome, amil.segmento, amil.parcelas], ["Amil Saúde", "PME", [100, 100, 50]]);
  for (const ruim of [{ nome: "" }, { segmento: "Outro" }, { parcelas: [-1] }, { parcelas: Array(25).fill(1) }, { angariacao: 0, parcelas: [] }, { angariacao: 2000 }]) {
    assert.equal((await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", regra(ruim))).status, 400, JSON.stringify(ruim));
  }
  // Importação de uma tabela inteira; um erro aponta a linha e não grava nada.
  const lote = [regra({ nome: "Affix", segmento: "Adesão PF", angariacao: 100, parcelas: [25] }), regra({ nome: "Plenitus", segmento: "PF e PME", parcelas: Array(10).fill(30) })];
  const ruim = await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", [...lote, regra({ nome: "Quebrada", segmento: "X" })]);
  assert.equal(ruim.status, 400);
  assert.match(ruim.corpo.erro, /Regra 3 \(Quebrada\)/);
  assert.equal((await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", lote)).status, 201);
  let [lista] = (await api("/api/financeiro/corretoras")).corpo;
  assert.deepEqual(lista.regras.map((r) => r.nome), ["Amil Saúde", "Affix", "Plenitus"]);

  const editada = (await api(`/api/financeiro/regras/${amil.id}`, "PUT", regra({ parcelas: [100, 50] }))).corpo;
  assert.deepEqual(editada.parcelas, [100, 50]);
  assert.equal((await api(`/api/financeiro/corretoras/${c.id}`, "PUT", { nome: "Corretora Freelancer" })).corpo.nome, "Corretora Freelancer");
  assert.equal((await api(`/api/financeiro/regras/${amil.id}`, "DELETE")).status, 204);
  assert.equal((await api(`/api/financeiro/regras/${amil.id}`, "DELETE")).status, 404);
  [lista] = (await api("/api/financeiro/corretoras")).corpo;
  assert.equal(lista.regras.length, 2);
  assert.equal((await api(`/api/financeiro/corretoras/${c.id}`, "DELETE")).status, 204);
  assert.deepEqual((await api("/api/financeiro/corretoras")).corpo, []);
});

test("cada contrato guarda a regra e a adesão; apagar a regra deixa o contrato sem regra", async (t) => {
  const { api } = await subir(t);
  const c = (await api("/api/financeiro/corretoras", "POST", { nome: "Corretora A" })).corpo;
  const r = (await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", { nome: "Affix", segmento: "Adesão PF", angariacao: 100, parcelas: [25] })).corpo;
  const contrato = (await api("/api/contratos", "POST", { nome: "Maria", fone: "34999990000", plano: "PLAM SAÚDE", valor: 300, ativacao: "2026-12-01" })).corpo;
  assert.equal(contrato.regraId, null);
  const salvo = (await api(`/api/contratos/${contrato.id}/comissao`, "PATCH", { regraId: r.id, adesao: "120.5" })).corpo;
  assert.deepEqual([salvo.regraId, salvo.adesao], [r.id, 120.5]);
  assert.equal((await api(`/api/contratos/${contrato.id}/comissao`, "PATCH", { regraId: "nao-existe" })).status, 400);
  assert.equal((await api(`/api/contratos/${contrato.id}/comissao`, "PATCH", { regraId: r.id, adesao: -5 })).status, 400);
  assert.equal((await api("/api/contratos/nao-existe/comissao", "PATCH", { regraId: r.id })).status, 404);
  // Editar o contrato não perde a comissão.
  await api(`/api/contratos/${contrato.id}`, "PUT", { nome: "Maria Souza", fone: "34999990000", plano: "PLAM SAÚDE", valor: 310, ativacao: "2026-12-01" });
  let [x] = (await api("/api/contratos")).corpo;
  assert.deepEqual([x.nome, x.regraId, x.adesao], ["Maria Souza", r.id, 120.5]);
  await api(`/api/financeiro/regras/${r.id}`, "DELETE");
  [x] = (await api("/api/contratos")).corpo;
  assert.equal(x.regraId, null);
});

test("sem acesso ao Financeiro, as rotas ficam fechadas; o padrão de quem não é administrador é sem acesso", async () => {
  const { permissoesDoUsuario } = await import("../server/permissoes.js");
  assert.equal(permissoesDoUsuario("usuario", "{}").financeiro, "nenhum");
  assert.equal(permissoesDoUsuario("usuario", JSON.stringify({ financeiro: "ver" })).financeiro, "ver");
  assert.equal(permissoesDoUsuario("admin", "{}").financeiro, "editar");
});
