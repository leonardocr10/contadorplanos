// Mensalidades do sistema: assinatura de cada corretor, meses gerados, pagamento manual e bloqueio por atraso.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Banco } from "../server/db.js";
import { criarApp } from "../server/app.js";
import { competenciasDevidas, descreverAlteracaoDaCobranca, mensagemDeCobranca, previaDaCobranca, resumoDoCorretor, situacaoDaMensalidade } from "../public/js/mensalidade.js";

const raiz = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function subir(t, relogio) {
  const pasta = mkdtempSync(join(tmpdir(), "cotador-mens-"));
  const banco = new Banco(join(pasta, "cotador.db"), join(raiz, "dados", "planos.json"));
  const app = criarApp({ banco, pastaPublica: join(raiz, "public"), pastaUploads: join(pasta, "uploads"), pastaBackups: join(pasta, "backups"), env: {}, hoje: () => relogio.hoje });
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

test("meses devidos: do início até hoje e o próximo quando vence em poucos dias", () => {
  assert.deepEqual(competenciasDevidas({ inicio: "2026-09", dia: 10 }, "2026-11-19"), ["2026-09", "2026-10", "2026-11"]);
  // Dia 26/11 com vencimento no dia 2: dezembro vence em 6 dias e já aparece.
  assert.deepEqual(competenciasDevidas({ inicio: "2026-11", dia: 2 }, "2026-11-26"), ["2026-11", "2026-12"]);
  assert.deepEqual(competenciasDevidas({ inicio: "2026-12", dia: 20 }, "2026-11-19"), []);
  assert.deepEqual(competenciasDevidas({ inicio: "2026-12", dia: 28 }, "2026-12-30"), ["2026-12"]);
});

test("situação do mês e do corretor", () => {
  const hoje = "2026-11-19";
  assert.equal(situacaoDaMensalidade({ vencimento: "2026-11-10" }, hoje), "atrasada");
  assert.equal(situacaoDaMensalidade({ vencimento: "2026-11-25" }, hoje), "vence");
  assert.equal(situacaoDaMensalidade({ vencimento: "2026-12-25" }, hoje), "aberta");
  assert.equal(situacaoDaMensalidade({ vencimento: "2026-11-10", pagoEm: "2026-11-11" }, hoje), "paga");
  assert.equal(situacaoDaMensalidade({ vencimento: "2026-11-10", dispensada: true }, hoje), "dispensada");
  const a = { ativa: true };
  const r = resumoDoCorretor(a, [{ vencimento: "2026-10-10", valor: 50 }, { vencimento: "2026-11-10", valor: 50 }, { vencimento: "2026-09-10", valor: 50, pagoEm: "2026-09-10" }], hoje);
  assert.deepEqual([r.situacao, r.atrasadas, r.valorAtrasado, r.diasDeAtraso], ["atrasado", 2, 100, 40]);
  assert.equal(resumoDoCorretor(null, [], hoje).situacao, "sem_cobranca");
  assert.equal(resumoDoCorretor({ ativa: false }, [], hoje).situacao, "pausada");
  assert.equal(resumoDoCorretor(a, [{ vencimento: "2026-11-22", valor: 50 }], hoje).situacao, "vence");
  assert.equal(resumoDoCorretor(a, [{ vencimento: "2026-12-10", valor: 50 }], hoje).situacao, "em_dia");
  const texto = mensagemDeCobranca("Maria Souza", [{ competencia: "2026-10", vencimento: "2026-10-10", valor: 49.9 }, { competencia: "2026-12", vencimento: "2026-12-10", valor: 49.9 }], hoje);
  assert.match(texto, /^Olá, Maria!/);
  assert.match(texto, /outubro de 2026: R\$ 49,90 \(vencimento 10\/10\/2026, em atraso\)/);
  assert.doesNotMatch(texto, /dezembro/);
});

test("assinatura gera os meses; administrador fica fora da cobrança", async (t) => {
  const relogio = { hoje: "2026-11-19" };
  const { banco, api } = await subir(t, relogio);
  const maria = banco.criarUsuario({ login: "maria", senhaHash: "x", nome: "Maria" });
  const chefe = banco.criarUsuario({ login: "chefe", senhaHash: "x", perfil: "admin" });

  let lista = (await api("/api/mensalidades")).corpo;
  assert.deepEqual(lista.corretores.map((c) => [c.login, c.situacao]), [["maria", "sem_cobranca"]]);
  assert.equal((await api(`/api/mensalidades/corretores/${chefe.id}/assinatura`, "PUT", { valor: 50, dia: 10, inicio: "2026-11" })).status, 400);
  assert.equal((await api(`/api/mensalidades/corretores/${maria.id}/assinatura`, "PUT", { valor: 0, dia: 10, inicio: "2026-11" })).status, 400);
  assert.equal((await api(`/api/mensalidades/corretores/${maria.id}/assinatura`, "PUT", { valor: 50, dia: 29, inicio: "2026-11" })).status, 400);
  assert.equal((await api(`/api/mensalidades/corretores/${maria.id}/assinatura`, "PUT", { valor: 50, dia: 10, inicio: "nov" })).status, 400);

  const ficha = (await api(`/api/mensalidades/corretores/${maria.id}/assinatura`, "PUT", { valor: 49.9, dia: 10, inicio: "2026-10", observacao: "Plano mensal" })).corpo;
  assert.deepEqual(ficha.mensalidades.map((m) => [m.competencia, m.vencimento, m.valor]), [["2026-11", "2026-11-10", 49.9], ["2026-10", "2026-10-10", 49.9]]);
  assert.deepEqual([ficha.situacao, ficha.atrasadas, ficha.valorAtrasado], ["atrasado", 2, 99.8]);

  // Virou o mês: o mês novo aparece sozinho.
  relogio.hoje = "2026-12-03";
  lista = (await api("/api/mensalidades")).corpo;
  assert.deepEqual(lista.corretores[0].mensalidades.map((m) => m.competencia), ["2026-12", "2026-11", "2026-10"]);

  // Mudar o valor vale para os meses que ainda não venceram; os atrasados ficam como estavam.
  const nova = (await api(`/api/mensalidades/corretores/${maria.id}/assinatura`, "PUT", { valor: 60, dia: 15, inicio: "2026-10" })).corpo;
  assert.deepEqual(nova.mensalidades.map((m) => [m.competencia, m.vencimento, m.valor]), [["2026-12", "2026-12-15", 60], ["2026-11", "2026-11-10", 49.9], ["2026-10", "2026-10-10", 49.9]]);
});

test("pagamento manual, dispensa e bloqueio automático por atraso", async (t) => {
  const relogio = { hoje: "2026-11-19" };
  const { banco, api } = await subir(t, relogio);
  const joao = banco.criarUsuario({ login: "joao", senhaHash: "x" });
  let ficha = (await api(`/api/mensalidades/corretores/${joao.id}/assinatura`, "PUT", { valor: 80, dia: 5, inicio: "2026-10" })).corpo;
  const [nov, out] = ficha.mensalidades;

  // Sem bloqueio ligado, o atraso não mexe no login.
  assert.equal(banco.obterUsuario(joao.id).ativo, true);
  assert.equal((await api("/api/mensalidades/config", "PUT", { diasBloqueio: -1 })).status, 400);
  assert.deepEqual((await api("/api/mensalidades/config", "PUT", { diasBloqueio: 30 })).corpo, { diasBloqueio: 30 });
  // Outubro venceu há 45 dias: o login é desativado.
  assert.equal(banco.obterUsuario(joao.id).ativo, false);
  // Reativar à mão não passa por cima do bloqueio.
  const reativar = await api(`/api/usuarios/${joao.id}`, "PUT", { ativo: true });
  assert.equal(reativar.status, 400);
  assert.match(reativar.corpo.erro, /mensalidade atrasada/);

  assert.equal((await api(`/api/mensalidades/${out.id}`, "PATCH", { pago: true, pagoEm: "2026-12-01" })).status, 400);
  assert.equal((await api(`/api/mensalidades/${out.id}`, "PATCH", { pago: true, forma: "Cheque" })).status, 400);
  ficha = (await api(`/api/mensalidades/${out.id}`, "PATCH", { pago: true, pagoEm: "2026-11-18", forma: "Pix" })).corpo;
  assert.deepEqual(ficha.mensalidades.find((m) => m.id === out.id).pagoEm, "2026-11-18");
  // Pagou o mês mais antigo: novembro está atrasado há 14 dias, abaixo do limite, e o login volta.
  assert.equal(banco.obterUsuario(joao.id).ativo, true);
  assert.equal(ficha.situacao, "atrasado");

  // Dispensar novembro deixa o corretor em dia; mês pago não pode ser dispensado.
  assert.equal((await api(`/api/mensalidades/${out.id}`, "PATCH", { dispensada: true })).status, 400);
  ficha = (await api(`/api/mensalidades/${nov.id}`, "PATCH", { dispensada: true })).corpo;
  assert.equal(ficha.situacao, "em_dia");
  // O mês dispensado não volta a ser cobrado na próxima conferência.
  assert.equal((await api("/api/mensalidades")).corpo.corretores[0].mensalidades.find((m) => m.id === nov.id).dispensada, true);
  // Desfazer o pagamento de outubro bloqueia de novo.
  await api(`/api/mensalidades/${out.id}`, "PATCH", { pago: false });
  assert.equal(banco.obterUsuario(joao.id).ativo, false);
  // Pausar a cobrança libera quem foi bloqueado por ela.
  await api(`/api/mensalidades/corretores/${joao.id}/assinatura`, "PUT", { valor: 80, dia: 5, inicio: "2026-10", ativa: false });
  assert.equal(banco.obterUsuario(joao.id).ativo, true);
});

test("quem o administrador desativou à mão não volta pelo pagamento", async (t) => {
  const relogio = { hoje: "2026-11-19" };
  const { banco, api } = await subir(t, relogio);
  const ana = banco.criarUsuario({ login: "ana", senhaHash: "x" });
  await api("/api/mensalidades/config", "PUT", { diasBloqueio: 5 });
  const ficha = (await api(`/api/mensalidades/corretores/${ana.id}/assinatura`, "PUT", { valor: 30, dia: 1, inicio: "2026-11" })).corpo;
  assert.equal(banco.obterUsuario(ana.id).ativo, false);
  await api(`/api/mensalidades/${ficha.mensalidades[0].id}`, "PATCH", { pago: true });
  assert.equal(banco.obterUsuario(ana.id).ativo, true);
  await api(`/api/usuarios/${ana.id}`, "PUT", { ativo: false });
  await api(`/api/mensalidades/${ficha.mensalidades[0].id}`, "PATCH", { pago: false });
  await api(`/api/mensalidades/${ficha.mensalidades[0].id}`, "PATCH", { pago: true });
  assert.equal(banco.obterUsuario(ana.id).ativo, false);
});

test("próximo vencimento previsto quando o mês ainda não foi criado", () => {
  const a = { ativa: true, inicio: "2026-10", dia: 5 };
  assert.equal(resumoDoCorretor(a, [{ competencia: "2026-11", vencimento: "2026-11-05", valor: 1, pagoEm: "2026-11-05" }], "2026-11-19").proximoVencimento, "2026-12-05");
  assert.equal(resumoDoCorretor({ ...a, inicio: "2027-01" }, [], "2026-11-19").proximoVencimento, "2027-01-05");
  assert.equal(resumoDoCorretor({ ...a, ativa: false }, [], "2026-11-19").proximoVencimento, null);
});

test("prévia da cobrança: valor, dia e os próximos vencimentos", () => {
  const hoje = "2026-11-19";
  assert.equal(previaDaCobranca({ valor: 99.9, dia: 10, inicio: "2026-12" }, hoje),
    "Serão cobrados R$ 99,90 todo dia 10, a partir de 10/12/2026. Próximos vencimentos: 10/12/2026, 10/01/2027, 10/02/2027.");
  // Início no passado: os próximos começam depois de hoje, e a cobrança nova avisa dos meses vencidos.
  const passada = previaDaCobranca({ valor: 50, dia: 25, inicio: "2026-10" }, hoje, { nova: true });
  assert.ok(passada.includes("a partir de 25/10/2026. Próximos vencimentos: 25/11/2026, 25/12/2026, 25/01/2027. Os meses que já venceram"));
  assert.doesNotMatch(previaDaCobranca({ valor: 50, dia: 25, inicio: "2026-10" }, hoje), /já venceram/);
  assert.match(previaDaCobranca({ valor: 50, dia: 10, inicio: "2026-12", ativa: false }, hoje), /^Cobrança pausada/);
  assert.equal(previaDaCobranca({ valor: 0, dia: 10, inicio: "2026-12" }, hoje), "");
  assert.equal(previaDaCobranca({ valor: 10, dia: 31, inicio: "2026-12" }, hoje), "");
});

test("registro de alterações: quem mudou a cobrança e os pagamentos", async (t) => {
  const relogio = { hoje: "2026-11-19" };
  const { banco, api } = await subir(t, relogio);
  const bia = banco.criarUsuario({ login: "bia", senhaHash: "x" });
  const rota = `/api/mensalidades/corretores/${bia.id}/assinatura`;
  await api(rota, "PUT", { valor: 80, dia: 5, inicio: "2026-11" });
  // Salvar sem mudar nada não entra no registro.
  await api(rota, "PUT", { valor: 80, dia: 5, inicio: "2026-11" });
  await api(rota, "PUT", { valor: 90, dia: 8, inicio: "2026-11", observacao: "Desconto" });
  let ficha = (await api(rota, "PUT", { valor: 90, dia: 8, inicio: "2026-11", observacao: "Desconto", ativa: false })).corpo;
  const nov = ficha.mensalidades[0];
  await api(`/api/mensalidades/${nov.id}`, "PATCH", { pago: true, pagoEm: "2026-11-18", forma: "Pix" });
  await api(`/api/mensalidades/${nov.id}`, "PATCH", { pago: false });
  await api(`/api/mensalidades/${nov.id}`, "PATCH", { dispensada: true });
  // Dispensar de novo o mesmo mês não repete a linha.
  ficha = (await api(`/api/mensalidades/${nov.id}`, "PATCH", { dispensada: true })).corpo;
  assert.deepEqual(ficha.alteracoes.map((a) => a.descricao), [
    "Dispensou novembro de 2026.",
    "Desfez o pagamento de novembro de 2026.",
    "Marcou novembro de 2026 como paga em 18/11/2026 (Pix).",
    "Pausou a cobrança.",
    'Mudou valor de R$ 80,00 para R$ 90,00; vencimento do dia 5 para o dia 8; observação para "Desconto".',
    "Programou a cobrança: R$ 80,00 todo dia 5, a partir de novembro de 2026.",
  ]);
  assert.ok(ficha.alteracoes.every((a) => a.autor === "Administrador" && a.em));

  // O bloqueio e a liberação automáticos também entram, assinados pelo sistema.
  await api(rota, "PUT", { valor: 90, dia: 8, inicio: "2026-11", observacao: "Desconto" });
  await api(`/api/mensalidades/${nov.id}`, "PATCH", { dispensada: false });
  await api("/api/mensalidades/config", "PUT", { diasBloqueio: 5 });
  ficha = (await api(`/api/mensalidades/${nov.id}`, "PATCH", { pago: true })).corpo;
  assert.deepEqual(ficha.alteracoes.slice(0, 3).map((a) => [a.autor, a.descricao]), [
    ["Sistema", "Login liberado: o bloqueio por atraso saiu."],
    ["Administrador", "Marcou novembro de 2026 como paga em 19/11/2026."],
    ["Sistema", "Login bloqueado: atraso de mais de 5 dias."],
  ]);
  assert.equal(descreverAlteracaoDaCobranca({ valor: 1, dia: 1, inicio: "2026-11", ativa: false, observacao: "" }, { valor: 1, dia: 1, inicio: "2026-11", ativa: true, observacao: "" }), "Reativou a cobrança.");
});
