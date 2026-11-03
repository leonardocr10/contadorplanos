// Desenho da imagem da proposta em canvas (1080 px de largura), montada em blocos de cima para baixo.
import { FAIXAS, brl, lines, planPrices, totalVidas } from "./calculo.js";

const imgCache = {};
function loadImg(src) {
  return (imgCache[src] ||= new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  }));
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      const t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

export function hex2rgb(h) {
  h = String(h || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mixRGB = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
export const toHex = (a) => "#" + a.map((v) => v.toString(16).padStart(2, "0")).join("");
export const lumRGB = (a) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(a[0]) + 0.7152 * f(a[1]) + 0.0722 * f(a[2]);
};

export function themeFor(p) {
  const W = [255, 255, 255], K = [0, 0, 0];
  const pr = hex2rgb(p.corPrimaria) || [15, 157, 79], dk = hex2rgb(p.corEscura) || (p.corPrimaria ? mixRGB(pr, K, 0.45) : [11, 90, 69]);
  const lp = lumRGB(pr);
  return {
    ink: "#16232a", muted: "#5b6770", white: "#ffffff", danger: "#b4232a",
    band: toHex(dk), thead: toHex(lp > 0.5 ? dk : pr), accent: toHex(lp > 0.3 ? dk : pr), val: toHex(dk),
    soft: toHex(mixRGB(pr, W, 0.88)), soft2: toHex(mixRGB(pr, W, 0.95)), bg: toHex(mixRGB(pr, W, 0.965)), line: toHex(mixRGB(pr, W, 0.82)),
    eyebrow: toHex(mixRGB(pr, W, 0.5)), sub: toHex(mixRGB(dk, W, 0.8)),
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function makeCard(p, { vidas, over, nome, corretor: c, opts }) {
  await document.fonts?.ready;
  const W = 1080, M = 56, CW = W - 2 * M, v = planPrices(p, vidas, over);
  const [imC, imK] = await Promise.all([
    p.imgCopart && !(p.copartTabela || "").includes("|") ? loadImg(p.imgCopart) : null,
    p.imgCarencia && !(p.carenciaTabela || "").includes("|") ? loadImg(p.imgCarencia) : null,
  ]);
  await Promise.all(["500 20px Figtree", "600 20px Figtree", "700 20px Figtree", "700 20px 'Bricolage Grotesque'"].map((f) => document.fonts?.load(f).catch(() => null)));
  // Os emojis ficam no fim da pilha: no início, os números saem com espaçamento errado.
  const EMO = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji"';
  const F = (w, s, f = "Figtree") => `${w} ${s}px ${f}, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif, ${EMO}`;
  const C = themeFor(p);
  const mc = document.createElement("canvas").getContext("2d");
  const wl = (t, font, maxW) => { mc.font = font; return wrap(mc, t, maxW); };
  const blocks = [];
  const add = (h, draw) => blocks.push({ h, draw });
  const para = (text, o = {}) => {
    const font = o.font || F(500, 27), lh = o.lh || 38, ind = o.indent || 0, ls = wl(text, font, CW - ind);
    add(ls.length * lh + (o.gap ?? 22), (ctx, y) => {
      ctx.font = font;
      ctx.fillStyle = o.color || C.ink;
      ls.forEach((l, i) => ctx.fillText(l, M + ind, y + lh * 0.76 + i * lh));
    });
  };
  const title = (t) => add(58, (ctx, y) => { ctx.font = F(700, 32, "Bricolage Grotesque"); ctx.fillStyle = C.accent; ctx.fillText(t, M, y + 36); });
  const image = (im) => {
    const h = im.height * (CW / im.width);
    add(h + 34, (ctx, y) => { ctx.fillStyle = C.white; ctx.fillRect(M, y, CW, h); ctx.drawImage(im, M, y, CW, h); });
  };
  const space = (h) => add(h, () => {});
  const table = (txt, nota) => {
    const rows = String(txt || "").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((r) => r.some(Boolean));
    if (rows.length < 2) return false;
    const n = Math.max(...rows.map((r) => r.length)), head = rows[0], body = rows.slice(1), pad = 22;
    const first = n === 2 ? 0.64 : n === 3 ? 0.48 : n === 4 ? 0.40 : 0.31;
    const ws = [first * CW, ...Array(n - 1).fill(((1 - first) * CW) / (n - 1))];
    const wide = n >= 5, hF = F(700, wide ? 17 : 20), b0 = F(600, wide ? 21 : 23), bV = F(700, wide ? 21 : 23), hLH = wide ? 23 : 27, bLH = wide ? 29 : 31, up = n <= 3;
    const hL = [...Array(n)].map((_, i) => wl(up ? (head[i] || "").toUpperCase() : head[i] || "", hF, ws[i] - (i ? 16 : 2 * pad))), hH = Math.max(...hL.map((l) => l.length)) * hLH + 30;
    const bodyL = body.map((r) => {
      const cl = [...Array(n)].map((_, i) => wl(r[i] || "", i ? bV : b0, ws[i] - (i ? 24 : 2 * pad)));
      return { cl, h: Math.max(...cl.map((l) => l.length)) * bLH + 26 };
    });
    const tH = hH + bodyL.reduce((a, b) => a + b.h, 0);
    add(tH + (nota ? 14 : 32), (ctx, y) => {
      ctx.save();
      roundRect(ctx, M, y, CW, tH, 18);
      ctx.clip();
      ctx.fillStyle = C.white; ctx.fillRect(M, y, CW, tH);
      ctx.fillStyle = C.thead; ctx.fillRect(M, y, CW, hH);
      let x = M;
      hL.forEach((ls, i) => {
        ctx.font = hF; ctx.fillStyle = C.white; ctx.textAlign = i ? "center" : "left";
        const cx = i ? x + ws[i] / 2 : x + pad, off = (hH - ls.length * hLH) / 2;
        ls.forEach((l, k) => ctx.fillText(up ? l.toUpperCase() : l, cx, y + off + 20 + k * hLH));
        x += ws[i];
      });
      let yy = y + hH;
      bodyL.forEach((r, ri) => {
        if (ri % 2 === 1) { ctx.fillStyle = C.soft2; ctx.fillRect(M, yy, CW, r.h); }
        let x = M;
        r.cl.forEach((ls, i) => {
          ctx.font = i ? bV : b0; ctx.fillStyle = i ? C.val : C.ink; ctx.textAlign = i ? "center" : "left";
          const cx = i ? x + ws[i] / 2 : x + pad, off = (r.h - ls.length * bLH) / 2;
          ls.forEach((l, k) => ctx.fillText(l, cx, yy + off + 23 + k * bLH));
          x += ws[i];
        });
        yy += r.h;
        if (ri < bodyL.length - 1) { ctx.fillStyle = C.line; ctx.fillRect(M + pad, yy - 1, CW - 2 * pad, 2); }
      });
      ctx.restore();
      ctx.textAlign = "left"; ctx.strokeStyle = C.line; ctx.lineWidth = 2;
      roundRect(ctx, M, y, CW, tH, 18);
      ctx.stroke();
    });
    if (nota) para(nota, { font: F(500, 21), color: C.muted, lh: 30, gap: 30 });
    return true;
  };

  // cabeçalho
  const tF = F(700, 56, "Bricolage Grotesque"), tl = wl(p.nome, tF, CW), sF = F(500, 26), sl = p.subtitulo ? wl(p.subtitulo, sF, CW) : [];
  const hH = 104 + tl.length * 64 + sl.length * 34 + 26;
  add(hH + 32, (ctx) => {
    ctx.fillStyle = C.band; ctx.fillRect(0, 0, W, hH);
    ctx.fillStyle = C.eyebrow; ctx.font = F(700, 22);
    ctx.fillText(nome ? `PROPOSTA PARA ${nome.toUpperCase()}` : "PROPOSTA DE PLANO DE SAÚDE", M, 66);
    ctx.fillStyle = C.white; ctx.font = tF;
    tl.forEach((l, i) => ctx.fillText(l, M, 132 + i * 64));
    ctx.fillStyle = C.sub; ctx.font = sF;
    sl.forEach((l, i) => ctx.fillText(l, M, 132 + (tl.length - 1) * 64 + 46 + i * 34));
  });
  para(`${nome ? `Olá, ${nome}! ` : "Olá! "}Preparamos esta proposta para que você conheça as condições do plano ${p.nome}.`, { font: F(500, 28), lh: 40, gap: 26 });

  // valores: acomodação com valor faltando em alguma faixa não entra na imagem
  const hasE = v.enf != null, hasA = v.apto != null;
  const nCols = (hasE ? 1 : 0) + (hasA ? 1 : 0);
  const exL = [p.taxa ? `+ R$ ${brl(p.taxa)} de taxa associativa` : "", p.odonto ? "12 meses de odontológico incluso" : ""].filter(Boolean).join("   ·   ");
  const fxH = v.porFaixa ? 60 + v.linhas.length * 44 : 0;
  const boxH = 60 + (nCols ? 100 : 70) + fxH + (exL ? 46 : 0) + 20;
  add(boxH + 28, (ctx, y) => {
    ctx.fillStyle = C.white;
    roundRect(ctx, M, y, CW, boxH, 20);
    ctx.fill();
    const tv = totalVidas(vidas);
    ctx.fillStyle = C.muted; ctx.font = F(700, 20);
    ctx.fillText(v.porFaixa ? `VALOR MENSAL TOTAL · ${tv} ${tv === 1 ? "VIDA" : "VIDAS"}` : "VALOR DA MENSALIDADE", M + 32, y + 46);
    let yy = y + 60;
    if (!nCols) {
      ctx.fillStyle = C.ink; ctx.font = F(700, 40, "Bricolage Grotesque");
      ctx.fillText("Valores sob consulta", M + 32, yy + 50);
      yy += 70;
    } else {
      const cols = [];
      if (hasE) cols.push(["Enfermaria", v.enf]);
      if (hasA) cols.push(["Apartamento", v.apto]);
      cols.forEach(([lbl, val], i) => {
        const x = M + 32 + i * (CW / 2);
        ctx.fillStyle = C.muted; ctx.font = F(600, 24); ctx.fillText(lbl, x, yy + 32);
        ctx.fillStyle = C.ink; ctx.font = F(700, 48, "Bricolage Grotesque"); ctx.fillText("R$ " + brl(val), x, yy + 86);
      });
      yy += 100;
    }
    if (v.porFaixa) {
      const cx = [M + 32, M + CW * 0.40];
      if (hasE) cx.push(M + CW * 0.54);
      if (hasA) cx.push(M + CW * (hasE ? 0.77 : 0.54));
      const hd = ["FAIXA ETÁRIA", "VIDAS"];
      if (hasE) hd.push("ENFERMARIA");
      if (hasA) hd.push("APARTAMENTO");
      ctx.strokeStyle = C.line; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(M + 24, yy + 8); ctx.lineTo(M + CW - 24, yy + 8); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.font = F(700, 19);
      hd.forEach((t, i) => ctx.fillText(t, cx[i], yy + 42));
      v.linhas.forEach((l, k) => {
        const ry = yy + 60 + k * 44;
        if (k % 2 === 0) { ctx.fillStyle = C.soft; ctx.fillRect(M + 16, ry, CW - 32, 44); }
        ctx.fillStyle = C.ink; ctx.font = F(600, 24);
        const vals = [FAIXAS[l.i] + " anos", String(l.n)];
        if (hasE) vals.push("R$ " + brl(l.enf * l.n));
        if (hasA) vals.push("R$ " + brl(l.apto * l.n));
        vals.forEach((t, i) => ctx.fillText(t, cx[i], ry + 31));
      });
      yy += fxH;
    }
    if (exL) { ctx.fillStyle = C.accent; ctx.font = F(700, 22); ctx.fillText(exL, M + 32, yy + 34); }
  });

  // benefícios
  const bx = p.mostrarExtras ? lines(p.extras) : [];
  if (bx.length) {
    title("Benefícios do plano");
    bx.forEach((x, i) => para(x, { font: F(600, 26), lh: 38, gap: i === bx.length - 1 ? 24 : 4 }));
  }

  // coparticipação
  const cT = opts.copart && p.copartTexto;
  const tCop = (p.copartTabela || "").includes("|"), tCar = (p.carenciaTabela || "").includes("|");
  if (cT || tCop || imC) {
    title(cT ? "Como funciona a coparticipação?" : "Tabela de coparticipação");
    if (cT) para(p.copartTexto, { font: F(500, 25), lh: 36, gap: 18 });
    if (!(tCop && table(p.copartTabela, p.copartNota)) && imC) image(imC);
  }

  // carências
  if (tCar || imK) {
    title("Carências");
    if (!(tCar && table(p.carenciaTabela, p.carenciaNota)) && imK) image(imK);
  }

  // rede
  const rede = opts.rede ? lines(p.rede) : [];
  if (rede.length) {
    title(`Rede credenciada – ${p.cidade || "Uberlândia"}`);
    rede.forEach((h, i) => para("•  " + h, { font: F(600, 27), lh: 40, gap: i === rede.length - 1 ? 24 : 0 }));
  }
  if (p.fidelidade) para("⚠️ Planos CNPJ geram fidelidade de 1 ano.", { font: F(700, 25), color: C.danger, gap: 20 });
  if (opts.acom) para("*Enfermaria: acomodação compartilhada.   *Apartamento: acomodação individual.", { font: F(500, 22), color: C.muted, lh: 32, gap: 20 });
  space(6);

  // rodapé
  const fH = 116;
  add(fH, (ctx, y) => {
    ctx.fillStyle = C.band; ctx.fillRect(0, y, W, fH);
    ctx.fillStyle = C.white; ctx.font = F(700, 28);
    ctx.fillText(c.nome || "Cotação de plano de saúde", M, y + 50);
    ctx.fillStyle = C.sub; ctx.font = F(500, 23);
    ctx.fillText([c.empresa, c.fone].filter(Boolean).join("  ·  ") || "Valores sujeitos a confirmação da operadora", M, y + 88);
    ctx.textAlign = "right"; ctx.fillStyle = C.eyebrow; ctx.font = F(600, 22);
    ctx.fillText("Cotação de " + new Date().toLocaleDateString("pt-BR"), W - M, y + 50);
    ctx.textAlign = "left";
  });

  const H = Math.ceil(blocks.reduce((a, b) => a + b.h, 0));
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  let y = 0;
  for (const b of blocks) { b.draw(ctx, y); y += b.h; }
  return cv;
}
