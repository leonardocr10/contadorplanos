// Régua de cobrança das mensalidades: lembretes automáticos aos corretores antes, no dia e depois do vencimento.
// Sai pelo WhatsApp do administrador que ligou a régua (a conexão é a mesma da tela Resgate) e pelo e-mail do
// servidor (SMTP do .env). Só em horário comercial, uma vez por mês, etapa e canal; cada envio entra no registro.
import { normFone } from "../public/js/calculo.js";
import { ETAPAS_DA_REGUA, assuntoDoLembrete, etapaDoLembrete, hojeLocal, mensagemDoLembrete, nomeDaCompetencia } from "../public/js/mensalidade.js";
import { horaDeEnviar, instanciaDe, numeroComPais } from "./resgate.js";

// Pausa entre duas mensagens de WhatsApp, para o número não parecer robô.
const PAUSA_WHATSAPP = 20_000;
const CANAIS = { whatsapp: "WhatsApp", email: "e-mail" };

export function criarRegua({ banco, evolution = null, enviarEmail = null, relogio = () => new Date(), hoje = () => hojeLocal(), pausa = PAUSA_WHATSAPP }) {
  let rodando = false, timer = null;
  const esperar = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : null);

  async function enviarPorCanal(canal, m, etapa, texto) {
    const c = m.corretor;
    if (canal === "whatsapp") {
      const r = await evolution.enviarTexto(instanciaDe(banco.lerRegua().whatsappDe), numeroComPais(normFone(c.fone)), texto);
      if (r.ok) return { ok: true };
      // Número sem WhatsApp não adianta tentar de novo.
      return { ok: false, definitivo: !!r.semWhatsApp, erro: r.erro };
    }
    await enviarEmail({ para: c.email, assunto: assuntoDoLembrete(etapa, m), texto });
    return { ok: true };
  }

  // Uma volta: envia os lembretes que vencem hoje. Devolve quantos saíram, para os testes e o log.
  async function rodada() {
    if (rodando) return { enviados: 0 };
    rodando = true;
    let enviados = 0, ultimoWhatsApp = 0;
    try {
      const regua = banco.lerRegua();
      if ((!regua.whatsapp && !regua.email) || !horaDeEnviar(relogio())) return { enviados };
      let whatsappPronto = false;
      if (regua.whatsapp && evolution) {
        try {
          whatsappPronto = (await evolution.estado(instanciaDe(regua.whatsappDe))).estado === "open";
        } catch {
          whatsappPronto = false;
        }
      }
      const emailPronto = regua.email && !!enviarEmail;
      const dia = hoje();
      const { diasBloqueio } = banco.lerConfigMensalidade();
      for (const m of banco.mensalidadesParaLembrar()) {
        const c = m.corretor;
        // Quem o administrador desativou à mão não recebe; quem foi bloqueado pelo atraso, sim.
        if (!c.ativo && !c.bloqueado) continue;
        const etapa = etapaDoLembrete(m, regua, dia);
        if (!etapa) continue;
        const texto = mensagemDoLembrete(etapa, m, { nome: c.nome || c.login, comoPagar: regua.comoPagar, diasBloqueio, bloqueado: c.bloqueado });
        const canais = [whatsappPronto && normFone(c.fone) && "whatsapp", emailPronto && c.email && "email"].filter(Boolean);
        for (const canal of canais) {
          if (banco.lembreteEnviado(m.id, etapa, canal)) continue;
          if (canal === "whatsapp" && ultimoWhatsApp) await esperar(pausa);
          let r;
          try {
            r = await enviarPorCanal(canal, m, etapa, texto);
          } catch (e) {
            r = { ok: false, erro: e.message };
          }
          if (canal === "whatsapp") ultimoWhatsApp = Date.now();
          const oQue = `${ETAPAS_DA_REGUA[etapa]} de ${nomeDaCompetencia(m.competencia)}`;
          if (r.ok) {
            banco.marcarLembrete(m.id, etapa, canal);
            banco.registrarAlteracao(c.id, "Sistema", `Enviou por ${CANAIS[canal]} o ${oQue}.`);
            enviados++;
          } else if (r.definitivo) {
            banco.marcarLembrete(m.id, etapa, canal);
            banco.registrarAlteracao(c.id, "Sistema", `Não enviou por ${CANAIS[canal]} o ${oQue}: ${r.erro}`);
          } else {
            // Falha passageira (serviço fora do ar): tenta de novo na próxima volta.
            console.error(`Régua de cobrança: ${CANAIS[canal]} para ${c.login} falhou.`, r.erro);
          }
        }
      }
    } catch (e) {
      console.error("Régua de cobrança:", e.message);
    } finally {
      rodando = false;
    }
    return { enviados };
  }

  return {
    rodada,
    iniciar(intervalo = 15 * 60_000) {
      if (timer) return;
      timer = setInterval(rodada, intervalo);
      timer.unref?.();
      setTimeout(rodada, 30_000).unref?.();
    },
  };
}
