const INICIO = new Date('2024-12-10T16:30:00-03:00').getTime();
const MS_POR_DIA = 24 * 60 * 60 * 1000;
const TENTATIVAS_HTTP = 3;
const ESPERA_MS = 1000;
const TENTATIVAS_FATO = 4;
const MODELO = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

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

// Faixa de duração aceita para o acontecimento: ±5% do atraso (mínimo ±10 dias).
export function faixaAceita(dias) {
  const folga = Math.max(10, Math.round(dias * 0.05));
  return { min: dias - folga, max: dias + folga };
}

export function montarPrompt(dias, descartados = []) {
  const tema = TEMAS[dias % TEMAS.length];
  const { min, max } = faixaAceita(dias);
  const linhas = [
    'Um amigo prometeu entregar o planejamento da empresa dele e está atrasado.',
    `Já se passaram ${dias} dias (aproximadamente ${(dias / 30.44).toFixed(1)} meses) desde a promessa.`,
    '',
    'Quero comparar esse atraso com a duração de UM acontecimento real da história.',
    `Escolha um acontecimento muito bem documentado que durou entre ${min} e ${max} dias, do início ao fim.`,
    `Prefira o tema "${tema}", mas qualquer tema serve se não houver um bom exemplo.`,
    '',
    'Responda com:',
    '- evento: o que aconteceu, em português, começando com um verbo no infinitivo e sem ponto final (ex.: "construir a Torre Eiffel").',
    '- inicio: data de início real, no formato AAAA-MM-DD.',
    '- fim: data de término real, no formato AAAA-MM-DD.',
    '- graca: uma frase curta e bem-humorada ligando o acontecimento ao atraso do planejamento. Sem números, sem fatos novos, sem emojis e sem citar o nome do amigo.',
    '',
    'Regras:',
    '- Só use acontecimentos cujas DUAS datas você conhece com segurança. Se tiver dúvida, escolha outro.',
    '- Não calcule nem escreva a duração: ela será calculada a partir das datas.',
    '- O início e o fim devem estar de fato entre os extremos do acontecimento (ex.: lançamento e chegada, primeira pedra e inauguração).',
  ];
  if (descartados.length) {
    linhas.push('', 'Já descartados, não repita:', ...descartados.map((d) => `- ${d}`));
  }
  return linhas.join('\n');
}

function lerData(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const t = Date.parse(`${texto}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

// Confere a resposta do modelo e calcula a duração a partir das datas.
export function avaliarCandidato(c, dias, agora = Date.now()) {
  const inicio = lerData(c?.inicio);
  const fim = lerData(c?.fim);
  const evento = typeof c?.evento === 'string' ? c.evento.trim().replace(/[.\s]+$/, '') : '';
  if (!evento || inicio === null || fim === null) return { ok: false, motivo: 'resposta incompleta' };
  if (fim <= inicio || fim > agora) return { ok: false, motivo: 'datas inconsistentes' };
  const duracao = Math.round((fim - inicio) / MS_POR_DIA);
  const { min, max } = faixaAceita(dias);
  if (duracao < min || duracao > max) {
    return { ok: false, motivo: `duração de ${duracao} dias fora da faixa ${min}-${max}`, duracao };
  }
  return { ok: true, evento, inicio, fim, duracao, graca: String(c.graca ?? '').trim() };
}

function formatarData(t) {
  return new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// A frase final é montada aqui, com a duração calculada, e não pelo modelo.
export function montarTexto(f, dias) {
  const diff = f.duracao - dias;
  let abertura;
  if (Math.abs(diff) <= Math.max(3, dias * 0.03)) {
    abertura = `Esse é praticamente o tempo que levou para ${f.evento}`;
  } else if (diff > 0) {
    abertura = `Falta pouco para igualar o tempo que levou para ${f.evento}`;
  } else {
    abertura = `Já passou do tempo que levou para ${f.evento}`;
  }
  const detalhe = `${abertura}: ${f.duracao} dias, de ${formatarData(f.inicio)} a ${formatarData(f.fim)}.`;
  return f.graca ? `${detalhe} ${f.graca}` : detalhe;
}

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

export async function obterCuriosidade(dias, apiKey, fetchImpl) {
  if (cache.has(dias)) return cache.get(dias);

  // O modelo erra duração com facilidade: só aceitamos o que as datas dele confirmam.
  const descartados = [];
  for (let i = 0; i < TENTATIVAS_FATO; i++) {
    const candidato = await chamarGemini(montarPrompt(dias, descartados), apiKey, fetchImpl);
    const r = avaliarCandidato(candidato, dias);
    if (r.ok) {
      const texto = montarTexto(r, dias);
      cache.clear();
      cache.set(dias, texto);
      return texto;
    }
    console.warn(`Candidato rejeitado (${r.motivo}):`, candidato?.evento);
    if (candidato?.evento) descartados.push(candidato.evento);
  }
  throw new Error('Nenhum acontecimento válido após várias tentativas');
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
