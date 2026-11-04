// Transforma o HTML da página da proposta em PNG, para a imagem sair igual ao link.
// Dentro de um SVG o navegador não busca arquivos externos: fontes e figuras entram no próprio documento.
const LARGURA = 1280, ESCALA = 2;

const arquivos = new Map();
function comoDataUrl(url) {
  if (!arquivos.has(url)) {
    const dados = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`Não consegui carregar ${url}.`);
      const blob = await r.blob();
      return new Promise((ok, erro) => {
        const leitor = new FileReader();
        leitor.onload = () => ok(leitor.result);
        leitor.onerror = () => erro(leitor.error);
        leitor.readAsDataURL(blob);
      });
    });
    dados.catch(() => arquivos.delete(url));
    arquivos.set(url, dados);
  }
  return arquivos.get(url);
}

async function embutirArquivos(doc) {
  await Promise.all([...doc.images].map(async (img) => { img.src = await comoDataUrl(img.getAttribute("src")); }));
  for (const estilo of doc.querySelectorAll("style")) {
    let css = estilo.textContent;
    for (const url of new Set([...css.matchAll(/url\((\/[^)]+)\)/g)].map((m) => m[1]))) {
      css = css.replaceAll(`url(${url})`, `url(${await comoDataUrl(url)})`);
    }
    estilo.textContent = css;
  }
}

// A altura só é conhecida depois de montar a página na largura da imagem.
async function medirAltura(doc) {
  const quadro = document.createElement("iframe");
  quadro.setAttribute("aria-hidden", "true");
  quadro.tabIndex = -1;
  quadro.style.cssText = `position:fixed;left:-${LARGURA * 2}px;top:0;width:${LARGURA}px;height:600px;border:0;visibility:hidden`;
  quadro.srcdoc = `<!doctype html>${doc.documentElement.outerHTML}`;
  try {
    await new Promise((ok, erro) => {
      quadro.onload = ok;
      quadro.onerror = () => erro(new Error("Não consegui montar a página da proposta."));
      document.body.append(quadro);
    });
    const interno = quadro.contentDocument;
    await interno.fonts.ready;
    await Promise.all([...interno.images].map((img) => img.decode().catch(() => {})));
    return Math.ceil(interno.documentElement.scrollHeight);
  } finally {
    quadro.remove();
  }
}

export async function paginaParaPng(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  await embutirArquivos(doc);
  const altura = await medirAltura(doc);

  // A página usa 100vh; aqui a altura é fixa para o painel lateral ir até o fim da imagem.
  const ajuste = doc.createElement("style");
  ajuste.textContent = `.page{min-height:${altura}px}`;
  doc.head.append(ajuste);
  const xml = new XMLSerializer();
  const estilos = [...doc.querySelectorAll("style")].map((s) => xml.serializeToString(s)).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LARGURA}" height="${altura}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${estilos}${xml.serializeToString(doc.body)}</div></foreignObject></svg>`;

  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = LARGURA * ESCALA;
  canvas.height = altura * ESCALA;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, erro) => canvas.toBlob((b) => (b ? ok(b) : erro(new Error("Não consegui gerar a imagem."))), "image/png"));
}
