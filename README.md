# Cotador de Planos

Monta cotações por faixa etária e gera uma imagem de proposta por plano para enviar pelo WhatsApp. Roda num computador ou servidor Windows, com login para cada pessoa, e as propostas podem ser abertas pelo cliente num link.

## Como usar

1. Dê dois cliques em **`iniciar.bat`**. Ele instala o que faltar, inclusive o Node.js, e pode levar alguns minutos na primeira vez. Se o Windows pedir permissão, clique em Sim. Depois, o cotador abre sozinho no navegador.
2. Deixe a janela preta aberta enquanto usa o cotador. Para encerrar, feche essa janela.

Se o Node.js não puder ser instalado automaticamente, baixe a versão LTS em https://nodejs.org e abra o `iniciar.bat` de novo.

Nos planos de pessoa física por adesão, ao selecionar o plano na **Nova cotação** abre uma janela para escolher a **administradora** e a **entidade** do titular, e só depois aparecem os valores. Planos com o mesmo nome e administradoras diferentes viram um cartão só, cada um com a sua tabela de preço. A escolha fica salva com a cotação e define o preço, mas não aparece na mensagem, na imagem nem no link. Cada plano guarda a administradora e as entidades (uma por linha, `SIGLA – público`) em **Planos e Valores**.

Em **Configurações > Meus dados**, preencha seu nome, telefone e corretora. Eles aparecem na imagem e na mensagem.

O **manual de uso** abre como uma tela do sistema pelo ícone **?** no topo do menu, ao lado do cadeado. O conteúdo fica em `public/manual.html` (só para quem entrou no sistema). As imagens ficam em `public/img/manual/` e usam só clientes fictícios, nunca dados reais. Ao mudar uma tela, atualize o manual e a imagem dela junto.

## Atualizar o sistema

Com o login de administrador, em **Configurações > Atualizar sistema**, clique em **Atualizar agora**. O cotador baixa a versão nova do GitHub e reinicia sozinho, desde que tenha sido aberto pelo `iniciar.bat`. Quando ele volta, a tela recarrega com a versão nova: o navegador sempre confere com o servidor as telas e os scripts, então não precisa limpar o cache.

## Login

Cada pessoa entra com o próprio login e, em **Configurações**, preenche os próprios dados e altera a própria senha. O administrador também vê usuários, backup e a atualização do sistema. As senhas ficam no banco só como hash. As páginas das propostas continuam abrindo sem login para o cliente.

Cada login é de uso individual: quando alguém entra com um login que já está em uso, o acesso anterior é encerrado na hora. Quem caiu volta para a tela de login, que explica o motivo.

O primeiro administrador é criado a partir do arquivo `.env`, que não vai para o GitHub:

```
LOGIN_USUARIO=seu_login
LOGIN_SENHA=sua_senha
```

Depois disso, a senha é alterada em **Configurações**, e mudar o `.env` não muda mais a senha.

Se o administrador esquecer a senha, coloque a nova senha em `LOGIN_SENHA`, acrescente `LOGIN_REDEFINIR_SENHA=1` ao `.env` e reinicie o cotador. Depois de entrar, apague a linha `LOGIN_REDEFINIR_SENHA`, senão a senha volta para a do `.env` a cada reinício.

### Acesso às telas

Em **Configurações > Usuários** (a lista mostra o nome e pagina de 10 em 10), o administrador escolhe, para cada usuário e cada tela (Nova Cotação, Planos e Valores, Documentos, Histórico, Aceites e Contratos Vendidos), entre **Sem acesso**, **Visualização** e **Edição**. O administrador sempre tem acesso a tudo. Quem só visualiza a Nova Cotação pode simular, mas não envia nem salva.

No **Histórico**, cada usuário vê e altera só as próprias cotações, inclusive o administrador. O backup guarda as cotações de todos.

Usuários não são excluídos: o administrador **desativa** quem não deve mais entrar. O login fica bloqueado, e as cotações, os contratos vendidos e os documentos dos clientes continuam guardados. **Ativar** devolve o acesso com tudo como estava.

### Mensalidades

Em **Configurações > Mensalidades**, o administrador controla a cobrança mensal de uso do sistema de cada corretor (todo login com o perfil Usuário; o administrador não paga). O pagamento é marcado à mão, sem integração com banco ou boleto.

- **Busca e situação:** a tela mostra o previsto por mês, o recebido e o que falta receber no mês e o total em atraso. Clicar num desses números filtra a lista pelos corretores daquela conta. Os cards (Atrasado, Vence em breve, Em dia, Sem cobrança e Bloqueado, quando houver) também filtram, e a busca acha o corretor pelo nome, login, e-mail ou telefone. O menu mostra quantos corretores estão atrasados. A coluna **Última cobrança** mostra o mês mais recente e se está pago, em aberto ou atrasado.
- **Programar a cobrança:** valor por mês, dia do vencimento (de 1 a 28, para existir em todo mês) e o primeiro mês cobrado. Os meses são criados sozinhos, do primeiro mês até o atual, e o do mês seguinte aparece 7 dias antes de vencer. Mudar o valor ou o dia vale para os meses que ainda não venceram; os pagos e os atrasados ficam como estavam. Desmarcar **Cobrança ativa** pausa: não cria meses novos e não bloqueia. Antes de salvar, a janela mostra a prévia (valor, dia e os próximos vencimentos).
- **Pagamento:** em cada mês, **Marcar como pago** com a data e a forma (Pix, transferência, dinheiro, boleto, cartão ou outra), **Desfazer pagamento** e **Dispensar** (o mês fica na lista sem ser cobrado, como numa cortesia).
- **Cobrar pelo WhatsApp:** abre a conversa com o corretor e um texto pronto com os meses atrasados e os que vencem nos próximos 7 dias.
- **Bloqueio por atraso:** com **Bloquear o login com atraso de** preenchido (de 1 a 90 dias; 0 desliga), quem tiver um mês atrasado há mais dias que isso tem o login desativado, e a sessão aberta cai. Quando o atraso é pago, o mês é dispensado, a cobrança é pausada ou o bloqueio é desligado, o login volta sozinho. Quem o administrador desativou à mão em **Usuários** continua desativado, e um login bloqueado pelo atraso só é reativado pela tela Mensalidades. A conferência roda ao abrir o cotador, de hora em hora e a cada mudança na tela.

- **Régua de cobrança:** lembretes automáticos de cada mês em aberto, alguns dias antes do vencimento (padrão 5), no dia e alguns dias depois (padrão 3), de segunda a sexta, das 9h às 18h. Saem pelo WhatsApp de quem salvou a régua (a mesma conexão da tela Resgate, pela Evolution API) e pelo e-mail do servidor (SMTP do .env), uma vez só por mês, etapa e canal; o aviso de atraso só sai nos 7 dias seguintes ao prazo, para ligar a régua não disparar avisos de dívidas antigas. Um texto de **Como pagar** (ex.: chave Pix) vai no fim de cada lembrete. O bloqueio por atraso fica no mesmo bloco. Começa sem canal marcado: nada sai até o administrador escolher.
- **Registro de alterações:** cada corretor tem a lista de quem programou ou mudou a cobrança, marcou ou desfez um pagamento, dispensou um mês, e quando. O bloqueio e a liberação automáticos aparecem como feitos pelo Sistema. Os meses e o registro abrem numa janela, pelo ícone do olho.

As mensalidades e o registro ficam no banco e entram no backup.

### Recuperar a senha por e-mail

Cada usuário tem um e-mail, e a tela de login oferece **Esqueci minha senha**. O link enviado vale por uma hora e uma única vez. Para funcionar, preencha os dados do servidor de e-mail no `.env` e reinicie o cotador:

```
SMTP_HOST=smtp.seu-provedor.com
SMTP_PORTA=587
SMTP_USUARIO=seu_usuario
SMTP_SENHA=sua_senha
SMTP_REMETENTE=cotador@seu-dominio.com
```

O endereço do link vem de `PUBLIC_URL`, que também precisa estar preenchido: sem ele, a recuperação fica desligada. Quem já existia antes desta função precisa preencher o e-mail em **Configurações > Meus dados**, ou pedir ao administrador.

## Links das propostas

As páginas das propostas ficam abertas para a internet na porta 9090. Execute o `iniciar.bat` como administrador na primeira vez, para ele liberar a porta no firewall do Windows, e preencha no `.env` o endereço público, como `PUBLIC_URL=http://IP_DA_MAQUINA:9090`. A tela do cotador também abre nessa porta, sempre com login. Use uma senha forte e, se possível, um domínio com HTTPS: sem HTTPS, a senha e os dados trafegam sem criptografia.

A mensagem enviada não traz link: vai o texto e a imagem da proposta. O botão **Copiar link** cria a página de cada plano escolhido, com o botão de aceite, e copia o endereço para você enviar ao cliente.

**Sem `PUBLIC_URL`, o link é local:** ele só abre no próprio computador do cotador, e o cliente não consegue abri-lo. A imagem da proposta mostra a mesma página do link, na tela de computador, com a primeira situação de carência. O botão de aceite e o seletor da imagem são só desenho: para aceitar ou trocar a situação, o cliente precisa do link.

A página guarda os valores do momento em que o link foi criado. Mudar o plano depois não altera o que já foi gerado.

### Aceite da proposta

A página da proposta tem o botão **Aceitar proposta**: o cliente escolhe a acomodação e confirma. Depois disso:

- A página avisa o cliente que ele receberá a lista de documentos necessários para a contratação, e oferece o botão **Falar com o corretor no WhatsApp**.
- O aceite aparece na tela **Aceites**. O botão **Pedir documentos no WhatsApp** mostra os documentos do plano: desmarque o que não quer pedir, e a conversa abre com a mensagem pronta e o link de envio.

### Envio de documentos pelo cliente

Depois de aceitar, o cliente vê na própria proposta o botão **Enviar documentos**. O endereço é o da proposta com `/documentos` no fim.

- **Login pelo telefone:** o cliente informa o número de WhatsApp da proposta, com DDD. Vale com ou sem o nono dígito. Se a proposta foi criada sem número, o primeiro telefone informado passa a ser o login dela. Cinco números errados bloqueiam a entrada por um minuto.
- **Envio aos poucos:** a página lista os documentos do plano aceito e aceita foto ou PDF de até 20 MB, vários por documento. Cada arquivo é guardado assim que chega: o cliente pode parar e voltar depois pelo mesmo link, em qualquer aparelho, informando o telefone. O acesso dura 30 dias em cada aparelho.
- **Fotos grandes:** são reduzidas no próprio celular antes de subir, para o envio ser rápido.
- **Concluir:** ao terminar, o cliente toca em **Concluir envio**. Ele pode concluir com documentos faltando e também reabrir para trocar ou acrescentar algum.
- **Para o corretor:** a tela **Aceites** mostra quantos documentos chegaram e, em **Documentos do cliente**, cada arquivo para abrir ou baixar. **Copiar link de envio** copia o endereço para mandar ao cliente.
- **Privacidade:** os arquivos ficam no banco de dados e entram no backup. Pela internet, o cliente vê só o nome dos arquivos que enviou e pode removê-los; o conteúdo só abre dentro do cotador, com login. Excluir o aceite apaga os documentos dele.

O aceite registra o interesse do cliente, mas não substitui a assinatura do contrato com a operadora.

## Documentos

Na tela **Documentos**, escolha o plano na lista para cadastrar ou excluir os documentos dele. Nos planos com várias opções (ex.: AMIL OURO 30%, 40%, MEI, PARCIAL), escolha em qual opção cadastrar. Marque os documentos que quer pedir e copie a mensagem pronta para o WhatsApp.

## Contratos Vendidos

Cadastre cada venda com o nome e o telefone do cliente, o plano contratado, o valor e a data de ativação. A partir da data de ativação, até você marcar **Contato feito**, o sistema avisa que é preciso falar com o cliente: um número na tela, uma faixa no topo e um aviso ao abrir o cotador. O botão **Mensagem no WhatsApp** abre um texto pronto, que pode ser editado antes de enviar. No topo, o **Mês de ativação** escolhe o mês dos cards e da grade; clicar num card mostra só os contratos daquela situação.

A venda também entra pelo **Histórico**: ao mudar a situação de uma cotação para **Vendida**, abre uma janela com o plano e a acomodação cotados (o valor vem da cotação e pode ser ajustado), a data de ativação, o nome, o telefone e o e-mail. Ao clicar em **Cadastrar venda**, a cotação fica como Vendida e o contrato entra em Contratos Vendidos. Cancelar volta a situação de antes. Tirar a cotação de Vendida depois (Em Negociação, Enviada ou Negativa) tira de Contratos Vendidos o contrato que ela gerou, com os documentos dele; contratos vindos do Aceites ou cadastrados direto na tela ficam. A **maleta** na linha do cliente faz o mesmo pela última cotação; ela fica em destaque quando o cliente já está como Vendida e ainda não tem contrato. Cada cliente entra uma vez só: com um contrato do mesmo telefone (ou o contrato que uma cotação dele gerou), a maleta fica marcada e trocar para Vendida só muda a situação. Pelo **Aceites**, a venda continua entrando com os documentos do cliente.

Em **Documentos**, cada contrato guarda os arquivos que o cliente enviou (PDF, JPG, PNG ou WebP), sem limite de quantidade. As fotos são reduzidas antes do envio. Os arquivos ficam dentro do banco: entram no backup e não têm link público. Cada usuário vê só os contratos que cadastrou, inclusive o administrador. Excluir um contrato apaga também os documentos dele.

## Resgate

A tela **Resgate** junta, sozinha, os clientes que estão sem cotar há mais dias que o escolhido e que não fecharam (nenhuma cotação Vendida e nenhum contrato com o mesmo telefone). Quem está como **Negativa** no Histórico (a situação da última cotação) também fica de fora. Se a cotação for excluída do Histórico, o cliente sai do resgate, a não ser que a mensagem já tenha sido enviada. Cada corretor define os dias no topo da tela (de 0 a 730; o padrão é 90; com 0, quem cotou e não fechou entra na hora, o que serve para testar o envio): ao mudar, a fila é refeita na hora. Cada cliente recebe **uma vez só** uma mensagem no WhatsApp de quem fez a cotação, sem ninguém precisar clicar em enviar. Cada vendedor conecta o próprio número na tela, lendo um QR Code com o celular, e pode ajustar o texto, desligar o envio, tirar um cliente da fila ou colocá-lo de volta.

Para o número não ser bloqueado pelo WhatsApp, as mensagens saem de segunda a sexta, das 9h às 18h (horário de Brasília), até 30 por dia por vendedor e com 2 a 5 minutos entre uma e outra. Cada vendedor pode mudar, na própria tela, quantas mensagens saem por dia (de 1 a 200) e o intervalo mínimo e máximo entre elas (de 1 a 120 minutos; cada espera é sorteada nessa faixa). Se o número do cliente não tiver WhatsApp, ele fica como **Não enviada**; outras falhas são tentadas mais 2 vezes.

O envio usa a [Evolution API](https://github.com/evolution-foundation/evolution-api), que roda na própria VPS. Ela não é oficial do WhatsApp: use com moderação. Sem a Evolution, a lista continua sendo montada, mas nada é enviado. A régua de cobrança das mensalidades usa a mesma conexão.

### Evolution API sem Docker (Windows)

Use a versão **2.3.7**, a estável mais recente no [repositório oficial](https://github.com/evolution-foundation/evolution-api/releases) quando este passo a passo foi escrito. Não use as versões 2.4.0-rc: são de teste e pedem ativação de licença.

**Jeito automático (recomendado):**

1. Na pasta do cotador, clique com o botão direito no **`instalar-evolution.bat`** e escolha **Executar como administrador**. Ele instala o Git e o PostgreSQL (pelo winget), cria o usuário e o banco `evolution` com senha aleatória, baixa a Evolution 2.3.7 em `C:evolution-api`, grava a configuração, instala as dependências, prepara o banco e monta tudo. Leva uns 10 minutos. Para outra pasta: `instalar-evolution.bat D:evolution-api`.
2. No fim, ele mostra as duas linhas `EVOLUTION_URL` e `EVOLUTION_API_KEY`: copie para o `.env` do cotador.
3. Abra o **`evolution.bat`** (como administrador na primeira vez) e reinicie o cotador, como nos passos 6 a 8 abaixo.

Se algo falhar no meio, corrija o que a mensagem pedir e rode o instalador de novo: o que já está pronto é aproveitado, e a chave e a senha do banco continuam as mesmas. A senha do administrador do PostgreSQL instalado por ele fica em `C:evolution-api.senha-postgres`. Se o PostgreSQL já estava instalado, ele pergunta essa senha.

**Passo a passo à mão** (o mesmo que o instalador faz), no PowerShell aberto como administrador:

1. **Programas.** O Node.js já vem com o cotador (a Evolution pede o 20 ou mais novo). Instale também:
   - o Git: `winget install --id Git.Git -e`;
   - o PostgreSQL, o banco da Evolution: baixe o instalador em https://www.postgresql.org/download/windows/ e, na instalação, anote a senha do usuário `postgres`.
2. **Banco.** Crie o usuário e o banco da Evolution (troque a senha; se a pasta do PostgreSQL não for a 16, ajuste o número):

   ```powershell
   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE USER evolution WITH PASSWORD 'troque-esta-senha';"
   & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -c "CREATE DATABASE evolution OWNER evolution;"
   ```
3. **Baixar e instalar** na pasta `C:\evolution-api`:

   ```powershell
   git clone --branch 2.3.7 --depth 1 https://github.com/evolution-foundation/evolution-api.git C:\evolution-api
   cd C:\evolution-api
   npm install
   copy .env.example .env
   ```
4. **Configurar.** No arquivo `C:\evolution-api\.env`, mude estas linhas (as outras podem ficar como estão):

   ```
   SERVER_URL=http://127.0.0.1:8080
   AUTHENTICATION_API_KEY=troque-por-uma-chave-longa
   DATABASE_PROVIDER=postgresql
   DATABASE_CONNECTION_URI='postgresql://evolution:troque-esta-senha@localhost:5432/evolution?schema=evolution_api'
   CACHE_REDIS_ENABLED=false
   CACHE_LOCAL_ENABLED=true
   TELEMETRY_ENABLED=false
   ```

   A chave é uma senha que só o cotador e a Evolution conhecem: use uma longa e aleatória. Sem Redis, o cache fica na memória, o que basta para poucos números.
5. **Preparar o banco e montar a Evolution**, ainda em `C:\evolution-api`:

   ```powershell
   npm run db:generate
   npm run db:deploy:win
   npm run build
   ```
6. **Ligar.** Abra o **`evolution.bat`** da pasta do cotador, como administrador na primeira vez: ele fecha a porta 8080 no firewall do Windows, para a Evolution não ser aberta pela internet (o cotador fala com ela pelo próprio servidor). A janela precisa ficar aberta, como a do cotador; se a Evolution cair, ela volta sozinha em 10 segundos. Se a pasta não for `C:\evolution-api`, passe o caminho: `evolution.bat D:\evolution-api`. Para a Evolution subir junto com o Windows, coloque um atalho do `evolution.bat` no mesmo lugar onde está o do `iniciar.bat` (por exemplo, a pasta que abre com `shell:startup`).
7. **Ligar ao cotador.** No `.env` do cotador, coloque o endereço e a mesma chave do passo 4:

   ```
   EVOLUTION_URL=http://127.0.0.1:8080
   EVOLUTION_API_KEY=troque-por-uma-chave-longa
   ```
8. **Reiniciar o cotador.** Feche a janela do cotador e abra o `iniciar.bat` de novo. Cada vendedor abre **Resgate** e clica em **Conectar meu WhatsApp**.

**Atualizar a Evolution depois:** feche a janela do `evolution.bat` e, em `C:\evolution-api`, rode `git fetch --tags`, `git checkout NOVA_VERSAO` (a versão estável nova do repositório oficial), `npm install`, `npm run db:generate`, `npm run db:deploy:win` e `npm run build`. Depois abra o `evolution.bat` de novo. Os números conectados ficam guardados e não precisam ler o QR Code outra vez.

<details>
<summary>Com Docker (alternativa)</summary>

Se a VPS tiver Docker, a Evolution pode subir com este `docker-compose.yml` (troque as duas senhas e confira a tag da imagem no Docker Hub, `evoapicloud/evolution-api`). A porta fica presa ao `127.0.0.1`. Depois, siga os passos 7 e 8 acima.

```yaml
services:
  evolution:
    image: evoapicloud/evolution-api:v2.3.7
    restart: always
    ports: ["127.0.0.1:8080:8080"]
    environment:
      SERVER_URL: http://127.0.0.1:8080
      AUTHENTICATION_API_KEY: troque-por-uma-chave-longa
      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://evolution:troque-esta-senha@postgres:5432/evolution
      CACHE_REDIS_ENABLED: "false"
      CACHE_LOCAL_ENABLED: "true"
    volumes: ["evolution_instances:/evolution/instances"]
    depends_on: [postgres]
  postgres:
    image: postgres:16
    restart: always
    environment:
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: troque-esta-senha
      POSTGRES_DB: evolution
    volumes: ["postgres_data:/var/lib/postgresql/data"]
volumes:
  evolution_instances:
  postgres_data:
```

</details>

## Financeiro

O menu **Financeiro** abre dois itens ao ser clicado. Quem não é administrador começa sem acesso: libere em **Configurações > Usuários**. Cada login vê e altera só as próprias corretoras, regras e comissões, inclusive o administrador. As corretoras de antes dessa separação ficam com o primeiro administrador que abrir o Financeiro.

- **Regras de pagamento:** a tela mostra a lista das corretoras. Clique numa corretora para abrir as regras dela, ou em **Nova regra** na linha para já cadastrar. No cadastro, dá para marcar vários planos: a mesma regra é criada para cada um. Cada regra tem o segmento (Pessoa física ou PME), a operadora, escolhida entre os planos cadastrados no sistema (Pessoa física mostra os planos PF; PME, os planos CNPJ), a **angariação** e até 4 parcelas. A angariação é só para Pessoa física. Tudo em % sobre a mensalidade: a angariação é paga no ato da venda e as parcelas uma por mês, a 1ª no mês da ativação, a 2ª no mês seguinte e assim por diante. Campo em branco vale zero.
- **Comissões:** lista os contratos de Contratos Vendidos com a mensalidade cadastrada. Escolha a regra direto na linha do contrato: a lista traz só as corretoras que têm regra para o plano dele. O detalhamento mostra cada pagamento previsto, com a data e o valor; o percentual e a data de cada linha podem ser alterados só para aquele contrato (Voltar ao da regra desfaz). O mês **Previsto para**, no topo (começa no mês atual), usa a data prevista de cada pagamento: os cards, a grade (com o valor do mês na coluna Comissão) e a lista mostram só os pagamentos daquele mês. Os cards mostram a **comissão prevista** (pagamentos do mês ainda com Pago = Não) e as **comissões recebidas** (os marcados como pagos na calculadora), além dos contratos sem regra. Clicar na comissão prevista ou nas recebidas abre a lista dos pagamentos, com o botão **Gerar Excel** (.xlsx).

Excluir uma regra ou uma corretora deixa sem regra os contratos que a usavam. Ao atualizar, as regras antigas (das tabelas importadas antes) que não são de um plano cadastrado são excluídas uma única vez.

### Publicação

Quando as páginas estiverem publicadas num domínio, coloque o endereço no `.env` e reinicie o cotador:

```
PUBLIC_URL=https://propostas.seudominio.com.br
```

Quem receber o link consegue ver o nome do cliente e os valores da proposta. Exponha na internet só a porta pública (9090): nela, as propostas abrem sem login, e a tela do cotador, o histórico e o backup sempre pedem login. A porta 3210 atende só o próprio computador.

## Leitura automática de tabelas (opcional)

Para o Claude ler o PDF ou a imagem de uma tabela nova, é preciso ter uma chave da API, criada em https://platform.claude.com. O uso da API é cobrado à parte.

1. Abra o arquivo **`.env`** na pasta do cotador com o Bloco de Notas. Ele é criado na primeira execução.
2. Coloque a chave depois do sinal de igual: `ANTHROPIC_API_KEY=sua-chave-aqui`
3. Salve o arquivo, feche a janela do cotador e abra o `iniciar.bat` de novo.

Sem a chave, todo o resto funciona normalmente, inclusive sem internet. Para atualizar valores, use o campo **Colar da planilha** no editor do plano.

## Backup

Os planos, o histórico, os contratos vendidos e os documentos dos clientes ficam em `dados\cotador.db`, e as imagens enviadas ficam em `dados\uploads`.

- **Configurações > Backup**: **Fazer backup** baixa um único arquivo com o banco e as imagens de `dados\uploads`, inclusive as fotos dos usuários. **Restaurar backup** troca os dados atuais pelos do arquivo e devolve as imagens dele. Antes de trocar, o cotador guarda uma cópia dos dados atuais em `backups`. Backups antigos, feitos sem as imagens, continuam funcionando e deixam as imagens atuais como estão.
- **`backup.bat`**: copia o banco e a pasta de imagens para `backups`, com data e hora no nome. Para voltar essa cópia, devolva os dois para a pasta `dados` com o cotador fechado.

## Para quem for mexer no código

```bash
npm install
```

```bash
npm test
```

As portas (`PORT`, padrão 3210, e `PORT_PUBLICA`, padrão 9090) e o modelo do Claude (`ANTHROPIC_MODEL`) ficam no `.env`. A porta pública é atendida por `server/publico.js` e só entrega as páginas das propostas.
