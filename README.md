# Cotador de Planos

Monta cotações por faixa etária e gera uma imagem de proposta por plano para enviar pelo WhatsApp. Roda só no seu computador.

## Como usar

1. Instale o **Node.js** versão LTS: https://nodejs.org (só na primeira vez).
2. Dê dois cliques em **`iniciar.bat`**. Na primeira vez ele instala o que falta, o que pode levar alguns minutos. Depois, o cotador abre sozinho no navegador.
3. Deixe a janela preta aberta enquanto usa o cotador. Para encerrar, feche essa janela.

Na aba **Meus dados**, preencha seu nome, telefone e corretora. Eles aparecem na imagem e na legenda.

## Links das propostas

Ao clicar em **Abrir no WhatsApp** ou em **Copiar legenda**, o cotador cria uma página para cada plano e coloca os links na mensagem. O cliente abre a proposta no celular, sem precisar de imagem.

**Por enquanto, o link é local:** ele só abre neste computador, com o cotador ligado, e o cliente não consegue abri-lo. Até ter o domínio, envie também a imagem da proposta.

A página guarda os valores do momento em que o link foi criado. Mudar o plano depois não altera o que já foi gerado.

Quando as páginas estiverem publicadas num domínio, coloque o endereço no `.env` e reinicie o cotador:

```
PUBLIC_URL=https://propostas.seudominio.com.br
```

Quem receber o link consegue ver o nome do cliente e os valores da proposta. Na publicação, exponha só a porta pública: o cotador, o histórico e o backup não têm senha.

## Leitura automática de tabelas (opcional)

Para o Claude ler o PDF ou a imagem de uma tabela nova, é preciso ter uma chave da API, criada em https://platform.claude.com. O uso da API é cobrado à parte.

1. Abra o arquivo **`.env`** na pasta do cotador com o Bloco de Notas. Ele é criado na primeira execução.
2. Coloque a chave depois do sinal de igual: `ANTHROPIC_API_KEY=sua-chave-aqui`
3. Salve o arquivo, feche a janela do cotador e abra o `iniciar.bat` de novo.

Sem a chave, todo o resto funciona normalmente, inclusive sem internet. Para atualizar valores, use o campo **Colar da planilha** no editor do plano.

## Backup

Seus planos e seu histórico ficam em `dados\cotador.db`, e as imagens enviadas ficam em `dados\uploads`.

- **`backup.bat`**: copia o banco para a pasta `backups`, com data e hora no nome.
- **Aba Meus dados**: **Fazer backup** baixa uma cópia do banco, e **Restaurar backup** troca os dados atuais pelos de um arquivo. Antes de trocar, o cotador guarda uma cópia dos dados atuais em `backups`.

O backup do banco não inclui as imagens de `dados\uploads`. Copie essa pasta também se quiser guardá-las.

## Para quem for mexer no código

```bash
npm install
```

```bash
npm test
```

As portas (`PORT`, padrão 3210, e `PORT_PUBLICA`, padrão 3211) e o modelo do Claude (`ANTHROPIC_MODEL`) ficam no `.env`. A porta pública é atendida por `server/publico.js` e só entrega as páginas das propostas.
