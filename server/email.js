// Envio de e-mail pelo servidor configurado no .env. Sem SMTP_HOST, o sistema segue sem enviar nada.
export function criarEnviadorDeEmail(env) {
  const host = (env.SMTP_HOST || "").trim();
  if (!host) return null;
  const porta = Number(env.SMTP_PORTA) || 587;
  const usuario = (env.SMTP_USUARIO || "").trim();
  const remetente = (env.SMTP_REMETENTE || usuario).trim();
  return async ({ para, assunto, texto }) => {
    // Só carrega a biblioteca quando for usar: quem não configurou o e-mail não depende dela.
    const { default: nodemailer } = await import("nodemailer");
    const transporte = nodemailer.createTransport({
      host,
      port: porta,
      secure: porta === 465,
      auth: usuario ? { user: usuario, pass: env.SMTP_SENHA || "" } : undefined,
      connectionTimeout: 15_000,
      socketTimeout: 30_000,
    });
    await transporte.sendMail({ from: remetente, to: para, subject: assunto, text: texto });
  };
}
