import { callAI } from "@/lib/ai";
import { prisma } from "@/lib/db";

// ─── Types ───────────────────────────────────────────────────────────────────

const OB_CATEGORIES = [
  "leadership",
  "motivation",
  "team_dynamics",
  "organizational_justice",
  "conflict",
  "communication",
  "power_politics",
  "organizational_culture",
  "change_management",
  "decision_making",
  "emotions_stress",
  "diversity_inclusion",
  "other",
] as const;

const CONTEXT_TYPES = [
  "corporate",
  "startup",
  "government",
  "education",
  "healthcare",
  "nonprofit",
  "military",
  "remote_work",
  "cross_cultural",
  "other",
] as const;

type OBCategory = (typeof OB_CATEGORIES)[number];
type ContextType = (typeof CONTEXT_TYPES)[number];

interface TheoryTag {
  theory: string;
  relevance: "high" | "medium" | "low";
  explanation: string;
}

interface StoryAnalysis {
  academicSummary: string;
  keyPhenomena: string[];
  theoryTags: TheoryTag[];
  obCategory: OBCategory;
  contextType: ContextType;
}

// ─── Anonymize ───────────────────────────────────────────────────────────────

const ANONYMIZE_SYSTEM_PROMPT = `You are a text anonymization specialist. Your task is to replace all personally identifiable information in the narrative while preserving the story's meaning, emotional tone, and narrative flow.

Rules:
- Replace personal names with pseudonyms: Person A, Person B, Person C, etc.
- Replace company/organization names with: Company X, Company Y, Organization Z, etc.
- Replace specific location names (cities, streets, buildings) with generic equivalents (e.g., "a major city", "the downtown office").
- Preserve job titles, industries, and roles as-is (e.g., "marketing manager" stays).
- Preserve temporal references (e.g., "last quarter", "three years ago").
- Do NOT add commentary, explanations, or metadata.
- Return ONLY the anonymized text, nothing else.
- Maintain the original language of the text (if Chinese, output Chinese; if English, output English).`;

export async function anonymizeStory(rawContent: string): Promise<string> {
  const response = await callAI({
    provider: "deepseek-fast",
    system: ANONYMIZE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: rawContent }],
    temperature: 0.1,
    noThinking: true,
    maxTokens: 4096,
  });

  return response.content.trim();
}

// ─── Analyze ─────────────────────────────────────────────────────────────────

const ANALYZE_SYSTEM_PROMPT = `You are an organizational behavior (OB) research analyst. Given an anonymized workplace narrative, produce a structured JSON analysis.

Return a JSON object with exactly these fields:

1. "academicSummary" (string): A 150-200 word academic abstract summarizing the narrative in scholarly language. Write in Chinese (中文).

2. "keyPhenomena" (array of strings): 3-6 organizational behavior phenomena observed in the narrative (e.g., "transformational leadership", "role conflict", "psychological safety"). Use English academic terminology.

3. "theoryTags" (array of objects): Each object has:
   - "theory" (string): name of a relevant OB theory (e.g., "Leader-Member Exchange Theory")
   - "relevance": one of "high", "medium", "low"
   - "explanation" (string): one sentence in Chinese explaining why this theory applies

4. "obCategory" (string): exactly one of: leadership, motivation, team_dynamics, organizational_justice, conflict, communication, power_politics, organizational_culture, change_management, decision_making, emotions_stress, diversity_inclusion, other

5. "contextType" (string): exactly one of: corporate, startup, government, education, healthcare, nonprofit, military, remote_work, cross_cultural, other

Return ONLY valid JSON. No markdown fences, no commentary.`;

export async function analyzeStory(
  anonymizedContent: string
): Promise<StoryAnalysis> {
  const response = await callAI({
    provider: "deepseek-fast",
    system: ANALYZE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyze the following workplace narrative:\n\n${anonymizedContent}`,
      },
    ],
    temperature: 0.3,
    jsonMode: true,
    noThinking: true,
    maxTokens: 2048,
  });

  const parsed = JSON.parse(response.content) as StoryAnalysis;

  // Validate enums with fallback
  if (!OB_CATEGORIES.includes(parsed.obCategory as OBCategory)) {
    parsed.obCategory = "other";
  }
  if (!CONTEXT_TYPES.includes(parsed.contextType as ContextType)) {
    parsed.contextType = "other";
  }

  // Clamp keyPhenomena to 3-6
  if (parsed.keyPhenomena.length > 6) {
    parsed.keyPhenomena = parsed.keyPhenomena.slice(0, 6);
  }

  return parsed;
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

export async function processStory(storyId: string): Promise<void> {
  const story = await prisma.story.findUniqueOrThrow({
    where: { id: storyId },
  });

  if (story.status !== "PENDING") {
    throw new Error(
      `Story ${storyId} is not PENDING (current: ${story.status})`
    );
  }

  // Mark as processing
  await prisma.story.update({
    where: { id: storyId },
    data: { status: "PROCESSING" },
  });

  try {
    // Step 1: Anonymize
    const anonymizedContent = await anonymizeStory(story.rawContent);

    // Step 2: Analyze
    const analysis = await analyzeStory(anonymizedContent);

    // Step 3: Persist all results
    await prisma.story.update({
      where: { id: storyId },
      data: {
        anonymizedContent,
        academicSummary: analysis.academicSummary,
        keyPhenomena: analysis.keyPhenomena,
        theoryTags: JSON.parse(JSON.stringify(analysis.theoryTags)),
        obCategory: analysis.obCategory,
        contextType: analysis.contextType,
        status: "PUBLISHED",
      },
    });
  } catch (error) {
    // Revert to PENDING so it can be retried
    await prisma.story.update({
      where: { id: storyId },
      data: { status: "PENDING" },
    });
    console.error(`[story-processor] Failed to process story ${storyId}:`, error);
    throw error;
  }
}

// ─── Follow-Up Conversation ──────────────────────────────────────────────────

const FOLLOW_UP_SYSTEM_PROMPT = `You are a friendly research assistant collecting workplace stories for organizational behavior research. You speak Chinese.

Your goal: ask exactly ONE follow-up question per turn to gather richer details about the contributor's experience. Focus on:
- Interpersonal dynamics (relationships, trust, conflicts)
- Emotions and stress (how they felt, coping mechanisms)
- Power dynamics (authority, influence, politics)
- Decision-making processes (how choices were made, who was involved)

Rules:
- Ask only ONE question per response.
- Be warm, empathetic, and non-judgmental.
- Reference specific details from the story to show you read it carefully.
- Keep responses concise (2-3 sentences max).
- After the contributor has answered 2 or more follow-up questions (i.e., there are 2+ user messages in the conversation history beyond the initial story), thank them warmly and indicate the conversation is complete. Do NOT ask another question.
- Respond entirely in Chinese (中文).`;

export async function generateFollowUp(
  storyId: string,
  existingMessages: Array<{ role: string; content: string }>
): Promise<string> {
  const story = await prisma.story.findUniqueOrThrow({
    where: { id: storyId },
  });

  // Build conversation: start with the anonymized (or raw) content as context
  const storyContext = story.anonymizedContent || story.rawContent;

  const messages = [
    {
      role: "user" as const,
      content: `Here is the workplace story for context:\n\n${storyContext}`,
    },
    {
      role: "assistant" as const,
      content:
        "我已经仔细阅读了您分享的职场经历。让我来问一些后续问题，以便更好地理解您的体验。",
    },
    ...existingMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const response = await callAI({
    provider: "deepseek-fast",
    system: FOLLOW_UP_SYSTEM_PROMPT,
    messages,
    temperature: 0.6,
    noThinking: true,
    maxTokens: 512,
  });

  return response.content.trim();
}
