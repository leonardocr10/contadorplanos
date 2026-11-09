// Compressão das respostas. É opcional: se a peça "compression" ainda não foi instalada (por exemplo, numa
// atualização que baixou o código novo sem rodar o npm ci), o cotador abre do mesmo jeito, só sem comprimir.
let compression = null;
try {
  compression = (await import("compression")).default;
} catch {
  console.error('Aviso: a peça "compression" não está instalada; as respostas vão sem compressão. Feche e abra pelo iniciar.bat para instalar.');
}

export const comprimir = () => (compression ? compression() : (_req, _res, next) => next());
