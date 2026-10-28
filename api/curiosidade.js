const INICIO = new Date('2024-12-10T16:30:00-03:00').getTime();
const MS_POR_DIA = 24 * 60 * 60 * 1000;
const MODELO = process.env.GEMINI_MODEL || 'gemini-flash-latest';

// Um tema por dia (rotativo) para a curiosidade não repetir sempre o mesmo assunto.
const TEMAS = [
  'grandes construções e obras de engenharia',
  'exploração, viagens e expedições',
  'guerras, tratados e política',
  'ciência, descobertas e invenções',
  'arte, música, literatura e cinema',
  'esporte e competições',
  'natureza, geologia e astronomia',
  'tecnologia e computação',
];

const cache = new Map();

export function diasDeAtraso(agora = Date.now()) {
  return Math.floor((agora - INICIO) / MS_POR_DIA);
}

export function montarPrompt(dias) {
  const tema = TEMAS[dias % TEMAS.length];
  const meses = (dias / 30.44).toFixed(1);
  return [
    'Um amigo prometeu entregar o planejamento da empresa dele e está atrasado.',
    `Já se passaram ${dias} dias (aproximadamente ${meses} meses) desde a promessa.`,
    '',
    `Escreva UMA curiosidade histórica em português do Brasil, sobre o tema "${tema}", que relacione esse tempo com algo real.`,
    'Use um destes formatos:',
    '- "Com esse tempo dava para [feito real]"; ou',
    '- "Esse foi o tempo que levou para [fato real]".',
    '',
    'Regras:',
    '- Use apenas fatos conhecidos e verificáveis. Se não tiver certeza do número, escolha outro exemplo.',
    `- A duração do fato deve ser próxima de ${dias} dias; diga "cerca de" quando for aproximado.`,
    '- Tom leve e bem-humorado, no máximo 2 frases, sem emojis, sem markdown.',
    '- Não mencione o nome do amigo.',
  ].join('\n');
}

async function chamarGemini(dias, apiKey, fetchImpl = fetch) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: montarPrompt(dias) }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { texto: { type: 'STRING' } },
          required: ['texto'],
        },
      },
    }),
  });
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const bruto = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!bruto) {
    const motivo = data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason ?? 'desconhecido';
    throw new Error(`Gemini sem conteúdo (motivo: ${motivo})`);
  }
  const texto = JSON.parse(bruto).texto?.trim();
  if (!texto) throw new Error('Resposta do Gemini sem texto');
  return texto;
}

export async function obterCuriosidade(dias, apiKey, fetchImpl) {
  if (cache.has(dias)) return cache.get(dias);
  const texto = await chamarGemini(dias, apiKey, fetchImpl);
  cache.clear();
  cache.set(dias, texto);
  return texto;
}

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ erro: 'GEMINI_API_KEY não configurada' });
    return;
  }
  const dias = diasDeAtraso();
  try {
    const texto = await obterCuriosidade(dias, apiKey);
    // O resultado só muda a cada dia: deixa o CDN guardar e evita gastar a API.
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({ dias, texto });
  } catch (e) {
    console.error(e);
    // A mensagem vem da API do Gemini ou do parser; a chave nunca entra nela.
    res.status(502).json({ erro: 'Falha ao gerar curiosidade', detalhe: String(e.message).slice(0, 300) });
  }
}
