// Monta um PDF de uma página com a imagem da proposta, sem depender de biblioteca.
// A página tem a mesma proporção da imagem, para nada ser cortado.
const LARGURA_PAGINA = 842; // em pontos: o lado maior de uma folha A4

export function montarPdf(jpeg, larguraImagem, alturaImagem) {
  const largura = LARGURA_PAGINA;
  const altura = Math.round((LARGURA_PAGINA * alturaImagem / larguraImagem) * 100) / 100;
  const desenho = `q ${largura} 0 0 ${altura} 0 0 cm /Img Do Q`;
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${largura} ${altura}] /Resources << /XObject << /Img 4 0 R >> >> /Contents 5 0 R >>`,
    [`<< /Type /XObject /Subtype /Image /Width ${larguraImagem} /Height ${alturaImagem} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, "\nendstream"],
    `<< /Length ${desenho.length} >>\nstream\n${desenho}\nendstream`,
  ];

  const texto = new TextEncoder();
  const partes = [];
  let posicao = 0;
  const escrever = (dado) => {
    const bytes = typeof dado === "string" ? texto.encode(dado) : dado;
    partes.push(bytes);
    posicao += bytes.length;
  };

  escrever("%PDF-1.4\n");
  const inicios = objetos.map((objeto, i) => {
    const inicio = posicao;
    escrever(`${i + 1} 0 obj\n`);
    [objeto].flat().forEach(escrever);
    escrever("\nendobj\n");
    return inicio;
  });
  const inicioTabela = posicao;
  escrever(`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`);
  inicios.forEach((inicio) => escrever(`${String(inicio).padStart(10, "0")} 00000 n \n`));
  escrever(`trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioTabela}\n%%EOF\n`);

  const pdf = new Uint8Array(posicao);
  let destino = 0;
  for (const parte of partes) {
    pdf.set(parte, destino);
    destino += parte.length;
  }
  return pdf;
}

// A imagem vira JPEG porque o PDF guarda esse formato como está, sem precisar recodificar.
export async function imagemParaPdf(blob) {
  const figura = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = figura.width;
  canvas.height = figura.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(figura, 0, 0);
  figura.close();
  const jpeg = await new Promise((ok, erro) => canvas.toBlob((b) => (b ? ok(b) : erro(new Error("Não consegui gerar o PDF."))), "image/jpeg", 0.92));
  const pdf = montarPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height);
  return new Blob([pdf], { type: "application/pdf" });
}
