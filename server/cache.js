// O que o navegador pode guardar de cada arquivo.
// - Telas, scripts e estilos: sempre conferidos com o servidor, para uma atualização valer na hora.
// - Fontes e imagens dos planos: guardadas por um tempo, porque quase nunca mudam.
// - Imagens enviadas: o nome é único, então o arquivo nunca muda e pode ficar guardado.
const DIA = 24 * 60 * 60;

export function cacheDoArquivo(res, caminho, { privado = true } = {}) {
  if (/\.woff2$/i.test(caminho)) res.setHeader("Cache-Control", `public, max-age=${30 * DIA}`);
  else if (/[\\/]img[\\/]/.test(caminho)) res.setHeader("Cache-Control", `public, max-age=${DIA}`);
  else res.setHeader("Cache-Control", `${privado ? "private" : "public"}, no-cache`);
}

export const cacheDoEnvio = ({ privado = true } = {}) => (res) =>
  res.setHeader("Cache-Control", `${privado ? "private" : "public"}, max-age=${365 * DIA}, immutable`);

// Respostas da API têm dados de clientes: o navegador não guarda nenhuma.
export const naoGuardar = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
};
