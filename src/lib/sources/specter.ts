/**
 * SPECTER2 — scientific document embeddings from Allen AI.
 * Uses HuggingFace Inference API for zero-deployment embedding generation.
 *
 * SPECTER2 encodes title+abstract pairs into 768-dim vectors.
 * Cosine similarity between vectors indicates semantic relatedness.
 */
import { getEnv } from "@/lib/env";

const HF_MODEL = "allenai/specter2";
const HF_URL = `https://api-inference.huggingface.co/pipeline/feature-extraction/${HF_MODEL}`;
const EMBEDDING_DIM = 768;

export interface PaperEmbedding {
  title: string;
  doi?: string;
  embedding: number[];
}

/**
 * Get embeddings for paper title+abstract pairs.
 * SPECTER2 expects input in format: "title [SEP] abstract"
 */
export async function embedPapers(
  papers: Array<{ title: string; abstract?: string; doi?: string }>,
): Promise<PaperEmbedding[]> {
  const token = getEnv("HF_TOKEN");
  if (!token) {
    console.log("[specter2] No HF_TOKEN set — skipping embeddings");
    return [];
  }

  // SPECTER2 input format: "title [SEP] abstract"
  const inputs = papers.map(p =>
    p.abstract ? `${p.title} [SEP] ${p.abstract.slice(0, 512)}` : p.title
  );

  // HF Inference API supports batch inputs
  // Process in batches of 16 to avoid timeout
  const BATCH_SIZE = 16;
  const results: PaperEmbedding[] = [];

  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const batch = inputs.slice(i, i + BATCH_SIZE);
    const batchPapers = papers.slice(i, i + BATCH_SIZE);

    try {
      const res = await fetch(HF_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: batch, options: { wait_for_model: true } }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error(`[specter2] HF API error ${res.status}: ${errText.slice(0, 200)}`);
        continue;
      }

      const embeddings = await res.json() as number[][][] | number[][];

      // HF returns either [[...768...]] per input or [[[...768...]]] with pooling
      for (let j = 0; j < batchPapers.length; j++) {
        let embedding: number[];
        const raw = embeddings[j];

        if (Array.isArray(raw) && Array.isArray(raw[0])) {
          // Token-level embeddings — mean pool to get document embedding
          const tokens = raw as number[][];
          embedding = new Array(EMBEDDING_DIM).fill(0);
          for (const token of tokens) {
            for (let k = 0; k < EMBEDDING_DIM; k++) {
              embedding[k] += token[k] / tokens.length;
            }
          }
        } else {
          embedding = raw as number[];
        }

        if (embedding.length === EMBEDDING_DIM) {
          results.push({
            title: batchPapers[j].title,
            doi: batchPapers[j].doi,
            embedding,
          });
        }
      }

      console.log(`[specter2] Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}: ${results.length} papers total`);
    } catch (err) {
      console.error(`[specter2] Batch embedding failed:`, (err as Error).message);
    }
  }

  return results;
}

/**
 * Compute cosine similarity between two embedding vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Find the most semantically similar papers to a query.
 * Embeds query and all papers, then ranks by cosine similarity.
 */
export async function findSimilarPapers(
  queryTitle: string,
  queryAbstract: string | undefined,
  papers: Array<{ title: string; abstract?: string; doi?: string }>,
  topK: number = 10,
): Promise<Array<{ title: string; doi?: string; similarity: number; rank: number }>> {
  if (papers.length === 0) return [];

  // Embed query and all papers together
  const allInputs = [
    { title: queryTitle, abstract: queryAbstract },
    ...papers,
  ];

  const embeddings = await embedPapers(allInputs);
  if (embeddings.length < 2) return []; // Need at least query + 1 paper

  const queryEmbedding = embeddings[0].embedding;
  const paperEmbeddings = embeddings.slice(1);

  // Compute similarities and rank
  const scored = paperEmbeddings.map((pe, i) => ({
    title: papers[i].title,
    doi: papers[i].doi,
    similarity: cosineSimilarity(queryEmbedding, pe.embedding),
    rank: 0,
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  scored.forEach((s, i) => { s.rank = i + 1; });

  return scored.slice(0, topK);
}

/**
 * Check if SPECTER2 is available (HF token configured).
 */
export function isSpecterAvailable(): boolean {
  return !!getEnv("HF_TOKEN");
}
