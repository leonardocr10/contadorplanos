// Mensagem do WhatsApp no Modelo A e demais textos (funções puras).
import { brl, lines, planPrices, totalVidas } from "./calculo.js";

function assinatura(c) {
  const contato = [c.empresa, c.fone].filter(Boolean).join(" · ");
  return [c.nome && `*${c.nome}*`, contato].filter(Boolean);
}

const SEPARADOR = "━━━━━━━━━━━━━━";
const listaDeNomes = (nomes) => (nomes.length > 1 ? nomes.slice(0, -1).join(", ") + " e " + nomes.at(-1) : nomes[0]);

function blocoValores(L, v, vidas) {
  const tv = totalVidas(vidas);
  L.push("", `💰 *Valor da mensalidade* (${tv} ${tv === 1 ? "vida" : "vidas"})`);
  if (v.porFaixa) {
    for (const l of v.linhas) {
      const valores = [l.enf != null && `Enf. R$ ${brl(l.enf * l.n)}`, l.apto != null && `Apto R$ ${brl(l.apto * l.n)}`].filter(Boolean).join(" · ");
      L.push(`▫️ ${l.n > 1 ? l.n + "× " : ""}${l.faixa} anos: ${valores}`);
    }
    L.push("");
    if (v.enf != null) L.push(`✅ *Total Enfermaria: R$ ${brl(v.enf)}*`);
    if (v.apto != null) L.push(`✅ *Total Apartamento: R$ ${brl(v.apto)}*`);
    return;
  }
  if (v.enf == null && v.apto == null) L.push("• Valores sob consulta");
  if (v.enf != null) L.push(`✅ *Enfermaria: R$ ${brl(v.enf)}*`);
  if (v.apto != null) L.push(`✅ *Apartamento: R$ ${brl(v.apto)}*`);
}

export function buildMsg({ items, vidas, over, nome, corretor, opts }) {
  if (!items.length) return "";
  const nomes = items.map((p) => `*${p.nome}*`);
  const L = [
    nome ? `Olá, *${nome}*! Tudo bem? 😊` : "Olá! Tudo bem? 😊",
    `Preparamos esta proposta para que você conheça as condições do${items.length > 1 ? "s planos" : " plano"} ${listaDeNomes(nomes)}.`,
  ];
  for (const p of items) {
    L.push("", SEPARADOR, `🏥 *${p.nome}*`);
    if (p.subtitulo) L.push(`_${p.subtitulo}_`);
    blocoValores(L, planPrices(p, vidas, over), vidas);
    if (p.taxa) L.push(`➕ R$ ${brl(p.taxa)} de taxa associativa`);
    if (p.odonto) L.push("🦷 12 meses de plano odontológico incluso");
    if (p.mostrarExtras && lines(p.extras).length) L.push("", "🎁 *Benefícios do plano*", ...lines(p.extras));
    const rede = lines(p.rede);
    if (opts.rede && rede.length) L.push("", `🏨 *Rede credenciada – ${p.cidade || "Uberlândia"}*`, ...rede.map((h) => `• ${h}`));
    if (p.fidelidade) L.push("", "⚠️ *Prazo de fidelidade de 12 meses para contratação via CNPJ*");
  }
  L.push(SEPARADOR);
  const copart = opts.copart && items.map((p) => (p.copartTexto || "").trim()).find(Boolean);
  if (copart) L.push("", "❓ *Como funciona a coparticipação?*", copart);
  if (opts.acom) L.push("", "_*Enfermaria: acomodação compartilhada._", "_*Apartamento: acomodação individual._");
  L.push("", `📎 As tabelas de coparticipação e carência seguem na${items.length > 1 ? "s imagens" : " imagem"}.`);
  const sig = assinatura(corretor);
  if (sig.length) L.push("", ...sig);
  return L.join("\n");
}

// Um plano: só o endereço. Vários: o nome de cada plano acima do seu link.
export function textoDosLinks(links) {
  if (links.length === 1) return links[0].url;
  return links.map((l) => `*${l.nome}*\n${l.url}`).join("\n\n");
}

// Não usa wa.me: o redirecionamento dele troca os emojis do texto por "�".
export function linkWhatsApp(fone, texto) {
  const telefone = fone ? `phone=55${fone}&` : "";
  return `https://api.whatsapp.com/send/?${telefone}text=${encodeURIComponent(texto)}`;
}

export function mensagemDocumentos({ cliente, plano, acomodacao, documentos, corretor }) {
  const L = [
    cliente ? `Olá, *${cliente}*! Tudo bem? 😊` : "Olá! Tudo bem? 😊",
    "",
    `Recebemos o seu aceite da proposta do plano *${plano}* (${acomodacao}).`,
    "",
    "Para dar andamento, precisamos que você nos envie os seguintes documentos:",
    "",
    ...documentos.map((d) => `• ${d}`),
  ];
  const sig = assinatura(corretor);
  if (sig.length) L.push("", ...sig);
  return L.join("\n");
}

const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function waHtml(t) {
  return escHtml(t).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/(^|[\s(])_([^_\n]+)_/g, "$1<i>$2</i>");
}
