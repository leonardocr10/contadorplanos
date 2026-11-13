// Página pública em que o cliente que aceitou a proposta envia os documentos do plano.
// Ele entra com o telefone e pode parar e continuar depois: cada arquivo é guardado assim que é enviado.
import { FONTE, esc, moeda } from "./proposta-html.js";

export const OUTROS = "Outros documentos";

const CSS = `
${FONTE}
:root{--ink:#10241d;--muted:#55665e;--line:#dfe5e1;--bg:#f3f5f3;--verde:#0b7a3d;--verde-escuro:#0b5a45;--verde-claro:#e2f4e9;--erro:#8f1f1a;--erro-bg:#fdecea;--falta:#6b4d00;--falta-bg:#fff6d6}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font-family:Manrope,system-ui,sans-serif;font-size:15px;line-height:1.45}
main{width:100%;max-width:640px;margin:0 auto;padding:20px 16px 48px;display:flex;flex-direction:column;gap:14px}
h1{margin:0;font-size:24px;font-weight:800;letter-spacing:-.01em;color:var(--verde-escuro)}
h2{margin:0;font-size:16px;font-weight:800}
p{margin:0}
.sub{color:var(--muted);font-size:14px}
.cartao{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px}
.pilha{display:flex;flex-direction:column;gap:10px}
.botao{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;padding:0 16px;border:0;border-radius:12px;background:var(--verde);color:#fff;font:800 15px Manrope,system-ui,sans-serif;text-decoration:none;text-align:center;cursor:pointer}
.botao.claro{background:#fff;color:var(--verde-escuro);border:1.5px solid var(--verde)}
.botao.fino{min-height:40px;font-size:14px}
.botao:disabled{opacity:.55;cursor:default}
.botao:focus-visible,input:focus-visible,.tirar:focus-visible,.link:focus-visible{outline:3px solid #0f9d4f;outline-offset:2px}
.link{background:none;border:0;padding:0;color:var(--verde-escuro);font:700 14px Manrope,system-ui,sans-serif;text-decoration:underline;cursor:pointer}
label{display:block;font-size:13px;font-weight:700}
input[type=tel]{display:block;width:100%;min-height:52px;margin-top:6px;padding:0 14px;border:1.5px solid #cfd8d3;border-radius:12px;background:var(--bg);font:700 20px Manrope,system-ui,sans-serif;letter-spacing:.02em}
.aviso{padding:10px 12px;border-radius:10px;background:var(--erro-bg);color:var(--erro);font-size:14px;font-weight:600}
.aviso.ok{background:var(--verde-claro);color:var(--verde-escuro)}
.passos{margin:0;padding-left:20px;color:var(--muted);font-size:14px}
.passos li{margin:2px 0}
.progresso{display:flex;flex-direction:column;gap:8px;position:sticky;top:0;z-index:5;background:#fff;border:1px solid var(--line);border-radius:16px;padding:12px 16px;box-shadow:0 4px 14px rgba(16,36,29,.06)}
.progresso-topo{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-weight:800}
.progresso-topo small{font-weight:600;color:var(--muted);font-size:13px}
.barra{height:10px;border-radius:99px;background:var(--bg);overflow:hidden}
.barra i{display:block;height:100%;width:0;border-radius:99px;background:var(--verde);transition:width .3s}
.doc{display:flex;flex-direction:column;gap:10px}
.doc.feito{border-color:var(--verde)}
.doc-topo{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.doc-nome{font-weight:800;font-size:15px;overflow-wrap:anywhere}
.selo{flex:none;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:800;white-space:nowrap;background:var(--falta-bg);color:var(--falta)}
.selo.ok{background:var(--verde-claro);color:var(--verde-escuro)}
.selo.neutro{background:var(--bg);color:var(--muted)}
.arquivos{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.arquivos li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:var(--bg);font-size:14px}
.arquivos .nome{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.arquivos .tam{flex:none;color:var(--muted);font-size:12.5px}
.tirar{flex:none;min-width:36px;min-height:36px;border:0;border-radius:8px;background:none;color:var(--erro);font:700 13px Manrope,system-ui,sans-serif;cursor:pointer}
.enviando{display:flex;flex-direction:column;gap:6px;font-size:13.5px;color:var(--muted)}
.rodape{display:flex;flex-direction:column;gap:10px}
.centro{text-align:center}
.linha-links{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 20px;margin-top:6px}
`;

const casca = (titulo, corpo, script = false) => `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(titulo)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${corpo}
</main>
${script ? `<script type="module" src="/documentos-pagina.js"></script>` : ""}
</body>
</html>`;

const cabecalho = (proposta) => `<header class="pilha" style="gap:4px">
  <h1>Envio de documentos</h1>
  <p class="sub">Plano <b>${esc(proposta.dados.plano.nome)}</b> · ${esc(proposta.acomodacao)}, ${moeda(proposta.valor)} por mês</p>
</header>`;

// Entrada: o telefone do cliente é o login. Sem número na proposta, o primeiro informado passa a valer.
export function paginaEntrada(proposta, { erro = "", fone = "", bloqueado = false } = {}) {
  const temNumero = !!(proposta.fone || proposta.docsFone);
  return casca("Envio de documentos", `${cabecalho(proposta)}
<section class="cartao pilha">
  <h2>${proposta.dados.cliente ? `Olá, ${esc(String(proposta.dados.cliente).trim().split(/\s+/)[0])}!` : "Olá!"} Para começar, informe o seu telefone</h2>
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
<p class="centro"><a class="link" href="/p/${esc(proposta.token)}">Voltar para a proposta</a></p>`);
}

// Lista de documentos: o conteúdo é montado no navegador, a partir do estado que o servidor devolve.
export function paginaEnvio(proposta, { whatsapp = "" } = {}) {
  return casca("Envio de documentos", `${cabecalho(proposta)}
<div id="app" data-base="/p/${esc(proposta.token)}/documentos" data-whatsapp="${esc(whatsapp)}" data-proposta="/p/${esc(proposta.token)}">
  <p class="sub" id="carregando">Carregando os seus documentos…</p>
  <noscript><div class="aviso">Para enviar os documentos, ative o JavaScript do navegador ou fale com o seu corretor.</div></noscript>
</div>`, true);
}
