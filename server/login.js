// Login da tela do cotador. Usuário e senha ficam só no .env, que não vai para o GitHub.
import express from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const DURACAO_SESSAO = 12 * 60 * 60 * 1000;
const MAX_FALHAS = 5, ESPERA_FALHAS = 60 * 1000;
const COOKIE = "cotador_sessao";

const resumo = (t) => createHash("sha256").update(String(t)).digest();
const iguais = (a, b) => timingSafeEqual(resumo(a), resumo(b));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function pagina(aviso = "", podeEntrar = true) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Entrar no Cotador</title>
<style>
@font-face{font-family:Figtree;font-weight:300 900;font-display:swap;src:url(/fonts/figtree-latin-wght-normal.woff2) format("woff2")}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#f3f5f3;color:#10241d;font-family:Figtree,system-ui,sans-serif}
main{width:100%;max-width:380px;background:#fff;border:1px solid #dfe5e1;border-radius:18px;padding:28px}
h1{margin:0;font-size:26px;font-weight:800}
p{margin:6px 0 20px;font-size:14px;color:#55665e}
label{display:block;margin-bottom:14px;font-size:13px;font-weight:600}
input{display:block;width:100%;min-height:44px;margin-top:6px;padding:0 12px;border:1px solid #cfd8d3;border-radius:10px;background:#f3f5f3;font:inherit;font-size:15px}
input:focus-visible,button:focus-visible{outline:3px solid #0f9d4f;outline-offset:1px}
button{width:100%;min-height:44px;border:0;border-radius:10px;background:#0b7a3d;color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer}
.aviso{margin:0 0 14px;padding:10px 12px;border-radius:10px;background:#fdecea;color:#8f1f1a;font-size:13.5px}
</style>
</head>
<body>
<main>
  <h1>Cotador de Planos</h1>
  <p>Entre com o seu login e senha.</p>
  ${aviso ? `<div class="aviso" role="alert">${esc(aviso)}</div>` : ""}
  ${podeEntrar ? `<form method="post" action="/login">
    <label>Login<input name="usuario" autocomplete="username" autocapitalize="none" autofocus required></label>
    <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
    <button type="submit">Entrar</button>
  </form>` : ""}
</main>
</body>
</html>`;
}

export function criarLogin(env) {
  const usuario = () => (env.LOGIN_USUARIO || "").trim();
  const senha = () => (env.LOGIN_SENHA || "").trim();
  const sessoes = new Map();
  let falhas = 0, bloqueadoAte = 0;

  const sessaoDe = (req) => {
    const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w-]+)`));
    if (!m) return null;
    const expira = sessoes.get(m[1]);
    if (!expira) return null;
    if (expira < Date.now()) { sessoes.delete(m[1]); return null; }
    return m[1];
  };
  const naoConfigurado = () => !usuario() || !senha();
  const AVISO_CONFIG = "O login não está configurado. Preencha LOGIN_USUARIO e LOGIN_SENHA no arquivo .env e reinicie o cotador.";

  const rotas = express.Router();
  rotas.get("/login", (req, res) => {
    if (sessaoDe(req)) return res.redirect(303, "/");
    res.setHeader("Cache-Control", "no-store");
    if (naoConfigurado()) return res.type("html").send(pagina(AVISO_CONFIG, false));
    res.type("html").send(pagina());
  });

  rotas.post("/login", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (naoConfigurado()) return res.status(503).type("html").send(pagina(AVISO_CONFIG, false));
    if (Date.now() < bloqueadoAte) return res.status(429).type("html").send(pagina("Muitas tentativas. Aguarde um minuto e tente de novo."));
    const certo = iguais(req.body?.usuario ?? "", usuario()) & iguais(req.body?.senha ?? "", senha());
    if (!certo) {
      if (++falhas >= MAX_FALHAS) { bloqueadoAte = Date.now() + ESPERA_FALHAS; falhas = 0; }
      return res.status(401).type("html").send(pagina("Login ou senha incorretos."));
    }
    falhas = 0;
    const token = randomBytes(32).toString("base64url");
    sessoes.set(token, Date.now() + DURACAO_SESSAO);
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DURACAO_SESSAO / 1000}`);
    res.redirect(303, "/");
  });

  rotas.post("/sair", (req, res) => {
    const token = sessaoDe(req);
    if (token) sessoes.delete(token);
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.redirect(303, "/login");
  });

  // Tudo o que vem depois daqui exige login; só as fontes da tela de login ficam livres.
  rotas.use((req, res, next) => {
    if (sessaoDe(req) || req.path.startsWith("/fonts/")) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ erro: "Entre com o seu login para continuar.", codigo: "sem_login" });
    if (req.method === "GET" && (req.path === "/" || req.path.endsWith(".html"))) return res.redirect(303, "/login");
    res.status(401).type("text").send("Entre com o seu login para continuar.");
  });
  return rotas;
}
