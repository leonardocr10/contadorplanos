// Login da tela do cotador. Os usuários ficam no banco. O .env só cria o primeiro administrador
// e redefine a senha dele quando ela for esquecida.
import express from "express";
import { createHash, randomBytes } from "node:crypto";
import { conferirSenha, gerarHash } from "./senhas.js";

const DURACAO_SESSAO = 12 * 60 * 60 * 1000;
const MAX_FALHAS = 5, ESPERA_FALHAS = 60 * 1000;
const DURACAO_RECUPERACAO = 60 * 60 * 1000, INTERVALO_RECUPERACAO = 60 * 1000;
const COOKIE = "cotador_sessao";

const esc =(s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const resumoDoToken = (token) => createHash("sha256").update(String(token)).digest("hex");

function pagina(aviso = "", podeEntrar = true, sucesso = "") {
  return casca("Entrar no Cotador", `<p>Entre com o seu login e senha.</p>
  ${sucesso ? `<div class="aviso ok" role="status">${esc(sucesso)}</div>` : ""}
  ${aviso ? `<div class="aviso" role="alert">${esc(aviso)}</div>` : ""}
  ${podeEntrar ? `<form method="post" action="/login">
    <label>Login<input name="usuario" autocomplete="username" autocapitalize="none" autofocus required></label>
    <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
    <button type="submit">Entrar</button>
  </form>
  <a class="link" href="/login/recuperar">Esqueci minha senha</a>` : ""}`);
}

function paginaRecuperar(aviso = "", sucesso = "", disponivel = true) {
  return casca("Recuperar senha", `<p>Informe o e-mail cadastrado para receber o link de uma nova senha.</p>
  ${sucesso ? `<div class="aviso ok" role="status">${esc(sucesso)}</div>` : ""}
  ${aviso ? `<div class="aviso" role="alert">${esc(aviso)}</div>` : ""}
  ${disponivel && !sucesso ? `<form method="post" action="/login/recuperar">
    <label>E-mail<input name="email" type="email" autocomplete="email" autocapitalize="none" autofocus required></label>
    <button type="submit">Enviar link</button>
  </form>` : ""}
  <a class="link" href="/login">Voltar para o login</a>`);
}

function paginaRedefinir(token, aviso = "") {
  return casca("Nova senha", `<p>Escolha a nova senha, com pelo menos 8 caracteres.</p>
  ${aviso ? `<div class="aviso" role="alert">${esc(aviso)}</div>` : ""}
  <form method="post" action="/login/redefinir">
    <input type="hidden" name="token" value="${esc(token)}">
    <label>Nova senha<input name="senha" type="password" autocomplete="new-password" minlength="8" autofocus required></label>
    <label>Repita a nova senha<input name="repete" type="password" autocomplete="new-password" minlength="8" required></label>
    <button type="submit">Salvar nova senha</button>
  </form>
  <a class="link" href="/login">Voltar para o login</a>`);
}

function casca(titulo, corpo) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(titulo)}</title>
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
.aviso.ok{background:#e2f4e9;color:#0b5a45}
.link{display:block;margin-top:14px;text-align:center;font-size:13.5px;font-weight:600;color:#0b5a45}
</style>
</head>
<body>
<main>
  <h1>Cotador de Planos</h1>
  ${corpo}
</main>
</body>
</html>`;
}

export function criarLogin(env, banco, { enviarEmail = null, urlBase = () => null } = {}) {
  const usuarioEnv = () => (env.LOGIN_USUARIO || "").trim();
  const senhaEnv = () => (env.LOGIN_SENHA || "").trim();
  const sessoes = new Map(), falhas = new Map();
  // Sessões encerradas porque o mesmo login entrou em outro lugar: a tela de login explica o motivo a quem caiu.
  const derrubadas = new Map();
  const AVISO_DERRUBADA = "Este login entrou em outro dispositivo, por isso este acesso foi encerrado. Cada login é de uso individual.";
  // Login que não existe também passa pelo scrypt, para o tempo de resposta não revelar quem existe.
  const HASH_FALSO = gerarHash(randomBytes(16));

  // O primeiro administrador vem do .env e herda os dados que já estavam em "Meus dados".
  const garantirAdmin = () => {
    if (banco.contarUsuarios() > 0) return true;
    if (!usuarioEnv() || !senhaEnv()) return false;
    banco.criarUsuario({ login: usuarioEnv(), senhaHash: gerarHash(senhaEnv()), perfil: "admin", ...banco.lerConfig() });
    return true;
  };

  // Para quem esqueceu a senha: LOGIN_REDEFINIR_SENHA=1 grava a senha do .env ao iniciar o cotador.
  if (env.LOGIN_REDEFINIR_SENHA === "1" && usuarioEnv() && senhaEnv() && garantirAdmin()) {
    const u = banco.obterUsuarioPorLogin(usuarioEnv());
    if (u) {
      banco.alterarSenhaDoUsuario(u.id, gerarHash(senhaEnv()));
      banco.alterarAcessoDoUsuario(u.id, { perfil: "admin", ativo: true });
    } else {
      banco.criarUsuario({ login: usuarioEnv(), senhaHash: gerarHash(senhaEnv()), perfil: "admin" });
    }
  }

  const tokenDe = (req) => String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w-]+)`))?.[1] ?? null;

  // A sessão cai se o usuário for excluído ou desativado, ou se a senha dele mudar.
  const sessaoDe = (req) => {
    const token = tokenDe(req);
    const sessao = token && sessoes.get(token);
    if (!sessao) return null;
    const usuario = banco.obterUsuario(sessao.usuarioId);
    if (sessao.expira < Date.now() || !usuario?.ativo || banco.lerHashDaSenha(usuario.id) !== sessao.marca) {
      sessoes.delete(token);
      return null;
    }
    return { token, usuario };
  };
  const AVISO_CONFIG = "O login não está configurado. Preencha LOGIN_USUARIO e LOGIN_SENHA no arquivo .env e reinicie o cotador.";

  // As tentativas contam por login: errar a própria senha não bloqueia os outros usuários.
  const bloqueado = (login) => (falhas.get(login)?.ate ?? 0) > Date.now();
  const registrarFalha = (login) => {
    if (falhas.size > 1000) falhas.clear();
    const f = falhas.get(login) ?? { n: 0, ate: 0 };
    f.n++;
    if (f.n >= MAX_FALHAS) { f.ate = Date.now() + ESPERA_FALHAS; f.n = 0; }
    falhas.set(login, f);
  };

  const rotas = express.Router();
  rotas.get("/login", (req, res) => {
    if (sessaoDe(req)) return res.redirect(303, "/");
    res.setHeader("Cache-Control", "no-store");
    if (!garantirAdmin()) return res.type("html").send(pagina(AVISO_CONFIG, false));
    // O aviso aparece uma vez só, para quem foi derrubado.
    const caiu = derrubadas.delete(tokenDe(req));
    res.type("html").send(pagina(caiu ? AVISO_DERRUBADA : ""));
  });

  rotas.post("/login", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!garantirAdmin()) return res.status(503).type("html").send(pagina(AVISO_CONFIG, false));
    const login = String(req.body?.usuario ?? "").trim().toLowerCase();
    if (bloqueado(login)) return res.status(429).type("html").send(pagina("Muitas tentativas. Aguarde um minuto e tente de novo."));
    const usuario = banco.obterUsuarioPorLogin(login);
    const hash = (usuario && banco.lerHashDaSenha(usuario.id)) || HASH_FALSO;
    const senhaCerta = conferirSenha(req.body?.senha ?? "", hash);
    if (!usuario || !senhaCerta || !usuario.ativo) {
      registrarFalha(login);
      return res.status(401).type("html").send(pagina("Login ou senha incorretos."));
    }
    falhas.delete(login);
    // Sessões vencidas saem da memória a cada login, para não se acumularem com o servidor ligado por meses.
    const agora = Date.now();
    for (const [t, s] of sessoes) if (s.expira < agora) sessoes.delete(t);
    for (const [t, expira] of derrubadas) if (expira < agora) derrubadas.delete(t);
    // Cada login é de uma pessoa só: entrar de novo derruba o acesso anterior do mesmo usuário.
    for (const [t, s] of sessoes) {
      if (s.usuarioId !== usuario.id) continue;
      sessoes.delete(t);
      derrubadas.set(t, s.expira);
    }
    const token = randomBytes(32).toString("base64url");
    sessoes.set(token, { usuarioId: usuario.id, expira: Date.now() + DURACAO_SESSAO, marca: hash });
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DURACAO_SESSAO / 1000}`);
    res.redirect(303, "/");
  });

  /* ---------- recuperação de senha ---------- */
  // A resposta é sempre a mesma, para a tela não revelar quais e-mails estão cadastrados.
  const AVISO_ENVIADO = "Se este e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Ele vale por 1 hora.";
  const AVISO_SEM_EMAIL = "A recuperação por e-mail ainda não foi configurada. Peça ao administrador para redefinir a sua senha.";
  const AVISO_LINK_INVALIDO = "Este link é inválido ou já venceu. Peça um novo.";
  const ultimosPedidos = new Map();
  const semMemoria = (res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
  };
  const podeEnviar = () => !!enviarEmail && !!urlBase();

  // Limita os pedidos por e-mail (um por minuto) e por origem (alguns a cada 10 minutos),
  // para o formulário não virar um disparador de mensagens.
  const pedidoRepetido = (chave) => {
    const agora = Date.now();
    if (ultimosPedidos.size > 1000) ultimosPedidos.clear();
    const repetido = agora - (ultimosPedidos.get(chave) ?? 0) < INTERVALO_RECUPERACAO;
    if (!repetido) ultimosPedidos.set(chave, agora);
    return repetido;
  };
  const MAX_PEDIDOS_POR_ORIGEM = 5, JANELA_ORIGEM = 10 * 60 * 1000;
  const pedidosPorOrigem = new Map();
  const origemPassouDoLimite = (origem) => {
    const agora = Date.now();
    if (pedidosPorOrigem.size > 1000) pedidosPorOrigem.clear();
    const recentes = (pedidosPorOrigem.get(origem) ?? []).filter((t) => agora - t < JANELA_ORIGEM);
    recentes.push(agora);
    pedidosPorOrigem.set(origem, recentes);
    return recentes.length > MAX_PEDIDOS_POR_ORIGEM;
  };

  rotas.get("/login/recuperar", (_req, res) => {
    semMemoria(res);
    res.type("html").send(podeEnviar() ? paginaRecuperar() : paginaRecuperar(AVISO_SEM_EMAIL, "", false));
  });

  rotas.post("/login/recuperar", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    semMemoria(res);
    if (!podeEnviar()) return res.status(503).type("html").send(paginaRecuperar(AVISO_SEM_EMAIL, "", false));
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    // A resposta continua a mesma: quem passa do limite só deixa de receber o e-mail.
    const repetido = origemPassouDoLimite(req.socket.remoteAddress ?? "") || pedidoRepetido(`email:${email}`);
    const usuario = !repetido ? banco.obterUsuarioPorEmail(email) : null;
    if (usuario?.ativo) {
      const token = randomBytes(32).toString("base64url");
      banco.criarRecuperacaoDeSenha(usuario.id, resumoDoToken(token), Date.now() + DURACAO_RECUPERACAO);
      const link = `${urlBase()}/login/redefinir?token=${token}`;
      const saudacao = usuario.nome ? `Olá, ${usuario.nome}!` : "Olá!";
      // Sem esperar o envio: o tempo de resposta também não pode revelar quem está cadastrado.
      Promise.resolve(enviarEmail({
        para: usuario.email,
        assunto: "Cotador de Planos: criar uma nova senha",
        texto: `${saudacao}\n\nRecebemos um pedido para criar uma nova senha do login ${usuario.login}.\nAbra este link em até 1 hora:\n\n${link}\n\nSe não foi você, ignore este e-mail: a sua senha continua a mesma.`,
      })).catch((e) => console.error("Não consegui enviar o e-mail de recuperação de senha:", e.message));
    }
    res.type("html").send(paginaRecuperar("", AVISO_ENVIADO));
  });

  rotas.get("/login/redefinir", (req, res) => {
    semMemoria(res);
    const token = String(req.query?.token ?? "");
    if (!banco.lerRecuperacaoDeSenha(resumoDoToken(token))) return res.status(400).type("html").send(paginaRecuperar(AVISO_LINK_INVALIDO, "", podeEnviar()));
    res.type("html").send(paginaRedefinir(token));
  });

  rotas.post("/login/redefinir", express.urlencoded({ extended: false, limit: "4kb" }), (req, res) => {
    semMemoria(res);
    const token = String(req.body?.token ?? ""), senha = String(req.body?.senha ?? "");
    const usuarioId = banco.lerRecuperacaoDeSenha(resumoDoToken(token));
    const usuario = usuarioId ? banco.obterUsuario(usuarioId) : null;
    if (!usuario?.ativo) return res.status(400).type("html").send(paginaRecuperar(AVISO_LINK_INVALIDO, "", podeEnviar()));
    if (senha.length < 8 || senha.length > 200) return res.status(400).type("html").send(paginaRedefinir(token, "A senha precisa ter pelo menos 8 caracteres."));
    if (senha !== req.body?.repete) return res.status(400).type("html").send(paginaRedefinir(token, "A nova senha e a repetição estão diferentes."));
    banco.alterarSenhaDoUsuario(usuario.id, gerarHash(senha));
    banco.apagarRecuperacoesDeSenha(usuario.id);
    falhas.delete(usuario.login.toLowerCase());
    res.type("html").send(pagina("", true, "Senha alterada. Entre com a nova senha."));
  });

  rotas.post("/sair", (req, res) => {
    const token = tokenDe(req);
    if (token) sessoes.delete(token);
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.redirect(303, "/login");
  });

  // Tudo o que vem depois daqui exige login; só as fontes da tela de login ficam livres.
  rotas.use((req, res, next) => {
    const sessao = sessaoDe(req);
    if (sessao) {
      req.usuario = sessao.usuario;
      req.tokenDaSessao = sessao.token;
      return next();
    }
    if (req.path.startsWith("/fonts/")) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ erro: "Entre com o seu login para continuar.", codigo: "sem_login" });
    if (req.method === "GET" && (req.path === "/" || req.path.endsWith(".html"))) return res.redirect(303, "/login");
    res.status(401).type("text").send("Entre com o seu login para continuar.");
  });
  // Quem troca a própria senha continua conectado neste navegador; as outras sessões dele caem.
  rotas.manterSessao = (token, hash) => {
    const sessao = sessoes.get(token);
    if (sessao) sessao.marca = hash;
  };
  return rotas;
}
