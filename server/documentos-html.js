// Página pública em que o cliente que aceitou a proposta envia os documentos do plano.
// Ele entra com o telefone e pode parar e continuar depois: cada arquivo é guardado assim que é enviado.
import { FONTE, esc, moeda } from "./proposta-html.js";

export const OUTROS = "Outros documentos";

// Etapas reais do fluxo do cliente: recebe a proposta, aceita, envia os documentos e conclui.
// A página de documentos é a etapa 3; depois de concluir, a 4.
export const ETAPAS = ["Proposta", "Aceite", "Envio de documentos", "Conclusão"];
export const etapaDosDocumentos = (concluido) => (concluido ? 4 : 3);

// Paleta HubSaúde: #0B2D6B (marinho), #0D6EFD (azul), #00B5A6 (turquesa), #7CCB00 (verde), #F2F6FA (fundo).
// Sucesso, atenção e erro são tons complementares, escurecidos para manter o contraste do texto.
const CSS = `
${FONTE}
:root{
  --marinho:#0B2D6B;--azul:#0D6EFD;--turquesa:#00B5A6;--verde:#7CCB00;--fundo:#F2F6FA;
  --superficie:#fff;--texto:#0E1F3D;--texto-2:#56657E;--borda:#DFE6EF;--borda-forte:#C9D3E0;
  --acao:#0A7F72;--acao-2:#2E7D17;--acao-hover:#086C61;
  --sucesso:#17703A;--sucesso-bg:#E9F7EE;--sucesso-borda:#BFE5CC;--sucesso-tinta:#F6FBF8;
  --atencao:#7A5300;--atencao-bg:#FFF2CC;--atencao-borda:#F1DB9B;--atencao-tinta:#FFFBEF;
  --erro:#A12A22;--erro-bg:#FDECEA;--erro-borda:#F3C3BE;
  --info:#0B4FB8;--info-bg:#E7F0FE;
  --foco:#0D6EFD;--raio:18px;--raio-p:12px;
  --sombra:0 1px 2px rgba(11,45,107,.05),0 6px 20px rgba(11,45,107,.06);
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--fundo);color:var(--texto);font-family:Manrope,system-ui,sans-serif;font-size:15px;line-height:1.45}
svg{flex:none}
.topo{position:relative;overflow:hidden;background:#fff;border-bottom:1px solid var(--borda)}
.topo::before,.topo::after{content:"";position:absolute;width:220px;height:220px;border-radius:50%;filter:blur(6px);opacity:.16;pointer-events:none}
.topo::before{top:-150px;left:-90px;background:radial-gradient(circle,var(--azul),transparent 70%)}
.topo::after{top:-150px;right:-90px;background:radial-gradient(circle,var(--verde),var(--turquesa) 40%,transparent 70%)}
.topo-dentro{position:relative;max-width:680px;margin:0 auto;padding:12px 16px;display:grid;grid-template-columns:44px 1fr 44px;align-items:center}
.voltar{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:var(--fundo);color:var(--marinho);text-decoration:none}
.voltar:hover{background:#E6EDF6}
.marca{justify-self:center;display:flex;align-items:center;gap:8px;text-decoration:none}
.marca-nome{font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1}
.marca-nome b{font-weight:800;color:var(--marinho)}
.marca-nome span{background:linear-gradient(90deg,#0B8F86,#0B6E66);-webkit-background-clip:text;background-clip:text;color:transparent}
main{width:100%;max-width:680px;margin:0 auto;padding:20px 16px 32px;display:flex;flex-direction:column;gap:14px}
h1{margin:0;font-size:26px;font-weight:800;letter-spacing:-.02em;color:var(--texto);line-height:1.15}
h2{margin:0;font-size:16px;font-weight:800}
p{margin:0}
.sub{color:var(--texto-2);font-size:14px}
.titulo{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px}
.titulo .sub{flex-basis:100%}
.etapa{flex:none;padding:6px 12px;border-radius:99px;background:var(--info-bg);color:var(--marinho);font-size:13px;font-weight:800;white-space:nowrap}
.cartao{background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio);padding:16px;box-shadow:var(--sombra)}
.pilha{display:flex;flex-direction:column;gap:10px}
/* resumo da proposta */
.resumo{position:relative;overflow:hidden;display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 14px;align-items:center;background:linear-gradient(135deg,#fff 55%,#EAF7F4 85%,#EEF8DE)}
.resumo-icone{grid-row:span 2;display:grid;place-items:center;width:60px;height:60px;border-radius:18px;background:linear-gradient(145deg,#E8F1FF,#E3F6F3)}
.resumo-plano{min-width:0}
.rotulo{display:inline-block;padding:2px 9px;border-radius:99px;background:var(--info-bg);color:var(--marinho);font-size:11.5px;font-weight:800}
.resumo-nome{margin-top:4px;font-size:19px;font-weight:800;color:var(--marinho);line-height:1.2;overflow-wrap:anywhere}
.resumo-acom{color:var(--texto);font-size:14.5px;font-weight:600}
.resumo-sub{color:var(--texto-2);font-size:12.5px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.resumo-valor{grid-column:2;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}
.mensal small{display:block;color:var(--texto-2);font-size:12.5px;font-weight:600}
.mensal strong{font-size:22px;font-weight:800;color:var(--acao);letter-spacing:-.01em}
.mensal strong em{font-style:normal;font-size:14px;font-weight:700}
.chip-corretor{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:99px;background:var(--sucesso-bg);color:var(--sucesso);font-size:12.5px;font-weight:700;max-width:100%}
.chip-corretor span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (min-width:520px){
  .resumo{grid-template-columns:auto minmax(0,1fr) auto;padding:18px 20px}
  .resumo-icone{grid-row:auto}
  .resumo-valor{grid-column:auto;flex-direction:column;align-items:flex-start;gap:6px;padding-left:18px;border-left:1px solid var(--borda)}
}
/* progresso */
.progresso{display:flex;align-items:center;gap:16px}
.anel{position:relative;width:84px;height:84px;flex:none}
.anel svg{width:100%;height:100%;transform:rotate(-90deg)}
.anel circle{fill:none;stroke-width:9}
.anel .trilho{stroke:#E6ECF3}
.anel .feito{stroke:url(#grad-progresso);stroke-linecap:round;transition:stroke-dashoffset .5s ease}
.anel b{position:absolute;inset:0;display:grid;place-items:center;font-size:19px;font-weight:800;color:var(--marinho)}
.progresso-texto{flex:1;min-width:0;padding-left:16px;border-left:1px solid var(--borda)}
.progresso-texto strong{display:block;font-size:17px;font-weight:800;color:var(--texto)}
.progresso-texto span{color:var(--texto-2);font-size:14.5px}
.progresso-texto .pendente{color:var(--atencao);font-weight:700}
.progresso-texto .completo{color:var(--sucesso);font-weight:700}
.ilustracao{display:none}
@media (min-width:480px){.ilustracao{display:block}}
.info{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:14px;background:var(--info-bg);color:#183A73;font-size:14px}
.info svg{margin-top:1px;color:var(--azul)}
/* documentos */
.docs{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.doc{border:1px solid var(--borda);border-radius:16px;background:#fff;box-shadow:0 1px 2px rgba(11,45,107,.04);transition:border-color .2s,background .2s}
.doc.enviado{border-color:var(--sucesso-borda);background:var(--sucesso-tinta)}
.doc.falta{border-color:var(--atencao-borda);background:var(--atencao-tinta)}
.doc.com-erro{border-color:var(--erro-borda)}
.doc-cabeca{display:grid;grid-template-columns:auto 1fr auto auto;grid-template-areas:"ic tx se ar";align-items:center;gap:4px 12px;width:100%;min-height:68px;padding:12px;border:0;background:none;border-radius:16px;color:inherit;font:inherit;text-align:left;cursor:pointer}
.doc-icone{grid-area:ic;display:grid;place-items:center;width:46px;height:46px;border-radius:14px;flex:none;background:#EEF3F9;color:var(--marinho)}
.doc.enviado .doc-icone{background:#DDF2E5;color:var(--sucesso)}
.doc.falta .doc-icone{background:#FCEBC0;color:var(--atencao)}
.doc-textos{grid-area:tx;min-width:0;display:flex;flex-direction:column;gap:1px}
.doc-nome{font-weight:800;font-size:15px;line-height:1.25;overflow-wrap:anywhere}
.doc-desc{color:var(--texto-2);font-size:13px}
.seta{grid-area:ar;display:grid;color:var(--texto-2);transition:transform .2s}
.doc-cabeca[aria-expanded=true] .seta{transform:rotate(180deg)}
.doc-cabeca .selo{grid-area:se}
.selo{display:inline-flex;align-items:center;gap:5px;flex:none;padding:5px 10px;border-radius:99px;font-size:12.5px;font-weight:800;white-space:nowrap;background:var(--atencao-bg);color:var(--atencao)}
.selo.ok{background:var(--sucesso-bg);color:var(--sucesso)}
.selo.neutro{background:#EEF2F7;color:#4A5A75}
.selo.erro{background:var(--erro-bg);color:var(--erro)}
.selo.subindo{background:var(--info-bg);color:var(--info)}
.doc-corpo{display:flex;flex-direction:column;gap:10px;padding:0 12px 14px 70px}
@media (max-width:480px){
  .doc-cabeca{grid-template-columns:auto 1fr auto;grid-template-areas:"ic tx ar" "ic se ar";gap:6px 12px;padding:12px}
  .doc-cabeca .selo{justify-self:start}
}
@media (max-width:420px){
  .doc-icone{width:40px;height:40px;border-radius:12px}
  .doc-corpo{padding:0 12px 14px}
  .selo{padding:4px 8px;font-size:12px}
}
.arquivos{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.arquivos li{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 10px;border:1px solid var(--borda);border-radius:12px;background:#fff;font-size:14px}
.arquivos li svg{color:var(--texto-2)}
.arquivos .nome{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
.arquivos .tam{flex:none;color:var(--texto-2);font-size:12.5px}
.tirar{flex:none;min-height:36px;padding:0 10px;border:0;border-radius:10px;background:none;color:var(--erro);font:700 13px Manrope,system-ui,sans-serif;cursor:pointer}
.tirar:hover{background:var(--erro-bg)}
.dica{color:var(--texto-2);font-size:13px}
.enviando{display:flex;flex-direction:column;gap:6px;font-size:13.5px;color:var(--info);font-weight:700}
.barra{height:8px;border-radius:99px;background:#E1E8F1;overflow:hidden}
.barra i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--turquesa),var(--verde));transition:width .3s}
/* botões */
.botao{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:52px;padding:0 18px;border:0;border-radius:14px;background:linear-gradient(135deg,var(--acao),var(--acao-2));color:#fff;font:800 16px Manrope,system-ui,sans-serif;text-decoration:none;text-align:center;cursor:pointer;box-shadow:0 6px 16px rgba(10,127,114,.22);transition:filter .15s,transform .1s}
.botao:hover{filter:brightness(.95)}
.botao:active{transform:translateY(1px)}
.botao.claro{background:#fff;color:var(--acao);border:1.5px solid var(--acao);box-shadow:none}
.botao.claro:hover{background:#F1FAF8;filter:none}
.botao.fino{min-height:44px;font-size:14.5px}
.botao:disabled{opacity:.5;cursor:default;filter:none;transform:none}
.botao:focus-visible,input:focus-visible,.tirar:focus-visible,.link:focus-visible,.doc-cabeca:focus-visible,.voltar:focus-visible{outline:3px solid var(--foco);outline-offset:2px}
.link{background:none;border:0;padding:4px 2px;color:var(--acao);font:700 14px Manrope,system-ui,sans-serif;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.fixo{position:sticky;bottom:0;z-index:5;margin:4px -16px 0;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:rgba(255,255,255,.95);border-top:1px solid var(--borda);box-shadow:0 -8px 24px rgba(11,45,107,.07);border-radius:22px 22px 0 0}
@supports (backdrop-filter:blur(8px)){.fixo{background:rgba(255,255,255,.85);backdrop-filter:blur(8px)}}
@media (min-width:700px){.fixo{margin:4px 0 0;border:1px solid var(--borda);border-radius:var(--raio);bottom:12px}}
.acoes{display:flex;flex-direction:column;gap:10px}
.acoes .sub{text-align:center;font-size:13px}
.linha-links{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px 18px;margin-top:4px}
.linha-links form{margin:0}
.linha-links .sep{width:1px;height:18px;background:var(--borda-forte)}
/* formulários e avisos */
label{display:block;font-size:13px;font-weight:700}
input[type=tel]{display:block;width:100%;min-height:54px;margin-top:6px;padding:0 14px;border:1.5px solid var(--borda-forte);border-radius:14px;background:var(--fundo);color:var(--texto);font:700 20px Manrope,system-ui,sans-serif;letter-spacing:.02em}
.aviso{padding:10px 12px;border-radius:12px;background:var(--erro-bg);color:var(--erro);font-size:14px;font-weight:600}
.aviso.ok{background:var(--sucesso-bg);color:var(--sucesso)}
.aviso.falta{background:var(--atencao-bg);color:var(--atencao);font-weight:500}
.passos{margin:0;padding-left:20px;color:var(--texto-2);font-size:14px}
.passos li{margin:3px 0}
.centro{text-align:center}
.concluido{align-items:center;text-align:center;padding:24px 18px}
.concluido .selo-grande{display:grid;place-items:center;width:64px;height:64px;border-radius:50%;background:var(--sucesso-bg);color:var(--sucesso)}
.concluido h2{font-size:20px;color:var(--marinho)}
.concluido .botao{max-width:420px}
.modal{width:min(440px,calc(100% - 32px));max-height:calc(100% - 32px);overflow:auto;border:0;border-radius:20px;padding:22px;color:var(--texto);box-shadow:0 20px 60px rgba(11,45,107,.25)}
.modal::backdrop{background:rgba(11,45,107,.45)}
.modal h2{font-size:20px;color:var(--marinho)}
.modal input{display:block;width:100%;min-height:48px;margin-top:6px;padding:0 14px;border:1.5px solid var(--borda-forte);border-radius:12px;background:var(--fundo);color:var(--texto);font:600 16px Manrope,system-ui,sans-serif;letter-spacing:0}
.modal input[readonly]{color:var(--texto-2);background:#E9EEF4}
.modal small{display:block;margin-top:4px;font-weight:500}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

// Símbolo HubSaúde: três pessoas em volta do coração com a cruz, nas cores da marca.
const SIMBOLO = `<svg width="40" height="40" viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="hs-azul" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0D6EFD"/><stop offset="1" stop-color="#0B2D6B"/></linearGradient>
    <linearGradient id="hs-coracao" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14C8F0"/><stop offset=".55" stop-color="#0D6EFD"/><stop offset="1" stop-color="#0B2D6B"/></linearGradient>
  </defs>
  <path d="M12.1 23.7A22 22 0 0 1 51.1 22" fill="none" stroke="url(#hs-azul)" stroke-width="7" stroke-linecap="round"/>
  <path d="M53.7 29.2A22 22 0 0 1 28.2 54.7" fill="none" stroke="#00B5A6" stroke-width="7" stroke-linecap="round"/>
  <path d="M24.5 53.7A22 22 0 0 1 10.8 27.3" fill="none" stroke="#7CCB00" stroke-width="7" stroke-linecap="round"/>
  <circle cx="22.4" cy="6.4" r="5.4" fill="#0D6EFD"/>
  <circle cx="58.6" cy="40" r="4.8" fill="#00B5A6"/>
  <circle cx="10.6" cy="50.6" r="4.8" fill="#7CCB00"/>
  <path d="M32 45C22 38 19 33 19 28.3 19 24.2 22 21.6 25.5 21.6c3 0 5 1.6 6.5 4 1.5-2.4 3.5-4 6.5-4 3.5 0 6.5 2.6 6.5 6.7C45 33 42 38 32 45Z" fill="url(#hs-coracao)"/>
  <path d="M30.2 25.6h3.6v3.6h3.6v3.6h-3.6v3.6h-3.6v-3.6h-3.6v-3.6h3.6Z" fill="#fff"/>
</svg>`;

const ICONE_PLANO = `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0B2D6B" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 17.5s-3.5-2-3.5-4.4A1.9 1.9 0 0 1 12 12a1.9 1.9 0 0 1 3.5 1.1c0 2.4-3.5 4.4-3.5 4.4z" fill="#00B5A6" stroke="#00B5A6"/></svg>`;
const ICONE_PESSOA = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`;
const ICONE_VOLTAR = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>`;

const casca = (titulo, corpo, { script = false, voltar = "" } = {}) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#ffffff">
<title>${esc(titulo)} · HubSaúde</title>
<style>${CSS}</style>
</head>
<body>
<header class="topo">
  <div class="topo-dentro">
    ${voltar ? `<a class="voltar" href="${esc(voltar)}" aria-label="Voltar para a proposta">${ICONE_VOLTAR}</a>` : "<span></span>"}
    <span class="marca" aria-label="HubSaúde">${SIMBOLO}<span class="marca-nome" aria-hidden="true"><b>Hub</b><span>Saúde</span></span></span>
    <span></span>
  </div>
</header>
<main>
${corpo}
</main>
${script ? `<script type="module" src="/documentos-pagina.js"></script>` : ""}
</body>
</html>`;

const primeiroNome = (s) => String(s ?? "").trim().split(/\s+/)[0] || "";

const titulo = (proposta) => `<header class="titulo">
  <h1>Envio de documentos</h1>
  <span class="etapa" data-etapa data-total="${ETAPAS.length}" title="${esc(ETAPAS[etapaDosDocumentos(proposta.docsConcluidoEm) - 1])}">Etapa ${etapaDosDocumentos(proposta.docsConcluidoEm)} de ${ETAPAS.length}</span>
  <p class="sub">Envie os documentos para dar continuidade à sua adesão.</p>
</header>`;

// Resumo da proposta aceita: plano, acomodação e mensalidade escolhidos pelo cliente, e quem é o corretor.
const resumo = (proposta) => {
  const { plano, corretor } = proposta.dados;
  const nomeCorretor = [primeiroNome(corretor?.nome), corretor?.empresa].filter(Boolean).join(" · ");
  return `<section class="cartao resumo" aria-label="Resumo da sua proposta">
  <div class="resumo-icone">${ICONE_PLANO}</div>
  <div class="resumo-plano">
    <span class="rotulo">Sua proposta</span>
    <div class="resumo-nome">${esc(plano.nome)}</div>
    ${proposta.acomodacao ? `<div class="resumo-acom">${esc(proposta.acomodacao)}</div>` : ""}
    ${plano.subtitulo ? `<div class="resumo-sub">${esc(plano.subtitulo)}</div>` : ""}
  </div>
  <div class="resumo-valor">
    <div class="mensal"><small>Mensalidade</small><strong>${moeda(proposta.valor)}<em>/mês</em></strong></div>
    ${nomeCorretor ? `<span class="chip-corretor" title="Seu corretor">${ICONE_PESSOA}<span>Corretor: ${esc(nomeCorretor)}</span></span>` : ""}
  </div>
</section>`;
};

// Entrada: o telefone do cliente é o login. Sem número na proposta, o primeiro informado passa a valer.
export function paginaEntrada(proposta, { erro = "", fone = "", bloqueado = false } = {}) {
  const temNumero = !!(proposta.fone || proposta.docsFone);
  const nome = primeiroNome(proposta.dados.cliente);
  return casca("Envio de documentos", `${titulo(proposta)}
${resumo(proposta)}
<section class="cartao pilha">
  <h2>${nome ? `Olá, ${esc(nome)}!` : "Olá!"} Para começar, informe o seu telefone</h2>
  <p class="sub">${temNumero ? "Use o mesmo número de WhatsApp em que você recebeu a proposta." : "Informe o seu número de WhatsApp com DDD. Ele será o seu acesso para continuar o envio depois."}</p>
  ${erro ? `<div class="aviso" role="alert">${esc(erro)}</div>` : ""}
  <form class="pilha" method="post" action="/p/${esc(proposta.token)}/documentos/entrar">
    <label>Telefone com DDD<input type="tel" name="fone" inputmode="tel" autocomplete="tel-national" placeholder="(34) 99999-0000" value="${esc(fone)}" maxlength="20" required autofocus${bloqueado ? " disabled" : ""}></label>
    <button class="botao" type="submit"${bloqueado ? " disabled" : ""}>Continuar</button>
  </form>
</section>
<section class="cartao pilha">
  <h2>Como funciona</h2>
  <ol class="passos">
    <li>Você vê a lista dos documentos do seu plano.</li>
    <li>Envia uma foto ou um arquivo PDF de cada um.</li>
    <li>Pode parar quando quiser e continuar depois: o que já foi enviado fica guardado.</li>
  </ol>
</section>
<p class="centro"><a class="link" href="/p/${esc(proposta.token)}">Voltar para a proposta</a></p>`, { voltar: `/p/${proposta.token}` });
}

// Lista de documentos: o conteúdo é montado no navegador, a partir do estado que o servidor devolve.
export function paginaEnvio(proposta, { whatsapp = "" } = {}) {
  return casca("Envio de documentos", `${titulo(proposta)}
${resumo(proposta)}
<div id="app" class="pilha" style="gap:14px" data-base="/p/${esc(proposta.token)}/documentos" data-whatsapp="${esc(whatsapp)}" data-proposta="/p/${esc(proposta.token)}">
  <p class="sub" id="carregando" role="status">Carregando os seus documentos…</p>
  <noscript><div class="aviso">Para enviar os documentos, ative o JavaScript do navegador ou fale com o seu corretor.</div></noscript>
</div>`, { script: true, voltar: `/p/${proposta.token}` });
}
