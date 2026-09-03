# Repositório Acadêmico — PMPE/DTEC — Backend 🏛️🛡️

> API + banco de dados + armazenamento de PDFs do sistema institucional de gestão da
> produção acadêmica da Polícia Militar de Pernambuco.

Este é o **backend**. O frontend (Angular) vive num repositório separado:
**[RepositorioPMPE-frontend](https://github.com/yLucasG/RepositorioPMPE-frontend)**.
Os dois são independentes (times diferentes podem mexer em cada um sem esbarrar no
outro), mas continuam sendo instalados e rodando juntos: o processo Node deste
repositório serve o build do frontend + a API, os dois pela mesma porta — a
instalação self-hosted continua sendo um único `docker compose up`, que já busca e
builda o frontend sozinho (ver Dockerfile).

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

## 🧱 O que tem aqui

- **API** ([`api/app.ts`](api/app.ts)) — rotas em `/api/*`: consulta pública do
  acervo, login/administração, upload e extração de dados de PDF por IA (Gemini,
  opcional). Detalhes de cada rota nos comentários do próprio arquivo.
- **Banco de dados** — PostgreSQL via Prisma ORM ([`prisma/schema.prisma`](prisma/schema.prisma)):
  `TrabalhoAcademico` (o acervo), `Admin` (usuários do painel) e
  `VisualizacaoTrabalho` (controle de contagem de visualizações).
- **Armazenamento de PDFs** — salvos em disco (pasta configurável via `UPLOADS_DIR`),
  sem depender de nenhum serviço externo de storage.
- **Autenticação institucional (opcional)** — [`api/auth-ldap-pm.ts`](api/auth-ldap-pm.ts):
  integração com o sistema de login que a PM já usa, atrás da variável `AUTH_MODE`
  (padrão `local`, sem afetar o login próprio da aplicação). Detalhes e limitações
  no topo do próprio arquivo.
- **Entrypoint self-hosted** ([`api/server.ts`](api/server.ts)) — processo Node
  contínuo que serve a API **e** o build estático do frontend (buildado a partir do
  outro repositório) na mesma porta.

## 🏢 Instalando no servidor do DTEC

Passo a passo completo (com e sem Docker, criação do primeiro admin, HTTPS, backup
e atualização) em **[DEPLOY_DTEC.md](DEPLOY_DTEC.md)**.

## 💻 Rodando localmente para desenvolvimento

Pra desenvolver só a API, sem precisar buildar o frontend toda hora:

```bash
npm install
```
(o `postinstall` já roda `prisma generate`)

Crie um `.env` na raiz:
```env
DATABASE_URL="postgresql://usuario:senha@host:porta/database"
JWT_SECRET="uma-string-aleatoria-longa"
GEMINI_API_KEY="sua-chave-opcional-do-gemini"
UPLOADS_DIR="./uploads"
```

Crie as tabelas (só na primeira vez):
```bash
npx prisma db execute --file ./prisma/schema_completo.sql
```

Build e execução:
```bash
npm run build
npm start
```

Se também quiser o frontend rodando com hot-reload apontando pra essa API local, veja
o README do [RepositorioPMPE-frontend](https://github.com/yLucasG/RepositorioPMPE-frontend)
— o `proxy.conf.json` de lá já está configurado pra `localhost:3000`.
