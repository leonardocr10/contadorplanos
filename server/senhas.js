// Senhas dos usuários: o banco guarda só o resultado do scrypt, nunca a senha.
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const TAMANHO = 64;
const scryptEmSegundoPlano = promisify(scrypt);

// Mesmo resultado de gerarHash, sem travar o servidor para os outros pedidos enquanto calcula.
export async function gerarHashSemTravar(senha) {
  const sal = randomBytes(16);
  return `${sal.toString("hex")}:${(await scryptEmSegundoPlano(String(senha), sal, TAMANHO)).toString("hex")}`;
}

export function gerarHash(senha) {
  const sal = randomBytes(16);
  return `${sal.toString("hex")}:${scryptSync(String(senha), sal, TAMANHO).toString("hex")}`;
}

export function conferirSenha(senha, guardado) {
  const [sal, hash] = String(guardado).split(":");
  if (!sal || !hash) return false;
  const esperado = Buffer.from(hash, "hex");
  return esperado.length === TAMANHO && timingSafeEqual(scryptSync(String(senha), Buffer.from(sal, "hex"), TAMANHO), esperado);
}
