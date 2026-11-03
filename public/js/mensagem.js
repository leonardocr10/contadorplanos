// Legenda e texto completo do WhatsApp (funções puras).
import { FAIXAS, brl, lines, planPrices, totalVidas } from "./calculo.js";

const assinatura = (c) => [c.nome && `*${c.nome}*`, c.empresa, c.fone].filter(Boolean);

// Marca o lugar do link no texto. O link de verdade só é criado na hora de enviar.
export const marcadorLink = (p) => `[link ${p.nome}]`;

export function aplicarLinks(texto, links) {
  return links.reduce((t, l) => t.replaceAll(marcadorLink(l), l.url), texto);
}

export function buildLegenda({ items, nome, corretor, links = false }) {
  if (!items.length) return "";
  const nomes = items.map((p) => `*${p.nome}*`);
  const lista = nomes.length > 1 ? nomes.slice(0, -1).join(", ") + " e " + nomes.at(-1) : nomes[0];
  const L = [
    nome ? `Olá, *${nome}*! Tudo bem? 😊` : "Olá! Tudo bem? 😊",
    "",
    `Segue a sua proposta do${items.length > 1 ? "s planos" : " plano"} ${lista}, com valores, coparticipação, carências e rede credenciada.`,
  ];
  if (links) {
    L.push("", items.length > 1 ? "Toque no link de cada plano para ver os detalhes:" : "Toque no link para ver os detalhes:");
    for (const p of items) L.push("", ...(items.length > 1 ? [`*${p.nome}*`] : []), marcadorLink(p));
  }
  const sig = assinatura(corretor);
  if (sig.length) L.push("", ...sig);
  return L.join("\n");
}

export function buildMsg({ items, vidas, over, nome, corretor, opts, links = false }) {
  if (!items.length) return "";
  if (!opts.texto) return buildLegenda({ items, nome, corretor, links });
  const L = [];
  L.push(nome ? `Olá, *${nome}*! Tudo bem? 😊` : "Olá! Tudo bem? 😊");
  L.push(items.length === 1
    ? `Preparamos esta proposta para que você conheça as condições do plano *${items[0].nome}*.`
    : `Preparamos esta proposta para que você conheça as condições de ${items.length} opções de plano.`);
  const sep = "━━━━━━━━━━━━━━";
  for (const p of items) {
    const v = planPrices(p, vidas, over);
    L.push("", sep, `🏥 *${p.nome}*`);
    if (p.subtitulo) L.push(`_${p.subtitulo}_`);
    if (links) L.push("", "🔗 *Proposta completa:*", marcadorLink(p));
    if (v.porFaixa) {
      const tv = totalVidas(vidas);
      L.push("", `💰 *Valor da mensalidade* (${tv} ${tv === 1 ? "vida" : "vidas"})`);
      for (const l of v.linhas) {
        L.push(`▫️ ${l.n > 1 ? l.n + "× " : ""}${FAIXAS[l.i]} anos: ` + [l.enf != null ? `Enf. R$ ${brl(l.enf * l.n)}` : "", l.apto != null ? `Apto R$ ${brl(l.apto * l.n)}` : ""].filter(Boolean).join(" · "));
      }
      L.push("");
      if (v.enf != null) L.push(`✅ *Total Enfermaria: R$ ${brl(v.enf)}*`);
      if (v.apto != null) L.push(`✅ *Total Apartamento: R$ ${brl(v.apto)}*`);
    } else {
      L.push("", "💰 *Valor da mensalidade*");
      if (v.enf == null && v.apto == null) L.push("• Valores sob consulta");
      if (v.enf != null) L.push(`• Enfermaria: *R$ ${brl(v.enf)}*`);
      if (v.apto != null) L.push(`• Apartamento: *R$ ${brl(v.apto)}*`);
    }
    if (p.taxa) L.push(`➕ R$ ${brl(p.taxa)} de taxa associativa`);
    if (p.odonto) L.push("🦷 12 meses de plano odontológico incluso");
    if (p.mostrarExtras && lines(p.extras).length) {
      L.push("", "🎁 *Benefícios do plano*");
      for (const x of lines(p.extras)) L.push(x);
    }
    const rede = lines(p.rede);
    if (opts.rede && rede.length) {
      L.push("", `🏨 *Rede hospitalar – ${p.cidade || "Uberlândia"}*`);
      for (const h of rede) L.push(`• ${h}`);
    }
    if (p.fidelidade) L.push("", "⚠️ *Planos CNPJ geram fidelidade de 1 ano*");
  }
  L.push(sep);
  if (opts.copart) {
    const txts = [...new Set(items.map((p) => (p.copartTexto || "").trim()).filter(Boolean))];
    if (txts.length) L.push("", "❓ *Como funciona a coparticipação?*", txts[0]);
  }
  if (opts.acom) L.push("", "_*Enfermaria: acomodação compartilhada._", "_*Apartamento: acomodação individual._");
  if (!links) L.push("", `📎 Na${items.length > 1 ? "s imagens" : " imagem"} estão as tabelas de coparticipação e carência.`);
  const sig = assinatura(corretor);
  if (sig.length) L.push("", ...sig);
  return L.join("\n");
}

// Não usa wa.me: o redirecionamento dele troca os emojis do texto por "�".
export function linkWhatsApp(fone, texto) {
  const telefone = fone ? `phone=55${fone}&` : "";
  return `https://api.whatsapp.com/send/?${telefone}text=${encodeURIComponent(texto)}`;
}

const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function waHtml(t) {
  return escHtml(t).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/(^|[\s(])_([^_\n]+)_/g, "$1<i>$2</i>");
}
