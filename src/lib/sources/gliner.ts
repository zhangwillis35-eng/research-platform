/**
 * GLiNER-inspired zero-shot variable extraction for management research.
 * Uses LLM with structured entity type labels for precise extraction.
 *
 * Entity types: independent_variable, dependent_variable, mediator,
 *               moderator, control_variable, theory, method
 * Relation types: DIRECT, MEDIATION, MODERATION
 */
import { callAI } from "@/lib/ai";
import type { AIProvider } from "@/lib/ai";
import { concurrentPool } from "@/lib/concurrent-pool";

export interface ExtractedEntity {
  text: string;
  type:
    | "IV"
    | "DV"
    | "MEDIATOR"
    | "MODERATOR"
    | "CONTROL"
    | "THEORY"
    | "METHOD";
  confidence: number;
}

export interface ExtractedRelation {
  source: string;
  target: string;
  type: "DIRECT" | "MEDIATION" | "MODERATION";
  direction: "positive" | "negative" | "mixed" | "nonsignificant";
  evidence: string;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
  paperIndex: number;
}

const EXTRACTION_SYSTEM = `You are a management research NER+RE expert. Extract ENTITIES and RELATIONS from paper text.

ENTITY TYPES (use EXACTLY these labels):
- IV: Independent Variable (the cause/predictor)
- DV: Dependent Variable (the outcome/response)
- MEDIATOR: Mediator Variable (mechanism through which IV affects DV)
- MODERATOR: Moderator Variable (boundary condition that strengthens/weakens the IV-DV relationship)
- CONTROL: Control Variable (held constant)
- THEORY: Theoretical Framework used
- METHOD: Research Method used

RELATION TYPES:
- DIRECT: Direct causal relationship (IV -> DV)
- MEDIATION: Indirect effect through mediator (IV -> MED -> DV)
- MODERATION: Boundary condition (MOD moderates IV -> DV)

For each relation, specify direction: positive, negative, mixed, or nonsignificant.
Include evidence: the specific text span (beta coefficient, p-value, or qualitative description).

Output STRICT JSON (no markdown fences):
{
  "entities": [{"text": "organizational learning", "type": "IV", "confidence": 0.95}],
  "relations": [{"source": "organizational learning", "target": "firm performance", "type": "DIRECT", "direction": "positive", "evidence": "beta=0.42, p<0.001"}]
}

If no entities or relations can be extracted, return {"entities": [], "relations": []}.`;

const VALID_ENTITY_TYPES = new Set([
  "IV",
  "DV",
  "MEDIATOR",
  "MODERATOR",
  "CONTROL",
  "THEORY",
  "METHOD",
]);
const VALID_RELATION_TYPES = new Set(["DIRECT", "MEDIATION", "MODERATION"]);
const VALID_DIRECTIONS = new Set([
  "positive",
  "negative",
  "mixed",
  "nonsignificant",
]);

export async function extractEntitiesAndRelations(
  paperText: string,
  paperIndex: number,
  provider: AIProvider = "deepseek-fast",
): Promise<ExtractionResult> {
  const truncated = paperText.slice(0, 6000);

  const response = await callAI({
    provider,
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Extract all entities and relations from this paper text:\n\n${truncated}`,
      },
    ],
    temperature: 0.1,
    jsonMode: true,
    noThinking: true,
  });

  try {
    const parsed = JSON.parse(response.content);
    const entities: ExtractedEntity[] = (parsed.entities ?? [])
      .filter(
        (e: Record<string, unknown>) =>
          typeof e.text === "string" &&
          e.text.length > 0 &&
          VALID_ENTITY_TYPES.has(e.type as string),
      )
      .map((e: Record<string, unknown>) => ({
        text: String(e.text),
        type: e.type as ExtractedEntity["type"],
        confidence:
          typeof e.confidence === "number"
            ? Math.min(1, Math.max(0, e.confidence))
            : 0.5,
      }));

    const relations: ExtractedRelation[] = (parsed.relations ?? [])
      .filter(
        (r: Record<string, unknown>) =>
          typeof r.source === "string" &&
          typeof r.target === "string" &&
          VALID_RELATION_TYPES.has(r.type as string),
      )
      .map((r: Record<string, unknown>) => ({
        source: String(r.source),
        target: String(r.target),
        type: r.type as ExtractedRelation["type"],
        direction: VALID_DIRECTIONS.has(r.direction as string)
          ? (r.direction as ExtractedRelation["direction"])
          : "mixed",
        evidence: typeof r.evidence === "string" ? r.evidence : "",
      }));

    return { entities, relations, paperIndex };
  } catch {
    return { entities: [], relations: [], paperIndex };
  }
}

/**
 * Batch extract from multiple papers with concurrency.
 */
export async function batchExtract(
  papers: Array<{ text: string; title: string; abstract?: string }>,
  provider: AIProvider = "deepseek-fast",
  onProgress?: (completed: number, total: number) => void,
): Promise<ExtractionResult[]> {
  const results = await concurrentPool(
    papers,
    async (paper, index) => {
      const text = paper.abstract
        ? `Title: ${paper.title}\nAbstract: ${paper.abstract}\n\n${paper.text}`
        : `Title: ${paper.title}\n\n${paper.text}`;
      return extractEntitiesAndRelations(text, index, provider);
    },
    10,
    (completed, total) => {
      onProgress?.(completed, total);
    },
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value != null)
    .map((r) => r.value!);
}
