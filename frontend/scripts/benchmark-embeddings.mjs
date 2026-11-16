/** Synthetic multilingual retrieval benchmark. No vault data is read. */
import { performance } from 'node:perf_hooks';
import { pipeline, env } from '@huggingface/transformers';
import { readFile } from 'node:fs/promises';

env.allowLocalModels = false;
env.allowRemoteModels = true;

const profiles = JSON.parse(await readFile(new URL('../src/services/embeddingProfiles.json', import.meta.url), 'utf8'));

const LANGUAGES = ['pt-PT', 'pt-BR', 'en', 'fr'];
const TOPICS = [
  {
    id: 'energy',
    documents: [
      'A barragem hidroelétrica produz energia a partir da água do rio.',
      'A usina hidrelétrica gera eletricidade com a força da água do rio.',
      'The hydroelectric dam generates electricity from river water.',
      'Le barrage hydroélectrique produit de l’électricité grâce à l’eau du fleuve.',
    ],
    queries: [
      'Como é produzida a eletricidade na barragem?',
      'Como a usina gera energia com água?',
      'How does the dam generate electricity?',
      'Comment le barrage produit-il de l’électricité ?',
    ],
  },
  {
    id: 'plants',
    documents: [
      'As sementes de tomate precisam de luz e humidade para germinar.',
      'Sementes de tomate germinam melhor com luz e umidade.',
      'Tomato seeds need light and moisture to germinate.',
      'Les graines de tomate ont besoin de lumière et d’humidité pour germer.',
    ],
    queries: [
      'O que ajuda as sementes de tomate a germinar?',
      'O que as sementes de tomate precisam para germinar?',
      'What do tomato seeds need to germinate?',
      'De quoi les graines de tomate ont-elles besoin pour germer ?',
    ],
  },
  {
    id: 'transport',
    documents: [
      'O comboio expresso parte da estação às oito da manhã.',
      'O trem expresso sai da estação às oito horas da manhã.',
      'The express train leaves the station at eight in the morning.',
      'Le train express quitte la gare à huit heures du matin.',
    ],
    queries: [
      'A que horas parte o comboio expresso?',
      'Que horas o trem expresso sai da estação?',
      'When does the express train leave?',
      'À quelle heure part le train express ?',
    ],
  },
  {
    id: 'health',
    documents: [
      'A médica marcou uma consulta de vacinação para sexta-feira.',
      'A médica agendou a consulta de vacinação para sexta-feira.',
      'The doctor booked a vaccination appointment for Friday.',
      'La médecin a fixé un rendez-vous de vaccination pour vendredi.',
    ],
    queries: [
      'Quando está marcada a consulta de vacinação?',
      'Para quando foi agendada a vacinação?',
      'When is the vaccination appointment?',
      'Quand est le rendez-vous de vaccination ?',
    ],
  },
];

const corpus = TOPICS.flatMap((topic) => topic.documents.map((text, index) => ({
  topic: topic.id, language: LANGUAGES[index], text,
})));
const questions = TOPICS.flatMap((topic) => topic.queries.map((text, index) => ({
  topic: topic.id, language: LANGUAGES[index], text,
})));

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

for (const profile of Object.values(profiles)) {
  const { modelId, revision, dtype, pooling, normalize, dimensions } = profile;
  const initialRss = process.memoryUsage().rss;
  const loadStart = performance.now();
  const embedder = await pipeline('feature-extraction', modelId, { dtype, revision });
  const loadMs = Math.round(performance.now() - loadStart);

  const inferenceStart = performance.now();
  const vectors = [];
  for (const item of [...corpus, ...questions]) {
    const output = await embedder(item.text, { pooling, normalize });
    const vector = Array.from(output.data);
    if (vector.length !== dimensions || !vector.every(Number.isFinite)) throw new Error('Invalid benchmark vector');
    vectors.push(vector);
  }
  const inferenceMs = Math.round(performance.now() - inferenceStart);
  const corpusVectors = vectors.slice(0, corpus.length);
  const questionVectors = vectors.slice(corpus.length);

  const byLanguage = Object.fromEntries(LANGUAGES.map((language) => [language, {
    queries: 0, precisionAt4: 0, recallAt4: 0, reciprocalRank: 0,
  }]));
  questions.forEach((question, index) => {
    const ranked = corpus.map((item, corpusIndex) => ({
      topic: item.topic,
      score: cosine(questionVectors[index], corpusVectors[corpusIndex]),
    })).sort((a, b) => b.score - a.score);
    const top4 = ranked.slice(0, 4);
    const correct = top4.filter((item) => item.topic === question.topic).length;
    const firstCorrect = ranked.findIndex((item) => item.topic === question.topic);
    const metrics = byLanguage[question.language];
    metrics.queries += 1;
    metrics.precisionAt4 += correct / 4;
    metrics.recallAt4 += correct / 4;
    metrics.reciprocalRank += 1 / (firstCorrect + 1);
  });
  for (const metrics of Object.values(byLanguage)) {
    metrics.precisionAt4 = Number((metrics.precisionAt4 / metrics.queries).toFixed(3));
    metrics.recallAt4 = Number((metrics.recallAt4 / metrics.queries).toFixed(3));
    metrics.reciprocalRank = Number((metrics.reciprocalRank / metrics.queries).toFixed(3));
  }

  console.log(JSON.stringify({
    modelId,
    revision,
    pooling,
    normalize,
    runtime: `Node ${process.version}`,
    dtype,
    dimensions: corpusVectors[0].length,
    corpusSize: corpus.length,
    queryCount: questions.length,
    loadMs,
    inferenceMs,
    meanInferenceMs: Math.round(inferenceMs / vectors.length),
    rssIncreaseMiB: Math.round((process.memoryUsage().rss - initialRss) / 1024 / 1024),
    byLanguage,
  }, null, 2));
  await embedder.dispose();
}
