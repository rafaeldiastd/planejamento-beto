// Lógica compartilhada: usada pelo script semanal (Node) e pela página (navegador).
// Não pode depender de APIs exclusivas de Node.

export const INICIO = new Date('2024-12-10T16:30:00-03:00').getTime();
export const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Um tema por semana (rotativo) para a curiosidade não repetir sempre o mesmo assunto.
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

export function diasDeAtraso(agora = Date.now()) {
  return Math.floor((agora - INICIO) / MS_POR_DIA);
}

// Faixa de duração aceita para o acontecimento: ±5% do atraso (mínimo ±10 dias).
export function faixaAceita(dias) {
  const folga = Math.max(10, Math.round(dias * 0.05));
  return { min: dias - folga, max: dias + folga };
}

export function montarPrompt(dias, descartados = []) {
  const tema = TEMAS[Math.floor(dias / 7) % TEMAS.length];
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
  return { ok: true, evento, inicio: c.inicio, fim: c.fim, duracao, graca: String(c.graca ?? '').trim() };
}

function formatarData(texto) {
  return new Date(lerData(texto)).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// A frase é montada com os dias de hoje, então continua correta durante a semana toda.
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
