// Integração com o sistema de autenticação que a PM já usa em outros sistemas
// (ex.: https://portalpmpe.sistemas.pm.pe.gov.br/login).
//
// CONFIRMADO com o Richard (DTEC) + teste real em 03/09/2026 (login de verdade,
// feito manualmente pelo próprio usuário no seu terminal, fora desta sessão):
//
//   POST https://ldap.api.pm.pe.gov.br/api/
//   Headers: Authorization: Basic base64(usuario:senha)   (a credencial da PESSOA)
//            Content-Type: application/json
//   Body:    { "usuario": "...", "senha": "..." }          (mesma credencial, nos dois lugares)
//
// Resposta de sucesso (200), formato real confirmado:
//   {
//     "status": "success",
//     "data": [
//       ["Login: <id>", "Perfil: <perfil>", "Sistema: <sigla>", "Status: ATIVO",
//        "Cargo: <cargo>", "Matricula: <matricula>", "Nome de Guerra: <nome>",
//        "Ome Disposição: <unidade>", "Id Ome Disposição: <id>", "Secao: null",
//        "Email: <email>@pm.pe.gov.br"],
//       ... // uma linha por SISTEMA em que a pessoa tem um perfil ativo na PM
//     ]
//   }
// Não é uma lista de campos JSON normais — cada linha é um array de strings no
// formato "Campo: valor", que a gente precisa parsear (função abaixo). Os dados de
// identidade (matrícula, nome de guerra, e-mail, cargo, unidade) se repetem em
// todas as linhas — só muda Sistema/Perfil por linha.
//
// CONTROLE DE ACESSO AO PAINEL: o DTEC cadastrou o Repositório Acadêmico como um
// "Sistema" próprio na identidade da PM, com a sigla REPOSITORIO. A partir daí,
// só entra no painel admin quem tem uma linha com `Sistema: REPOSITORIO` e
// `Status: ATIVO` nessa resposta — ou seja, quem o DTEC cadastrou nesse sistema.
// Uma credencial válida da PM que não esteja no sistema REPOSITORIO autentica
// (a senha confere), mas NÃO tem acesso ao painel. Ver `temAcessoAoRepositorio`
// abaixo e o uso em app.ts. A sigla é configurável por LDAP_SISTEMA_REPOSITORIO
// (padrão "REPOSITORIO") caso a PM mude o nome cadastrado.
//
// ⚠️ Ainda não testado/confirmado: o formato de uma resposta de ERRO (senha errada).
// O código abaixo trata como falha qualquer resposta que não seja HTTP ok E
// `status === "success"` com pelo menos uma linha em `data` — o que deve cobrir
// tanto um 401/403 quanto um eventual 200 com `status` diferente de "success".

/** Um "Sistema" da identidade da PM em que a pessoa tem um perfil (uma linha de `data`). */
export interface SistemaPm {
  sistema?: string;
  perfil?: string;
  status?: string;
}

export interface ResultadoAutenticacaoPm {
  ok: boolean;
  /** Dados de identidade da pessoa autenticada (vindos da 1ª linha de `data`). */
  identidade?: {
    matricula?: string;
    nomeDeGuerra?: string;
    email?: string;
    cargo?: string;
    unidade?: string;
    status?: string;
  };
  /** Uma entrada por Sistema/Perfil que a pessoa tem na PM (todas as linhas de `data`). */
  sistemas?: SistemaPm[];
}

const LDAP_API_URL = process.env["LDAP_API_URL"] || "https://ldap.api.pm.pe.gov.br/api/";

/** Sigla do "Sistema" cadastrado pelo DTEC na identidade da PM para este app. */
const SISTEMA_REPOSITORIO = (process.env["LDAP_SISTEMA_REPOSITORIO"] || "REPOSITORIO").trim().toUpperCase();

/** Converte "Campo: valor" em ["Campo", "valor"]. */
function parseCampo(linha: string): [string, string] {
  const idx = linha.indexOf(":");
  if (idx === -1) return [linha.trim(), ""];
  return [linha.slice(0, idx).trim(), linha.slice(idx + 1).trim()];
}

/** Converte uma linha de `data` (array de "Campo: valor") num objeto { Campo: valor }. */
function parseLinha(linha: unknown): Record<string, string> | null {
  if (!Array.isArray(linha)) return null;
  return Object.fromEntries(linha.map((l) => parseCampo(String(l))));
}

/**
 * Autentica usuário/senha contra o sistema de login que a PM já usa.
 * NÃO valida senha localmente — quem confirma a credencial é a API da PM.
 * Só confirma que a credencial é válida; o acesso ao painel é decidido depois
 * por `temAcessoAoRepositorio`.
 */
export async function autenticarNaPm(usuario: string, senha: string): Promise<ResultadoAutenticacaoPm> {
  const authHeader = "Basic " + Buffer.from(`${usuario}:${senha}`).toString("base64");

  let resposta: Response;
  try {
    resposta = await fetch(LDAP_API_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ usuario, senha }),
    });
  } catch (error) {
    console.error("Erro ao contatar a API de autenticação da PM:", error);
    return { ok: false };
  }

  if (!resposta.ok) {
    return { ok: false };
  }

  const corpo = await resposta.json().catch(() => undefined);
  if (corpo?.status !== "success" || !Array.isArray(corpo?.data) || corpo.data.length === 0) {
    return { ok: false };
  }

  const data: unknown[] = corpo.data;
  const linhas: Record<string, string>[] = data
    .map(parseLinha)
    .filter((campos): campos is Record<string, string> => campos !== null);

  const sistemas: SistemaPm[] = linhas.map((campos) => ({
    sistema: campos["Sistema"],
    perfil: campos["Perfil"],
    status: campos["Status"],
  }));

  const primeiraLinha = linhas[0];
  if (!primeiraLinha) {
    return { ok: true, sistemas };
  }

  return {
    ok: true,
    identidade: {
      matricula: primeiraLinha["Matricula"],
      nomeDeGuerra: primeiraLinha["Nome de Guerra"],
      email: primeiraLinha["Email"],
      cargo: primeiraLinha["Cargo"],
      unidade: primeiraLinha["Ome Disposição"],
      status: primeiraLinha["Status"],
    },
    sistemas,
  };
}

/**
 * Retorna true se a pessoa autenticada tem um perfil ATIVO no "Sistema"
 * REPOSITORIO da identidade da PM — ou seja, foi cadastrada pelo DTEC para
 * acessar o painel administrativo deste app.
 *
 * Uma credencial válida da PM que não esteja nesse sistema retorna false:
 * autentica, mas não entra no painel.
 */
export function temAcessoAoRepositorio(resultado: ResultadoAutenticacaoPm): boolean {
  if (!resultado.ok || !resultado.sistemas) return false;
  return resultado.sistemas.some(
    (s) =>
      (s.sistema ?? "").trim().toUpperCase() === SISTEMA_REPOSITORIO &&
      (s.status ?? "").trim().toUpperCase() === "ATIVO",
  );
}
