// Entrypoint usado só na instalação self-hosted (Docker/DTEC). Na Vercel, o
// entrypoint é api/index.ts, que exporta `app` direto pro runtime serverless
// sem nada disso — este arquivo nunca roda lá.
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import app from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env["PORT"]) || 3000;
const ANGULAR_DIST = path.resolve(
  process.env["ANGULAR_DIST"] || path.join(__dirname, "../dist/repositorio-angular/browser")
);

// CSP do frontend (equivalente ao configurado em vercel.json pra produção na nuvem).
// As rotas /api já têm seu próprio CSP restritivo, aplicado dentro de app.ts.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  next();
});

app.use(express.static(ANGULAR_DIST));

// Fallback de SPA: qualquer rota que não seja /api nem /uploads devolve o index.html,
// pro Angular Router assumir a navegação no cliente.
app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
  res.sendFile(path.join(ANGULAR_DIST, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
