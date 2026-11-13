// Documentos de clientes (contratos vendidos e envio pelo link da proposta): PDF ou imagem,
// conferidos pelo conteúdo e não pela extensão.
import { basename } from "node:path";
import { tipoImagem } from "./db.js";

export const MAX_ARQUIVO = 20 * 1024 * 1024;
const EXTENSOES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function tipoDoDocumento(b) {
  if (!Buffer.isBuffer(b)) return null;
  if (b.length > 5 && b.toString("latin1", 0, 5) === "%PDF-") return "application/pdf";
  const imagem = tipoImagem(b);
  return imagem ? { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[imagem] ?? null : null;
}

// O nome vem no cabeçalho X-Nome-Arquivo: sem caminho nem caracteres de controle.
export function nomeDoArquivo(req, tipo) {
  let nome = "";
  try { nome = decodeURIComponent(String(req.get("X-Nome-Arquivo") || "")); } catch { /* nome inválido: usa o padrão */ }
  return basename(nome.replaceAll("\\", "/")).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 150) || `documento.${EXTENSOES[tipo]}`;
}
