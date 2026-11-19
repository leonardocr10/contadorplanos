// Resgate de clientes: quem cotou há mais dias que o escolhido pelo corretor (padrão: 90) e não fechou recebe, uma vez só, uma mensagem no WhatsApp
// do vendedor que fez a cotação. O envio é automático, pela Evolution API (EVOLUTION_URL e EVOLUTION_API_KEY no .env).
// Para o número não ser bloqueado, as mensagens saem devagar: só em horário comercial, com o intervalo e o limite por dia que cada vendedor escolhe.

import { LIMITE_RESGATE_PADRAO } from "./db.js";
export {
  DIAS_RESGATE_PADRAO as DIAS_RESGATE, DIAS_RESGATE_MIN, DIAS_RESGATE_MAX,
  LIMITE_RESGATE_MIN, LIMITE_RESGATE_MAX, INTERVALO_RESGATE_MIN, INTERVALO_RESGATE_MAX,
} from "./db.js";
// Padrão de mensagens por dia de quem ainda não mudou.
export const LIMITE_POR_DIA = LIMITE_RESGATE_PADRAO;
// Horário de Brasília, de segunda a sexta.
export const HORARIO = { inicio: 9, fim: 18 };
const MINUTO = 60_000;
// Falhas seguidas antes de desistir de um cliente.
export const MAX_TENTATIVAS = 3;
const VOLTA = 60_000;
const DIA = 24 * 60 * 60_000;

// O texto e a troca das variáveis são os mesmos da tela, que mostra o exemplo antes de salvar.
import { MENSAGEM_RESGATE_PADRAO as MENSAGEM_PADRAO, mensagemResgate as montarMensagem } from "../public/js/mensagem.js";
export { MENSAGEM_PADRAO, montarMensagem };

// Dia da semana e hora em Brasília, qualquer que seja o fuso do servidor.
export function horaDeEnviar(data) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "numeric", hourCycle: "h23" })
    .formatToParts(data).map((p) => [p.type, p.value]));
  const hora = Number(partes.hour);
  return !["Sat", "Sun"].includes(partes.weekday) && hora >= HORARIO.inicio && hora < HORARIO.fim;
}

// Nome da conexão de cada vendedor na Evolution API.
export const instanciaDe = (usuarioId) => `cotador-${String(usuarioId || "local").replace(/[^\w-]/g, "")}`;
// A Evolution quer o número com o código do país.
export const numeroComPais = (fone) => (fone.length <= 11 ? "55" + fone : fone);

export class ErroWhatsApp extends Error {}

// Conversa com a Evolution API. Sem EVOLUTION_URL ou EVOLUTION_API_KEY, devolve null e nada é enviado.
export function criarEvolution(env, buscar = fetch) {
  const url = (env.EVOLUTION_URL || "").trim().replace(/\/+$/, "");
  const chave = (env.EVOLUTION_API_KEY || "").trim();
  if (!url || !chave) return null;
  const pedir = async (metodo, rota, corpo) => {
    let r;
    try {
      r = await buscar(url + rota, {
        method: metodo,
        headers: { apikey: chave, ...(corpo ? { "Content-Type": "application/json" } : {}) },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ErroWhatsApp("Não consegui falar com o serviço de WhatsApp (Evolution API). Confira se ele está ligado.");
    }
    return { ok: r.ok, status: r.status, dados: await r.json().catch(() => null) };
  };
  const falha = (r) => new ErroWhatsApp(`O serviço de WhatsApp recusou o pedido (erro ${r.status}).`);
  return {
    // "open" = conectado; "close" ou "connecting" = desconectado; "inexistente" = o vendedor nunca conectou.
    async estado(instancia) {
      const r = await pedir("GET", `/instance/connectionState/${instancia}`);
      if (r.status === 404) return { estado: "inexistente", numero: "" };
      if (!r.ok) throw falha(r);
      const estado = r.dados?.instance?.state ?? r.dados?.state ?? "close";
      let numero = "";
      if (estado === "open") {
        const i = await pedir("GET", `/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`);
        const dados = Array.isArray(i.dados) ? i.dados[0] : i.dados;
        numero = String(dados?.ownerJid ?? dados?.instance?.owner ?? "").split("@")[0].replace(/\D/g, "");
      }
      return { estado, numero };
    },
    // Devolve o QR Code (imagem em base64) para o vendedor ler no celular. Cria a conexão na primeira vez.
    async conectar(instancia) {
      let r = await pedir("GET", `/instance/connect/${instancia}`);
      if (r.status === 404) {
        r = await pedir("POST", "/instance/create", { instanceName: instancia, integration: "WHATSAPP-BAILEYS", qrcode: true });
        if (!r.ok) throw falha(r);
        return { qr: r.dados?.qrcode?.base64 ?? "", codigo: r.dados?.qrcode?.pairingCode ?? "" };
      }
      if (!r.ok) throw falha(r);
      return { qr: r.dados?.base64 ?? "", codigo: r.dados?.pairingCode ?? "" };
    },
    async desconectar(instancia) {
      const r = await pedir("DELETE", `/instance/logout/${instancia}`);
      if (!r.ok && r.status !== 404 && r.status !== 400) throw falha(r);
    },
    async enviarTexto(instancia, numero, texto) {
      const r = await pedir("POST", `/message/sendText/${instancia}`, { number: numero, text: texto });
      if (r.ok) return { ok: true };
      // Número sem WhatsApp: a Evolution responde 400 com "exists": false.
      const semWhatsApp = /"exists"\s*:\s*false/.test(JSON.stringify(r.dados ?? ""));
      return { ok: false, semWhatsApp, erro: semWhatsApp ? "Este número não tem WhatsApp." : `O serviço de WhatsApp não enviou (erro ${r.status}).` };
    },
  };
}

// Junta a lista do resgate e envia as mensagens. iniciar() liga a rodada de cada minuto (só no index.js).
export function criarResgate({ banco, env = process.env, evolution = criarEvolution(env), relogio = () => new Date(), sorteio = Math.random }) {
  // Último envio de cada vendedor e o sorteio da espera seguinte (0 = intervalo mínimo, 1 = máximo).
  // A espera é calculada com a configuração de agora: mudar o intervalo vale já para a próxima mensagem.
  const ultimo = new Map();
  const podeEnviar = (u, cfg, agora) => {
    const anterior = ultimo.get(u.id);
    if (!anterior) return true;
    const espera = cfg.intervaloMin + anterior.sorteio * (cfg.intervaloMax - cfg.intervaloMin);
    return agora.getTime() >= anterior.em + Math.round(espera * MINUTO);
  };
  let rodando = false, timer = null;

  const coletar = () => banco.coletarResgates(relogio().toISOString());

  async function enviar(r, usuario, cfg) {
    const texto = montarMensagem(cfg.mensagem, { cliente: r.cliente, plano: r.plano, corretor: usuario.nome || usuario.login, empresa: usuario.empresa });
    let res;
    try {
      res = await evolution.enviarTexto(instanciaDe(usuario.id), numeroComPais(r.fone), texto);
    } catch (e) {
      res = { ok: false, erro: e.message };
    }
    if (res.ok) return banco.marcarResgate(r.id, { status: "enviado", enviadoEm: relogio().toISOString(), erro: "", mensagem: texto });
    const tentativas = r.tentativas + 1;
    return banco.marcarResgate(r.id, { status: res.semWhatsApp || tentativas >= MAX_TENTATIVAS ? "erro" : "pendente", tentativas, erro: res.erro || "Falha no envio." });
  }

  // Uma volta: atualiza a lista e, no horário, envia no máximo uma mensagem por vendedor.
  async function rodada() {
    if (rodando) return;
    rodando = true;
    try {
      coletar();
      const agora = relogio();
      if (!evolution || !horaDeEnviar(agora)) return;
      for (const u of banco.listarUsuarios()) {
        if (!u.ativo) continue;
        const cfg = banco.lerConfigResgate(u.id);
        if (!cfg.ativo || !podeEnviar(u, cfg, agora)) continue;
        const r = banco.proximoResgate(u.id);
        if (!r || banco.contarResgatesEnviados(u.id, new Date(agora.getTime() - DIA).toISOString()) >= cfg.limite) continue;
        let estado;
        try {
          ({ estado } = await evolution.estado(instanciaDe(u.id)));
        } catch {
          continue;
        }
        if (estado !== "open") continue;
        await enviar(r, u, cfg);
        ultimo.set(u.id, { em: agora.getTime(), sorteio: sorteio() });
      }
    } catch (e) {
      console.error("Resgate:", e.message);
    } finally {
      rodando = false;
    }
  }

  return {
    configurado: !!evolution,
    evolution,
    coletar,
    rodada,
    iniciar() {
      if (timer) return;
      timer = setInterval(rodada, VOLTA);
      timer.unref?.();
      setTimeout(rodada, 15_000).unref?.();
    },
    parar() {
      clearInterval(timer);
      timer = null;
    },
  };
}
