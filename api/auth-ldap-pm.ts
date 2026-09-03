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
// todas as linhas — só muda Sistema/Perfil por linha. "Repositório Acadêmico"
// ainda não aparece nessa lista (não estamos cadastrados como um "Sistema" na PM) —
// por enquanto, qualquer credencial válida aqui já é suficiente pra virar admin
// deste app (ver app.ts): não tem restrição por Sistema/Perfil ainda, é uma etapa
// temporária até o DTEC cadastrar o Repositório Acadêmico como Sistema próprio.
//
// ⚠️ Ainda não testado/confirmado: o formato de uma resposta de ERRO (senha errada).
// O código abaixo trata como falha qualquer resposta que não seja HTTP ok E
// `status === "success"` com pelo menos uma linha em `data` — o que deve cobrir
// tanto um 401/403 quanto um eventual 200 com `status` diferente de "success".

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
}

const LDAP_API_URL = process.env["LDAP_API_URL"] || "https://ldap.api.pm.pe.gov.br/api/";

/** Converte "Campo: valor" em ["Campo", "valor"]. */
function parseCampo(linha: string): [string, string] {
  const idx = linha.indexOf(":");
  if (idx === -1) return [linha.trim(), ""];
  return [linha.slice(0, idx).trim(), linha.slice(idx + 1).trim()];
}

/**
 * Autentica usuário/senha contra o sistema de login que a PM já usa.
 * NÃO valida senha localmente — quem confirma a credencial é a API da PM.
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

  const primeiraLinha: unknown = corpo.data[0];
  if (!Array.isArray(primeiraLinha)) {
    return { ok: true };
  }
  const campos = Object.fromEntries(primeiraLinha.map((l) => parseCampo(String(l))));

  return {
    ok: true,
    identidade: {
      matricula: campos["Matricula"],
      nomeDeGuerra: campos["Nome de Guerra"],
      email: campos["Email"],
      cargo: campos["Cargo"],
      unidade: campos["Ome Disposição"],
      status: campos["Status"],
    },
  };
}
