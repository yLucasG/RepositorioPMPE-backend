import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { GoogleGenerativeAI, GoogleGenerativeAIFetchError, SchemaType, type ObjectSchema } from "@google/generative-ai";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { autenticarNaPm } from "./auth-ldap-pm.js";

// Retorna sempre `string` (nunca `string | undefined`), então o TypeScript não
// reclama quando a variável é usada dentro de closures (handlers de rota) definidas
// mais abaixo no arquivo.
function exigirVariavelDeAmbiente(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    console.error(`❌ ERRO GRAVE: ${nome} está faltando!`);
    throw new Error(`${nome} não configurada`);
  }
  return valor;
}

const connectionString = exigirVariavelDeAmbiente("DATABASE_URL");
const jwtSecret = exigirVariavelDeAmbiente("JWT_SECRET");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const geminiApiKey = process.env['GEMINI_API_KEY'];
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;

// "local" (padrão) = senha própria, com hash na tabela Admin (como já funciona hoje).
// "ldap-pm" = valida a credencial contra o sistema de login da PM (ver
// api/auth-ldap-pm.ts), testado e funcionando em 03/09/2026. ⚠️ Nesse modo,
// QUALQUER credencial válida da PM vira admin (sem whitelist) — combinado como
// etapa temporária até o DTEC restringir por Sistema/Perfil próprio.
const authMode = process.env['AUTH_MODE'] === "ldap-pm" ? "ldap-pm" : "local";

// PDFs salvos em disco, no próprio servidor (sem depender de nenhum serviço externo).
const UPLOADS_DIR = path.resolve(process.env['UPLOADS_DIR'] || "./uploads");
const NOME_ARQUIVO_LOCAL_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

async function salvarArquivoLocal(buffer: Buffer): Promise<string> {
  const nomeArquivo = `${crypto.randomUUID()}.pdf`;
  await fs.promises.writeFile(path.join(UPLOADS_DIR, nomeArquivo), buffer);
  return `/uploads/${nomeArquivo}`;
}

async function removerArquivoDoStorage(urlArquivo: string | null | undefined): Promise<void> {
  if (!urlArquivo || !urlArquivo.startsWith("/uploads/")) return;
  const nomeArquivo = urlArquivo.slice("/uploads/".length);
  if (!NOME_ARQUIVO_LOCAL_REGEX.test(nomeArquivo)) return;
  await fs.promises.unlink(path.join(UPLOADS_DIR, nomeArquivo)).catch((error) => {
    if (error?.code !== "ENOENT") console.error("Erro ao remover arquivo local:", error);
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === "application/pdf");
  },
});

// "http://localhost:4200" cobre o `ng serve` local: o proxy (proxy.conf.json)
// repassa /api/* pro backend em :3000 mas preserva o Origin original do navegador.
const allowedOrigins = [
  "http://localhost:4200",
  "https://repositorio-apmp.vercel.app",
];

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Não autenticado." });
    return;
  }
  try {
    jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
    next();
  } catch {
    res.status(401).json({ error: "Sessão inválida ou expirada." });
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Tente novamente mais tarde." },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições. Tente novamente mais tarde." },
});

const LINHAS_PESQUISA_VALIDAS = [
  "1. Cenários Estratégicos, Cultura e Doutrina PM",
  "2. Políticas Públicas e Gestão de Segurança Pública",
  "3. Estratégias de Policiamento e Prevenção à Criminalidade",
  "4. Violência Social e Criminalidade",
  "5. Educação Policial, Ensino e Instrução Policial Militar",
  "6. Polícia, Direitos Humanos e Cidadania",
  "7. Administração Estratégica",
  "8. Gestão de Pessoas, Logística e Finanças Públicas",
  "9. Saúde e Qualidade de Vida do Policial Militar",
  "10. Inovação e Tecnologias em Segurança Pública",
];

const TIPOS_TRABALHO_VALIDOS = ["TCC", "Artigo", "Monografia", "Dissertação", "Tese"];

const TAMANHO_MAXIMO_TITULO = 200;
const TAMANHO_MAXIMO_AUTOR = 300;
const TAMANHO_MAXIMO_RESUMO = 5000;
const TAMANHO_MAXIMO_REFERENCIA = 1000;
const MAXIMO_REFERENCIAS = 200;

// Força a IA a devolver exatamente os mesmos valores aceitos por validarDadosTrabalho,
// em vez de confiar que o texto livre do prompt seja seguido à risca.
const EXTRACAO_IA_SCHEMA: ObjectSchema = {
  type: SchemaType.OBJECT,
  properties: {
    titulo: { type: SchemaType.STRING, description: "Título completo do trabalho" },
    autores: { type: SchemaType.STRING, description: "Todos os autores separados por vírgula" },
    resumo: { type: SchemaType.STRING, description: "O resumo/abstract completo do trabalho" },
    referencias: {
      type: SchemaType.STRING,
      description: "Todas as referências bibliográficas, cada uma em uma linha separada por quebra de linha",
    },
    tema: { type: SchemaType.STRING, format: "enum", enum: LINHAS_PESQUISA_VALIDAS },
    tipo: { type: SchemaType.STRING, format: "enum", enum: TIPOS_TRABALHO_VALIDOS },
    ano: { type: SchemaType.INTEGER, description: "Ano de publicação" },
  },
  required: ["titulo", "autores", "resumo", "referencias", "tema", "tipo", "ano"],
};

const ERROS_IA_RETRYAVEIS = new Set([429, 500, 503]);

// Tenta novamente em caso de rate limit (free tier) ou instabilidade momentânea do Gemini,
// com backoff exponencial, em vez de falhar de cara e derrubar o arquivo do lote.
async function gerarConteudoComRetry<T>(chamada: () => Promise<T>, tentativas = 3): Promise<T> {
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      return await chamada();
    } catch (error) {
      const ehRetryavel = error instanceof GoogleGenerativeAIFetchError && ERROS_IA_RETRYAVEIS.has(error.status ?? 0);
      if (!ehRetryavel || tentativa === tentativas) throw error;
      const esperaMs = 2 ** tentativa * 1000;
      console.warn(`Gemini falhou (tentativa ${tentativa}/${tentativas}, status ${(error as GoogleGenerativeAIFetchError).status}), tentando novamente em ${esperaMs}ms`);
      await new Promise(resolve => setTimeout(resolve, esperaMs));
    }
  }
  throw new Error("Falha ao gerar conteúdo com IA após múltiplas tentativas");
}

// Remove caracteres de controle (incluindo byte nulo) e tags HTML de um texto livre.
function sanitizarTexto(valor: string): string {
  return String(valor)
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function validarDadosTrabalho(body: any): string | null {
  if (!body.titulo || !String(body.titulo).trim()) return "Título é obrigatório.";
  if (String(body.titulo).length > TAMANHO_MAXIMO_TITULO) return `Título deve ter no máximo ${TAMANHO_MAXIMO_TITULO} caracteres.`;
  if (!body.autor || !String(body.autor).trim()) return "Autor é obrigatório.";
  if (String(body.autor).length > TAMANHO_MAXIMO_AUTOR) return `Autor deve ter no máximo ${TAMANHO_MAXIMO_AUTOR} caracteres.`;
  if (!body.resumo || !String(body.resumo).trim()) return "Resumo é obrigatório.";
  if (String(body.resumo).length > TAMANHO_MAXIMO_RESUMO) return `Resumo deve ter no máximo ${TAMANHO_MAXIMO_RESUMO} caracteres.`;
  if (!LINHAS_PESQUISA_VALIDAS.includes(body.categoria)) return "Linha de pesquisa inválida.";
  if (body.tipo && !TIPOS_TRABALHO_VALIDOS.includes(body.tipo)) return "Tipo de trabalho inválido.";
  const ano = parseInt(body.ano, 10);
  if (!Number.isInteger(ano) || ano < 1900 || ano > 2100) return "Ano inválido.";
  if (body.url_arquivo && !String(body.url_arquivo).startsWith("/uploads/")) return "URL de arquivo inválida.";
  if (body.referencias) {
    const lista: string[] = Array.isArray(body.referencias)
      ? body.referencias
      : String(body.referencias).split("\n").filter((r: string) => r.trim());
    if (lista.length > MAXIMO_REFERENCIAS) return `No máximo ${MAXIMO_REFERENCIAS} referências.`;
    if (lista.some((r) => String(r).length > TAMANHO_MAXIMO_REFERENCIA)) {
      return `Cada referência deve ter no máximo ${TAMANHO_MAXIMO_REFERENCIA} caracteres.`;
    }
  }
  return null;
}

const app = express();
app.set("trust proxy", 1);
// No self-hosted (server.ts) e na Vercel, frontend e API são sempre a mesma origem
// (o próprio Express serve os dois, ou o mesmo domínio da Vercel) — então requisições
// same-origin são sempre liberadas, não importa qual IP/domínio o DTEC use pra
// acessar o site. allowedOrigins cobre só o caso de origem diferente de propósito
// (dev local com `ng serve` em :4200 chamando a API em :3000, e a Vercel).
app.use((req, res, next) => {
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      let mesmaOrigem = false;
      try {
        mesmaOrigem = new URL(origin).host === req.headers.host;
      } catch {
        mesmaOrigem = false;
      }
      if (mesmaOrigem || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
  })(req, res, next);
});
app.use(express.json());
// Escopado em /api: na Vercel só rotas /api passam por este app mesmo (estático é
// servido à parte), mas no self-hosted (server.ts) este mesmo app também serve o
// build do Angular, que precisa de um CSP bem menos restritivo que este.
app.use("/api", (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  next();
});
app.use("/api", apiLimiter);

// Serve os PDFs salvos em disco. express.static já normaliza o caminho e recusa
// ".."/traversal por conta própria.
app.use("/uploads", express.static(UPLOADS_DIR, { index: false, dotfiles: "deny", maxAge: "1y", immutable: true }));

// ============ PUBLIC ROUTES ============

// Lista todos os trabalhos com paginação
app.get("/api/trabalhos", async (req, res) => {
  try {
    const limit = Number(req.query['limit']) || 10;
    const page = Number(req.query['page']) || 1;
    const skip = (page - 1) * limit;

    const [trabalhos, total] = await Promise.all([
      prisma.trabalhoAcademico.findMany({
        orderBy: { ano: "desc" },
        skip,
        take: limit,
      }),
      prisma.trabalhoAcademico.count(),
    ]);

    res.json({
      data: trabalhos,
      meta: {
        totalItems: total,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar trabalhos:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// Evita que a mesma origem infle o contador de visualizações repetindo a requisição
// (ex.: script em loop, <img> apontando pro endpoint). Persistido no banco (tabela
// VisualizacaoTrabalho) em vez de memória, pra funcionar entre múltiplas instâncias
// serverless. O IP nunca é armazenado em texto puro, só o HMAC dele.
const JANELA_VISUALIZACAO_MS = 12 * 60 * 60 * 1000;
const RETENCAO_VISUALIZACAO_MS = 90 * 24 * 60 * 60 * 1000;

function hashIp(ip: string): string {
  return createHmac("sha256", jwtSecret).update(`view:${ip}`).digest("hex");
}

async function podeContarVisualizacao(ip: string, trabalhoId: string): Promise<boolean> {
  const ipHash = hashIp(ip);
  const agora = new Date();
  const limite = new Date(agora.getTime() - JANELA_VISUALIZACAO_MS);

  const registro = await prisma.visualizacaoTrabalho.findUnique({
    where: { trabalhoId_ipHash: { trabalhoId, ipHash } },
  });

  if (registro && registro.visualizadoEm > limite) {
    return false;
  }

  await prisma.visualizacaoTrabalho.upsert({
    where: { trabalhoId_ipHash: { trabalhoId, ipHash } },
    create: { trabalhoId, ipHash, visualizadoEm: agora },
    update: { visualizadoEm: agora },
  });

  // Limpeza esporádica (~1% das requisições) pra tabela não crescer indefinidamente.
  if (Math.random() < 0.01) {
    const expiradoEm = new Date(agora.getTime() - RETENCAO_VISUALIZACAO_MS);
    prisma.visualizacaoTrabalho
      .deleteMany({ where: { visualizadoEm: { lt: expiradoEm } } })
      .catch((err) => console.error("Erro na limpeza de visualizações antigas:", err));
  }

  return true;
}

// Busca por ID (incrementa visualizações, no máximo uma vez por IP a cada 12h)
app.get("/api/trabalhos/:id", async (req, res) => {
  try {
    const id = req.params['id'] as string;
    const deveContar = await podeContarVisualizacao(req.ip ?? "desconhecido", id);

    const trabalho = deveContar
      ? await prisma.trabalhoAcademico.update({
          where: { id },
          data: { visualizacoes: { increment: 1 } },
        })
      : await prisma.trabalhoAcademico.findUniqueOrThrow({ where: { id } });

    res.json(trabalho);
  } catch (error) {
    console.error("Erro ao buscar trabalho:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// Registrar download
app.post("/api/trabalhos/:id/download", async (req, res) => {
  try {
    await prisma.trabalhoAcademico.update({
      where: { id: req.params['id'] },
      data: { downloads: { increment: 1 } },
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Erro ao registrar download:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ============ ADMIN ROUTES ============

// Login
app.post("/api/admin/login", loginLimiter, async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    let admin;

    if (authMode === "ldap-pm") {
      // ⚠️ Sem whitelist por enquanto: QUALQUER credencial válida da PM entra como
      // admin (criação de trabalho, upload/exclusão de PDF, tudo). Combinado assim
      // como etapa temporária, até o DTEC cadastrar o Repositório Acadêmico como um
      // "Sistema" próprio na identidade da PM e a gente poder restringir por
      // Sistema/Perfil, como o Portal PMPE já faz com os outros sistemas deles.
      const resultado = await autenticarNaPm(usuario, senha);
      if (!resultado.ok) {
        res.status(401).json({ error: "Usuário ou senha inválidos." });
        return;
      }
      // Registra (ou reaproveita) o usuário localmente na primeira vez que ele
      // loga — só pra ter um id/registro nosso; senhaHash não é usada nesse modo,
      // quem confirma a senha é sempre a API da PM, nunca comparamos hash aqui.
      admin = await prisma.admin.upsert({
        where: { usuario },
        update: {},
        create: { usuario, senhaHash: "AUTENTICADO_VIA_LDAP_PM" },
      });
    } else {
      admin = await prisma.admin.findUnique({ where: { usuario } });
      if (!admin) {
        res.status(401).json({ error: "Usuário ou senha inválidos." });
        return;
      }
      const valid = await bcrypt.compare(senha, admin.senhaHash);
      if (!valid) {
        res.status(401).json({ error: "Usuário ou senha inválidos." });
        return;
      }
    }

    const token = jwt.sign({ sub: admin.id, usuario: admin.usuario }, jwtSecret, { algorithm: "HS256", expiresIn: "8h" });
    res.json({ success: true, token, user: { id: admin.id, usuario: admin.usuario } });
  } catch (error) {
    console.error("Erro no login:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// Upload do PDF: recebe o arquivo direto e salva em disco.
app.post("/api/admin/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Nenhum arquivo enviado" });
      return;
    }
    const url = await salvarArquivoLocal(req.file.buffer);
    res.json({ url });
  } catch (error) {
    console.error("Erro no upload:", error);
    res.status(500).json({ error: "Erro ao salvar arquivo" });
  }
});

// Stats para dashboard
app.get("/api/admin/stats", requireAuth, async (_req, res) => {
  try {
    const [total, stats] = await Promise.all([
      prisma.trabalhoAcademico.count(),
      prisma.trabalhoAcademico.aggregate({
        _sum: { visualizacoes: true, downloads: true },
      }),
    ]);
    res.json({
      totalTrabalhos: total,
      totalVisualizacoes: stats._sum.visualizacoes || 0,
      totalDownloads: stats._sum.downloads || 0,
    });
  } catch (error) {
    console.error("Erro ao buscar stats:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});

// Criar trabalho
app.post("/api/trabalhos", requireAuth, async (req, res) => {
  try {
    const { referencias, ano, categoria, tipo, url_arquivo } = req.body;
    const listaReferencias: string[] = (Array.isArray(referencias)
      ? referencias
      : referencias ? String(referencias).split("\n").filter((r: string) => r.trim()) : []
    ).map(sanitizarTexto).filter((r: string) => r);

    const dadosSanitizados = {
      titulo: sanitizarTexto(req.body.titulo || ""),
      autor: sanitizarTexto(req.body.autor || ""),
      resumo: sanitizarTexto(req.body.resumo || ""),
      referencias: listaReferencias,
      ano, categoria, tipo, url_arquivo,
    };

    const erroValidacao = validarDadosTrabalho(dadosSanitizados);
    if (erroValidacao) {
      res.status(400).json({ error: erroValidacao });
      return;
    }

    const trabalho = await prisma.trabalhoAcademico.create({
      data: {
        titulo: dadosSanitizados.titulo,
        autor: dadosSanitizados.autor,
        resumo: dadosSanitizados.resumo,
        referencias: dadosSanitizados.referencias,
        ano: parseInt(ano, 10),
        categoria,
        tipo: tipo || "",
        url_arquivo: url_arquivo || "",
      },
    });
    res.json(trabalho);
  } catch (error) {
    console.error("Erro ao criar trabalho:", error);
    res.status(500).json({ error: "Erro ao salvar trabalho" });
  }
});

// Atualizar trabalho
app.put("/api/trabalhos/:id", requireAuth, async (req, res) => {
  try {
    const { referencias, ano, categoria, tipo } = req.body;
    const listaReferencias: string[] = (Array.isArray(referencias)
      ? referencias
      : referencias ? String(referencias).split("\n").filter((r: string) => r.trim()) : []
    ).map(sanitizarTexto).filter((r: string) => r);

    const dadosSanitizados = {
      titulo: sanitizarTexto(req.body.titulo || ""),
      autor: sanitizarTexto(req.body.autor || ""),
      resumo: sanitizarTexto(req.body.resumo || ""),
      referencias: listaReferencias,
      ano, categoria, tipo,
    };

    const erroValidacao = validarDadosTrabalho(dadosSanitizados);
    if (erroValidacao) {
      res.status(400).json({ error: erroValidacao });
      return;
    }

    const trabalho = await prisma.trabalhoAcademico.update({
      where: { id: req.params['id'] as string },
      data: {
        titulo: dadosSanitizados.titulo,
        autor: dadosSanitizados.autor,
        resumo: dadosSanitizados.resumo,
        referencias: dadosSanitizados.referencias,
        ano: parseInt(ano, 10),
        categoria,
        tipo,
      },
    });
    res.json(trabalho);
  } catch (error) {
    console.error("Erro ao atualizar trabalho:", error);
    res.status(500).json({ error: "Erro ao atualizar trabalho" });
  }
});

// Deletar trabalho
app.delete("/api/trabalhos/:id", requireAuth, async (req, res) => {
  try {
    const trabalho = await prisma.trabalhoAcademico.delete({ where: { id: req.params['id'] as string } });
    await removerArquivoDoStorage(trabalho.url_arquivo);
    res.json({ success: true });
  } catch (error) {
    console.error("Erro ao deletar:", error);
    res.status(500).json({ error: "Erro ao deletar" });
  }
});

// Deletar em lote
app.post("/api/trabalhos/lote/delete", requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "IDs inválidos" });
      return;
    }
    const trabalhos = await prisma.trabalhoAcademico.findMany({
      where: { id: { in: ids } },
      select: { url_arquivo: true },
    });
    await prisma.trabalhoAcademico.deleteMany({
      where: { id: { in: ids } }
    });
    await Promise.all(trabalhos.map(t => removerArquivoDoStorage(t.url_arquivo)));
    res.json({ success: true });
  } catch (error) {
    console.error("Erro ao deletar em lote:", error);
    res.status(500).json({ error: "Erro ao deletar em lote" });
  }
});

// IA: Extrair dados do PDF com Gemini
app.post("/api/ia/extrair-dados", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!genAI) {
      res.status(500).json({ error: "GEMINI_API_KEY não configurada" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Nenhum arquivo enviado" });
      return;
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-3.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: EXTRACAO_IA_SCHEMA,
      },
    });
    const pdfBase64 = req.file.buffer.toString("base64");

    const prompt = `Analise este documento acadêmico (PDF) e extraia título, autores, resumo/abstract completo, referências bibliográficas (uma por linha), a linha de pesquisa mais adequada, o tipo de documento e o ano de publicação.`;

    const result = await gerarConteudoComRetry(() =>
      model.generateContent([
        { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
        prompt,
      ])
    );

    const responseText = result.response.text();
    let data: unknown;
    try {
      data = JSON.parse(responseText);
    } catch {
      res.status(500).json({ error: "IA não retornou JSON válido" });
      return;
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error("Erro na IA:", error);
    if (error instanceof GoogleGenerativeAIFetchError && error.status === 429) {
      res.status(429).json({ error: "Limite de requisições da IA atingido, tente novamente em instantes" });
      return;
    }
    res.status(500).json({ error: "Erro ao processar PDF com IA" });
  }
});

export default app;
