// Liga o servidor público à internet com o cloudflared. O endereço muda a cada vez que o túnel é iniciado.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function acharCloudflared() {
  const candidatos = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles].filter(Boolean).map((p) => join(p, "cloudflared", "cloudflared.exe"));
  return candidatos.find((c) => existsSync(c)) ?? "cloudflared";
}

export function iniciarTunel(portaPublica) {
  const estado = { estado: "conectando", url: null };
  let filho = null, encerrando = false;

  const ligar = () => {
    estado.estado = "conectando";
    estado.url = null;
    filho = spawn(acharCloudflared(), ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${portaPublica}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const lerLog = (trecho) => {
      const texto = String(trecho);
      estado.url ??= texto.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null;
      if (estado.url && /Registered tunnel connection/i.test(texto)) {
        estado.estado = "ativo";
        console.log(`Links das propostas disponíveis em ${estado.url}`);
      }
    };
    filho.stdout.on("data", lerLog);
    filho.stderr.on("data", lerLog);
    filho.on("error", (e) => {
      estado.estado = "indisponivel";
      console.error(e.code === "ENOENT" ? "O cloudflared não está instalado: os links das propostas ficam desligados." : `Erro no túnel: ${e.message}`);
    });
    filho.on("exit", () => {
      if (encerrando || estado.estado === "indisponivel") return;
      estado.estado = "conectando";
      estado.url = null;
      setTimeout(() => { if (!encerrando) ligar(); }, 30_000);
    });
  };
  ligar();

  return {
    estado: () => ({ ...estado }),
    encerrar() {
      encerrando = true;
      filho?.kill();
    },
  };
}
