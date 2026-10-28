// Gera a curiosidade da semana com o Gemini e grava em curiosidade.json.
// Uso: GEMINI_API_KEY=... node scripts/gerar-curiosidade.mjs
import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { avaliarCandidato, diasDeAtraso, montarPrompt } from '../lib/curiosidade.js';

const MODELO = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const TENTATIVAS_HTTP = 3;
const ESPERA_MS = 1000;
const TENTATIVAS_FATO = 6;
const SAIDA = fileURLToPath(new URL('../curiosidade.json', import.meta.url));

async function chamarGemini(prompt, apiKey, fetchImpl = fetch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            evento: { type: 'STRING' },
            inicio: { type: 'STRING' },
            fim: { type: 'STRING' },
            graca: { type: 'STRING' },
          },
          required: ['evento', 'inicio', 'fim', 'graca'],
        },
      },
    }),
  };

  // 503/429 costumam ser picos temporários de demanda: tenta de novo antes de desistir.
  let resp;
  for (let tentativa = 1; tentativa <= TENTATIVAS_HTTP; tentativa++) {
    resp = await fetchImpl(url, init);
    if (resp.ok || ![429, 503].includes(resp.status) || tentativa === TENTATIVAS_HTTP) break;
    await new Promise((r) => setTimeout(r, ESPERA_MS * tentativa));
  }
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const bruto = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!bruto) {
    const motivo = data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason ?? 'desconhecido';
    throw new Error(`Gemini sem conteúdo (motivo: ${motivo})`);
  }
  return JSON.parse(bruto);
}

// O modelo erra duração com facilidade: só aceitamos o que as datas dele confirmam.
export async function gerarCuriosidade(apiKey, fetchImpl, agora = Date.now()) {
  const dias = diasDeAtraso(agora);
  const descartados = [];
  for (let i = 0; i < TENTATIVAS_FATO; i++) {
    const candidato = await chamarGemini(montarPrompt(dias, descartados), apiKey, fetchImpl);
    const r = avaliarCandidato(candidato, dias, agora);
    if (r.ok) {
      const { evento, inicio, fim, duracao, graca } = r;
      return { geradaEm: new Date(agora).toISOString(), evento, inicio, fim, duracao, graca };
    }
    console.warn(`Candidato rejeitado (${r.motivo}): ${candidato?.evento}`);
    if (candidato?.evento) descartados.push(candidato.evento);
  }
  throw new Error('Nenhum acontecimento válido após várias tentativas');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY não configurada');
    process.exit(1);
  }
  try {
    const curiosidade = await gerarCuriosidade(apiKey);
    await writeFile(SAIDA, JSON.stringify(curiosidade, null, 2) + '\n');
    console.log('curiosidade.json atualizado:', curiosidade.evento, `(${curiosidade.duracao} dias)`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
