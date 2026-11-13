// Financeiro: corretoras, regras de comissão e a comissão de cada contrato vendido.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { calcularComissao, parcelaDe, rotuloDoSegmento, somarMeses, totalDaRegra } from "../public/js/comissao.js";

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

test("regra: segmentos, parcelas por posição e total", () => {
  assert.equal(rotuloDoSegmento("PF"), "Pessoa física");
  assert.equal(rotuloDoSegmento("PME"), "PME");
  assert.equal(parcelaDe({ parcelas: [100, 50] }, 1), 50);
  assert.equal(parcelaDe({ parcelas: [100, 50] }, 3), 0);
  assert.equal(totalDaRegra({ angariacao: 100, parcelas: [100, 0, 25] }), 225);
  assert.equal(somarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(somarMeses("2026-11-20", 2), "2027-01-20");
});

test("comissão: angariação no ato da venda e parcelas mês a mês, tudo sobre a mensalidade", () => {
  const contrato = { valor: 400, ativacao: "2026-12-10", adesao: 150 };
  const pme = calcularComissao(contrato, { angariacao: 0, parcelas: [100, 100, 50] });
  assert.deepEqual(pme.itens.map((i) => [i.rotulo, i.data, i.valor]), [["1ª parcela", "2026-12-10", 400], ["2ª parcela", "2027-01-10", 400], ["3ª parcela", "2027-02-10", 200]]);
  assert.equal(pme.total, 1000);
  const pulando = calcularComissao(contrato, { angariacao: 50, parcelas: [0, 25] });
  assert.deepEqual(pulando.itens.map((i) => [i.rotulo, i.data, i.valor]), [["Angariação", "2026-12-10", 200], ["2ª parcela", "2027-01-10", 100]]);
  assert.equal(pulando.total, 300);
  assert.equal(calcularComissao(contrato, null).total, 0);
});

test("corretoras e regras: cadastro com os planos do sistema, edição e exclusão", async (t) => {
  const { api } = await subir(t);
  assert.deepEqual((await api("/api/financeiro/corretoras")).corpo, []);
  const c = (await api("/api/financeiro/corretoras", "POST", { nome: "Corretora PJ" })).corpo;
  assert.equal((await api("/api/financeiro/corretoras", "POST", { nome: "corretora pj" })).status, 400);
  assert.equal((await api("/api/financeiro/corretoras", "POST", { nome: " " })).status, 400);

  const regra = (extra) => ({ nome: "AMIL PRATA 30%", segmento: "PME", parcelas: [100, 100, 50], ...extra });
  const amil = (await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", regra())).corpo;
  assert.deepEqual([amil.nome, amil.segmento, amil.parcelas], ["AMIL PRATA 30%", "PME", [100, 100, 50]]);
  // Plano fora da lista do sistema ou de outro segmento (PF usa planos PF; PME, planos CNPJ) não passa.
  for (const ruim of [{ nome: "" }, { nome: "Plano Inventado" }, { nome: "AMIL OURO" }, { segmento: "PF" }, { segmento: "Adesão PF" }, { parcelas: [-1] }, { parcelas: [10, 10, 10, 10, 10] }, { parcelas: [] }, { parcelas: [0, 0] }, { nome: "AMIL OURO", segmento: "PF", angariacao: -1 }]) {
    assert.equal((await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", regra(ruim))).status, 400, JSON.stringify(ruim));
  }
  // Parcelas em branco no fim não contam; só a angariação também vale.
  const pf = (await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", regra({ nome: "AMIL OURO", segmento: "PF", angariacao: 100, parcelas: [100, 50, null, ""] }))).corpo;
  assert.deepEqual([pf.segmento, pf.angariacao, pf.parcelas], ["PF", 100, [100, 50]]);
  // No PME a angariação é ignorada.
  const p4 = (await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", regra({ nome: "PLAMEDH BASIC", angariacao: 100, parcelas: [0, 30, 0, 20] }))).corpo;
  assert.deepEqual([p4.angariacao, p4.parcelas], [0, [0, 30, 0, 20]]);
  assert.equal((await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", regra({ nome: "PLAM TOTAL", angariacao: 80, parcelas: [] }))).status, 400);
  assert.equal((await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", regra({ nome: "PLAM SAÚDE", segmento: "PF", angariacao: 80, parcelas: [] }))).status, 201);
  let [lista] = (await api("/api/financeiro/corretoras")).corpo;
  assert.deepEqual(lista.regras.map((r) => r.nome), ["AMIL PRATA 30%", "AMIL OURO", "PLAMEDH BASIC", "PLAM SAÚDE"]);

  const editada = (await api(`/api/financeiro/regras/${amil.id}`, "PUT", regra({ parcelas: [100, 50] }))).corpo;
  assert.deepEqual(editada.parcelas, [100, 50]);
  assert.equal((await api(`/api/financeiro/corretoras/${c.id}`, "PUT", { nome: "Corretora Freelancer" })).corpo.nome, "Corretora Freelancer");
  assert.equal((await api(`/api/financeiro/regras/${amil.id}`, "DELETE")).status, 204);
  assert.equal((await api(`/api/financeiro/regras/${amil.id}`, "DELETE")).status, 404);
  // Editar com um plano que não existe não passa.
  assert.equal((await api(`/api/financeiro/regras/${pf.id}`, "PUT", regra({ nome: "Plano Inventado", segmento: "PF" }))).status, 400);
  [lista] = (await api("/api/financeiro/corretoras")).corpo;
  assert.equal(lista.regras.length, 3);
  assert.equal((await api(`/api/financeiro/corretoras/${c.id}`, "DELETE")).status, 204);
  assert.deepEqual((await api("/api/financeiro/corretoras")).corpo, []);
});

test("cada contrato guarda a regra; apagar a regra deixa o contrato sem regra", async (t) => {
  const { api } = await subir(t);
  const c = (await api("/api/financeiro/corretoras", "POST", { nome: "Corretora A" })).corpo;
  const r = (await api(`/api/financeiro/corretoras/${c.id}/regras`, "POST", { nome: "PLAM SAÚDE", segmento: "PF", parcelas: [100, 50] })).corpo;
  const contrato = (await api("/api/contratos", "POST", { nome: "Maria", fone: "34999990000", plano: "PLAM SAÚDE", valor: 300, ativacao: "2026-12-01" })).corpo;
  assert.equal(contrato.regraId, null);
  // O valor da adesão não é mais guardado.
  const salvo = (await api(`/api/contratos/${contrato.id}/comissao`, "PATCH", { regraId: r.id, adesao: "120.5" })).corpo;
  assert.deepEqual([salvo.regraId, salvo.adesao], [r.id, null]);
  assert.equal((await api(`/api/contratos/${contrato.id}/comissao`, "PATCH", { regraId: "nao-existe" })).status, 400);
  assert.equal((await api("/api/contratos/nao-existe/comissao", "PATCH", { regraId: r.id })).status, 404);
  // Editar o contrato não perde a comissão.
  await api(`/api/contratos/${contrato.id}`, "PUT", { nome: "Maria Souza", fone: "34999990000", plano: "PLAM SAÚDE", valor: 310, ativacao: "2026-12-01" });
  let [x] = (await api("/api/contratos")).corpo;
  assert.deepEqual([x.nome, x.regraId], ["Maria Souza", r.id]);
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

test("ao atualizar, saem as regras antigas que não são de um plano cadastrado", () => {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-fin-mig-"));
  const arquivo = join(pasta, "cotador.db"), planos = join(raiz, "dados", "planos.json");
  try {
    let banco = new Banco(arquivo, planos);
    const c = banco.criarCorretora("Nexyun");
    banco.criarRegras(c.id, [
      { nome: "Bradesco Dental", segmento: "PF", angariacao: 0, parcelas: [100] },
      { nome: "Affix", segmento: "Adesão PF", angariacao: 100, parcelas: [25] },
      { nome: "AMIL OURO", segmento: "PME", angariacao: 0, parcelas: [100] },
      { nome: "AMIL OURO", segmento: "PF", angariacao: 100, parcelas: [100, 50] },
      { nome: "AMIL OURO 30%", segmento: "PME", angariacao: 0, parcelas: [100] },
    ]);
    const antiga = banco.listarCorretoras()[0].regras[0].id;
    const contrato = banco.criarContrato({ nome: "Maria", fone: "34999990000", plano: "AMIL OURO", valor: 300, ativacao: "2026-12-01" });
    banco.definirComissaoDoContrato(contrato.id, antiga, null);
    const versao = banco.db.prepare("PRAGMA user_version").get().user_version;
    banco.db.exec(`PRAGMA user_version = ${versao - 1}`);
    banco.fechar();
    banco = new Banco(arquivo, planos);
    assert.deepEqual(banco.listarCorretoras()[0].regras.map((r) => `${r.nome}|${r.segmento}`), ["AMIL OURO|PF", "AMIL OURO 30%|PME"]);
    assert.equal(banco.listarContratos().find((x) => x.id === contrato.id).regraId, null);
    banco.fechar();
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
