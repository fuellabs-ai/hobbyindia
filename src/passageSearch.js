// Practice-selected retrieval. Mirror server/passage_search.py and the tuning
// script: BM25 over 120-word children, max per channel per parent, weighted z.
import passageData from '../data/sources/passages.json';
import config from '../data/search_config.json';
import { normalize } from './searchText';

export const passages = passageData.passages;
export const chunks = passageData.chunks;
export const passageDim = passageData.dim;
export const departmentByCard = Object.fromEntries(passages.flatMap(p => p.cards.map(id => [id, p.dept])));
const parentById = new Map(passages.map(p => [p.id, p]));
const departments = new Map();
if (passageData.chunk_words !== config.passage_retrieval.chunk_words) throw new Error('Rebuild passage chunks for this configuration');
const tokens = text => normalize(text).split(' ').filter(w => w.length > 1);
for (const [row, chunk] of chunks.entries()) {
  const parent = parentById.get(chunk.parent_id);
  if (!parent) throw new Error('Unknown parent passage');
  if (!departments.has(parent.dept)) departments.set(parent.dept, { docs: [], parents: passages.filter(p => p.dept === parent.dept) });
  const words = tokens(`${parent.question}\n${chunk.text}`);
  const tf = new Map();
  for (const word of words) tf.set(word, (tf.get(word) || 0) + 1);
  departments.get(parent.dept).docs.push({ parent: parent.id, row, tf, length: words.length });
}
for (const group of departments.values()) {
  group.df = new Map();
  for (const doc of group.docs) for (const word of doc.tf.keys()) group.df.set(word, (group.df.get(word) || 0) + 1);
  group.average = group.docs.reduce((n, d) => n + d.length, 0) / group.docs.length;
}
function z(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
  return values.map(v => (v - mean) / (std + 1e-9));
}

// Query text is already normalize(redact(raw)); do not normalize it twice.
export function rankPassages(cleaned, query, vectors, department) {
  const group = departments.get(department);
  if (!group) return { embedding: [], keyword: [], hybrid: [], compared: 0, parents_compared: 0, quote_eligible: false };
  const { docs, parents, df, average } = group;
  const terms = [...new Set(cleaned.split(' ').filter(w => w.length > 1))];
  const features = parents.map(p => ({ id: p.id, embedding_score: -Infinity, bm25_score: 0 }));
  const byParent = new Map(features.map(f => [f.id, f]));
  for (const doc of docs) {
    let bm25 = 0;
    for (const word of terms) {
      const tf = doc.tf.get(word) || 0;
      if (!tf) continue;
      const count = df.get(word) || 0;
      bm25 += Math.log(1 + (docs.length - count + 0.5) / (count + 0.5)) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * doc.length / average));
    }
    const parent = byParent.get(doc.parent);
    parent.bm25_score = Math.max(parent.bm25_score, bm25);
    if (query) {
      let score = 0;
      for (let i = 0; i < passageDim; i++) score += vectors[doc.row * passageDim + i] * query[i];
      parent.embedding_score = Math.max(parent.embedding_score, score);
    }
  }
  const order = field => features.map((f, i) => ({ ...f, score: f[field], index: i }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const keyword = order('bm25_score');
  const embedding = query ? order('embedding_score') : [];
  const eligible = Boolean(query && embedding[0].id === keyword[0].id && keyword[0].score > 0 && embedding[0].score >= config.passage_threshold);
  let hybrid = [];
  if (query) {
    const ez = z(features.map(f => f.embedding_score)), bz = z(features.map(f => f.bm25_score));
    features.forEach((f, i) => { f.hybrid_score = config.passage_retrieval.embedding_weight * ez[i] + config.passage_retrieval.bm25_weight * bz[i]; });
    hybrid = order('hybrid_score');
  }
  for (const ranking of [embedding, keyword, hybrid]) for (const row of ranking) {
    row.quote_eligible = eligible && row.id === embedding[0].id;
    if (!query) row.embedding_score = null;
    delete row.index;
  }
  return { embedding, keyword, hybrid, compared: docs.length, parents_compared: parents.length, quote_eligible: eligible };
}

// Keep cosine in score for existing UI clients, and expose the ranking score
// separately. A threshold above 1 closes their score-only gate on disagreement.
export function passageResponse(ranked) {
  const hybrid = ranked.hybrid.length > 0;
  const eligible = hybrid && ranked.quote_eligible;
  const round = score => Math.round(score * 1e4) / 1e4;
  return {
    passages: (hybrid ? ranked.hybrid : ranked.keyword).slice(0, 3).map(row => ({
      id: row.id, score: round(hybrid ? row.embedding_score : row.bm25_score / (row.bm25_score + 1)),
      bm25_score: round(row.bm25_score), ...(hybrid ? { hybrid_score: round(row.score) } : {}),
      quote_eligible: hybrid && row.quote_eligible,
    })),
    passages_compared: ranked.compared, passage_parents_compared: ranked.parents_compared,
    passage_method: hybrid ? 'hybrid' : ranked.keyword.length ? 'bm25' : 'none',
    quote_eligible: eligible, passage_threshold: eligible ? config.passage_threshold : 2,
  };
}

export const bm25Passages = (cleaned, department) => rankPassages(cleaned, null, null, department).keyword;
export const vectorPassages = (query, vectors, department) => rankPassages('', query, vectors, department).embedding;
export const keywordPassages = (cleaned, cardId) => passageResponse(rankPassages(cleaned, null, null, departmentByCard[cardId]));
