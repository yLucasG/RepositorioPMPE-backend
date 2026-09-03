# Instalação no servidor do DTEC/PMPE

Versão 100% self-hosted: banco de dados, arquivos (PDFs) e o site inteiro rodam na
própria máquina do DTEC, sem nenhuma conta ou serviço externo (Vercel, Supabase etc).
A única coisa opcional que depende de internet é a extração automática de dados por
IA (API do Gemini) — se não quiserem isso, o servidor pode ficar totalmente offline.

**O sistema é dividido em dois repositórios** — este (backend: API + banco + PDFs) e
o [RepositorioPMPE-frontend](https://github.com/yLucasG/RepositorioPMPE-frontend)
(interface Angular) — mas isso não muda a instalação: pelo caminho com Docker (abaixo),
vocês só clonam **este** repositório, o frontend é baixado e buildado automaticamente
durante o `docker compose up`. Só o caminho sem Docker (seção 7) exige clonar os dois
manualmente.

**Duas formas de instalar**, escolha uma: mesma aplicação (Angular + Node/Express +
PostgreSQL + PDFs em disco), só muda quem gerencia o Postgres e o processo do site.
Se o DTEC já usa Node e Postgres direto na máquina (sem container), pule pra
[seção 7](#7-instalação-nativa-sem-docker---node-e-postgres-já-existentes-no-servidor)
e ignore as seções 2 e 3 (que são específicas do caminho com Docker):

- **Seções 2–3 (abaixo):** com Docker — mais simples de instalar do zero, não precisa
  ter Node/Postgres já no servidor, tudo isolado em containers, e só um repositório
  pra clonar.
- **Seção 7 (final do documento):** sem Docker — usa o Node e o Postgres que já
  existem no servidor do DTEC, do jeito que o time deles já trabalha.

---

## 1. O que baixar/instalar na máquina do DTEC

Só duas coisas precisam estar instaladas no servidor:

1. **Git** — pra baixar o código.
   - Windows: https://git-scm.com/download/win
   - Linux: `sudo apt install git` (Debian/Ubuntu) ou equivalente da distro
2. **Docker Desktop** (Windows) **ou Docker Engine + Docker Compose plugin** (Linux)
   - Windows: https://www.docker.com/products/docker-desktop/
   - Linux: https://docs.docker.com/engine/install/ (siga o guia da distro específica;
     depois instale também o plugin `docker-compose-plugin`)

Não precisa instalar Node.js, Angular, Postgres nem nada além disso separadamente —
tudo isso já vem embutido dentro dos containers Docker, é baixado automaticamente no
primeiro `docker compose up` (inclusive o código do frontend, buscado do outro
repositório nessa hora).

**Verifique se deu certo** rodando no terminal do servidor:
```
git --version
docker --version
docker compose version
```
Os três precisam responder com um número de versão (não erro de comando não
encontrado).

---

## 2. Passo a passo pra colocar no ar

### 2.1. Baixar o código
Só este repositório (o backend) — o frontend é buscado sozinho no próximo passo.
```
git clone https://github.com/yLucasG/RepositorioPMPE-backend.git
cd RepositorioPMPE-backend
```

### 2.2. Configurar as variáveis de ambiente
```
cp .env.docker.example .env
```
Edite o arquivo `.env` que acabou de ser criado e preencha:
- `POSTGRES_PASSWORD` — invente uma senha forte qualquer (fica só nesse arquivo, não
  precisa decorar)
- `JWT_SECRET` — uma string aleatória longa. Gere uma com:
  ```
  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
  ```
  (se não tiver Node instalado na hora de gerar isso, pode usar qualquer gerador de
  senha forte de 40+ caracteres)
- `GEMINI_API_KEY` — **opcional**. Só preencha se quiserem manter a extração
  automática de dados por IA. Deixando em branco, o sistema funciona normal, só que
  o cadastro de trabalhos precisa ser preenchido manualmente.
- `APP_PORT` — porta em que o site vai responder (padrão `3000`, pode deixar)
- `FRONTEND_REPO` / `FRONTEND_REF` — deixe comentado/em branco pra usar o repositório
  e a branch oficiais do frontend. Só preencha se quiserem apontar pra um fork ou
  branch diferente.
- `LDAP_API_URL` — deixe comentado/em branco pra usar o endpoint oficial da PM (já
  configurado por padrão). Login é sempre pela credencial institucional da PM — ver
  [`api/auth-ldap-pm.ts`](api/auth-ldap-pm.ts) pros detalhes.

### 2.3. Subir tudo
```
docker compose up -d --build
```
Isso clona e builda o frontend, builda a imagem do backend (primeira vez demora
alguns minutos) e sobe dois containers: o banco Postgres e a aplicação. Na primeira
subida, o banco já nasce com as tabelas criadas automaticamente (não precisa rodar
nenhum comando de migração à parte).

Acompanhe se subiu certo com:
```
docker compose logs -f app
```
Deve aparecer `Servidor rodando em http://localhost:3000`. Ctrl+C só sai do
acompanhamento dos logs, não derruba o container.

### 2.4. Acessar
Abra `http://ENDERECO_DO_SERVIDOR:3000` no navegador (ou `http://localhost:3000` se
estiver testando na própria máquina do servidor). O login admin fica em
`/admin/login` — não existe tela de cadastro nem senha própria desta aplicação:
qualquer credencial institucional válida da PM já entra como admin (ver
[`api/auth-ldap-pm.ts`](api/auth-ldap-pm.ts) pros detalhes e limitações dessa
integração — inclusive o fato de não ter restrição por Sistema/Perfil ainda, então
qualquer efetivo com login ativo na PM consegue editar o acervo).

---

## 3. Deixando o site acessível pela internet (link externo, com HTTPS)

Por padrão (passos 2.1 a 2.5) o site só responde dentro da rede interna do DTEC, por
IP. Pra ter um link público de verdade, precisa de duas coisas que **só o time de
TI/rede do DTEC consegue liberar** — não dá pra fazer isso só rodando comandos nesta
máquina:

1. **Um domínio (ou subdomínio) com DNS apontando pro IP público do DTEC.**
   Ex: `repositorio.pmpe.gov.br` → registro DNS tipo A apontando pro IP público da
   instituição.
2. **Portas 80 e 443 liberadas no firewall e encaminhadas (port forward)** do IP
   público até o IP interno desta máquina especificamente.

**Pergunte isso pro pessoal de TI do DTEC assim que chegar.** Sem essas duas coisas
prontas, o passo abaixo não funciona (e não tem nada que eu possa fazer daqui pra
resolver isso — é decisão e execução da rede deles).

Depois que tiver o domínio e as portas confirmadas, o projeto já vem pronto com um
proxy (Caddy) que emite e renova o certificado HTTPS sozinho (Let's Encrypt), sem
precisar configurar nada manualmente:

```
# edite o .env e preencha:
DOMAIN=repositorio.pmpe.gov.br

# suba com o profile "public" (o normal, docker compose up -d, não inclui isso)
docker compose --profile public up -d
```

Acompanhe se o certificado saiu certo:
```
docker compose logs -f caddy
```
Se aparecer erro tipo "connection refused" ou "timeout" no log do Caddy, quase
sempre é a porta 80 ainda não estar de fato acessível da internet (o Let's Encrypt
precisa conseguir bater nela de fora pra confirmar que o domínio é seu) — confirma
com o time de rede que o encaminhamento está mesmo funcionando (dá pra testar de um
celular na rede 4G, fora da rede do DTEC: `http://SEU_DOMINIO` precisa responder
alguma coisa, mesmo que seja erro do Caddy, não "não foi possível conectar").

Depois de funcionar, o site fica em `https://SEU_DOMINIO` — pode manter também o
acesso interno por `http://IP_DA_MAQUINA:3000` em paralelo, os dois convivem sem
problema (é a mesma aplicação, só duas portas de entrada diferentes).

---

## 4. Rotina de backup

Os dados que importam são só dois volumes Docker: o do Postgres (`db_data`) e o dos
PDFs (`uploads_data`).

**Backup do banco:**
```
docker compose exec db pg_dump -U repositorio repositorio > backup-$(date +%Y%m%d).sql
```

**Backup dos PDFs:** o volume `uploads_data` fica gerenciado pelo Docker. Se
preferirem um caminho de disco real e visível (mais fácil de incluir na rotina de
backup existente do DTEC), troquem no `docker-compose.yml` a linha:
```yaml
    volumes:
      - uploads_data:/app/uploads
```
por um bind mount, por exemplo:
```yaml
    volumes:
      - ./dados/uploads:/app/uploads
```
e rodem `docker compose up -d` de novo pra aplicar. Os PDFs passam a ficar
diretamente em `./dados/uploads` no disco do servidor.

---

## 5. Atualizando o sistema no futuro

```
git pull
docker compose up -d --build
```
Isso atualiza o backend (deste `git pull`) **e** busca a versão mais recente do
frontend de novo automaticamente (o `--build` refaz a etapa que clona e builda o
frontend, mesmo que só o frontend tenha mudado e este repositório não). O banco não
é afetado (o volume persiste); só o código da aplicação é reconstruído.

## 6. Se algo der errado na primeira subida

Rode `docker compose logs app` (ou `docker compose logs db`) e me manda a saída —
consigo diagnosticar a partir do erro exato.

---

## 7. Instalação nativa (sem Docker) — Node e Postgres já existentes no servidor

Caminho pra quem já tem Node.js e PostgreSQL rodando direto na máquina (sem
container) e quer manter o site do mesmo jeito. É a mesma aplicação da seção 1: o
código não tem nada específico de Docker — o Postgres é acessado por uma
`DATABASE_URL` comum e os PDFs são salvos numa pasta comum do disco. Diferente do
caminho com Docker, aqui é preciso clonar e buildar **os dois repositórios**
manualmente (o Dockerfile é quem automatiza isso no outro caminho).

### 7.1. Pré-requisitos no servidor
- **Node.js 22 ou superior** (`node --version` pra conferir)
- **PostgreSQL 14 ou superior**, já rodando, com um banco e um usuário criados pra
  essa aplicação (peça pro time de banco do DTEC criar, ou crie com `createdb` /
  `psql` se você tiver acesso de administrador do Postgres)
- **Git**

### 7.2. Baixar e buildar o frontend primeiro
```
git clone https://github.com/yLucasG/RepositorioPMPE-frontend.git
cd RepositorioPMPE-frontend
npm install
npm run build
cd ..
```
Isso gera `RepositorioPMPE-frontend/dist/repositorio-angular/browser` — vamos apontar
o backend pra essa pasta no passo 7.4.

### 7.3. Baixar o backend (este repositório)
```
git clone https://github.com/yLucasG/RepositorioPMPE-backend.git
cd RepositorioPMPE-backend
```

### 7.4. Configurar variáveis de ambiente
Crie um arquivo `.env` na raiz do projeto (mesma pasta do `package.json`) com:
```
DATABASE_URL=postgresql://USUARIO:SENHA@localhost:5432/NOME_DO_BANCO
JWT_SECRET=
UPLOADS_DIR=./uploads
GEMINI_API_KEY=
ANGULAR_DIST=../RepositorioPMPE-frontend/dist/repositorio-angular/browser
PORT=3000
```
- `DATABASE_URL` — string de conexão do Postgres que o DTEC já administra (troque
  usuário, senha, host, porta e nome do banco pelos deles).
- `JWT_SECRET` — string aleatória longa, gere com:
  ```
  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
  ```
- `UPLOADS_DIR` — pasta onde os PDFs ficam salvos. Pode deixar `./uploads` (cria
  relativa à pasta do projeto) ou apontar pra um caminho fixo do servidor, ex.:
  `/dados/repositorio/uploads` (Linux) ou `D:\Repositorio\uploads` (Windows).
- `GEMINI_API_KEY` — opcional, igual à instalação com Docker.
- `ANGULAR_DIST` — caminho (relativo ou absoluto) pra pasta buildada do frontend, do
  passo 7.2. Se os dois repositórios ficarem lado a lado (mesma pasta pai), o valor
  do exemplo acima já funciona; senão, use um caminho absoluto.

### 7.5. Instalar dependências e criar as tabelas
```
npm ci
npx prisma generate
```
O `npm ci` já roda `prisma generate` sozinho (script `postinstall`), mas em alguns
ambientes Windows esse `prisma generate` automático sai incompleto (dá erro de
compilação mais adiante, tipo `Module has no exported member 'PrismaClient'`) — rodar
`npx prisma generate` de novo, manualmente, evita isso sem custo nenhum. Em seguida,
crie as tabelas no banco que o DTEC apontou em `DATABASE_URL` (só precisa rodar uma
vez):
```
psql "$DATABASE_URL" -f prisma/schema_completo.sql
```
No Windows (PowerShell), se `psql` estiver no PATH:
```
psql $env:DATABASE_URL -f prisma\schema_completo.sql
```

### 7.6. Build do backend
```
npm run build
```
Gera a API compilada em `dist-server/`.

### 7.7. Testar manualmente antes de deixar permanente
```
npm start
```
Deve aparecer `Servidor rodando em http://localhost:3000`. Acesse
`http://localhost:3000` (ou o IP do servidor) pra conferir — a página inicial do
Angular deve carregar normal (é o backend servindo o build do passo 7.2). Ctrl+C
encerra — isso é só o teste, o passo seguinte deixa isso rodando de verdade em
segundo plano.

### 7.8. Deixar o processo no ar permanentemente

**Linux (systemd)** — crie `/etc/systemd/system/repositorio-dtec.service`:
```ini
[Unit]
Description=Repositório Acadêmico DTEC/PMPE
After=network.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/caminho/completo/para/RepositorioPMPE-backend
ExecStart=/usr/bin/node dist-server/server.js
Restart=on-failure
User=SEU_USUARIO_DE_SERVICO

[Install]
WantedBy=multi-user.target
```
O `.env` do passo 7.4 é lido automaticamente (a aplicação usa `dotenv`), desde que
fique na `WorkingDirectory` configurada acima. Depois:
```
sudo systemctl daemon-reload
sudo systemctl enable --now repositorio-dtec
sudo systemctl status repositorio-dtec
```

**Windows Server (via NSSM)** — baixe o [NSSM](https://nssm.cc/), depois:
```
nssm install RepositorioDTEC "C:\Program Files\nodejs\node.exe" "dist-server\server.js"
nssm set RepositorioDTEC AppDirectory "C:\caminho\completo\para\RepositorioPMPE-backend"
nssm start RepositorioDTEC
```
O `.env` também é lido automaticamente, desde que fique dentro de `AppDirectory`.
Confira o status pelo `services.msc` (nome "RepositorioDTEC").

Acessar: não existe tela de cadastro nem senha própria — qualquer credencial
institucional válida da PM já entra como admin em `/admin/login` (ver
[`api/auth-ldap-pm.ts`](api/auth-ldap-pm.ts) pros detalhes e limitações).

### 7.9. HTTPS / domínio público
Sem Docker, o Caddy da seção 3 não se aplica — use o que o DTEC já tiver de proxy
reverso (nginx, IIS, outro Caddy instalado direto no SO) apontando pra
`http://localhost:3000`, com as mesmas duas dependências da seção 3: domínio com DNS
apontando pro IP público e portas 80/443 liberadas/encaminhadas pelo time de rede.

### 7.10. Atualizando o sistema no futuro
Backend:
```
git pull
npm ci
npm run build
```
Frontend (repositório separado):
```
cd ../RepositorioPMPE-frontend
git pull
npm install
npm run build
```
Depois reinicie o serviço do backend (`sudo systemctl restart repositorio-dtec` no
Linux, ou `nssm restart RepositorioDTEC` no Windows) — ele já serve a versão nova do
frontend no próximo request, não precisa reiniciar nada do lado do frontend (não é
um processo à parte). O banco não é afetado.

### 7.11. Backup
**Banco:** `pg_dump -U USUARIO NOME_DO_BANCO > backup-$(date +%Y%m%d).sql` (peça pro
time de banco do DTEC incluir isso na rotina de backup deles, se já tiverem uma).
**PDFs:** é só a pasta apontada em `UPLOADS_DIR` — inclua na rotina de backup normal
de arquivos do servidor.
