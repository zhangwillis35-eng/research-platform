import { NextResponse } from "next/server";
import {
  checkNotebookLM,
  runDeepAnalysis,
  combineAnswers,
  generateReviewQuestions,
  generateVariableQuestions,
  generateTheoryQuestions,
  generateIdeaQuestions,
  type NotebookLMConfig,
} from "@/lib/integrations/notebooklm";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, config, ...payload } = body as {
      action: "check" | "analyze" | "questions";
      config: Partial<NotebookLMConfig>;
      [key: string]: unknown;
    };

    const nlmConfig: NotebookLMConfig = {
      proxyUrl: config?.proxyUrl ?? "http://localhost:27124",
      notebookId: config?.notebookId,
      notebookUrl: config?.notebookUrl as string | undefined,
      mode: config?.mode ?? "manual",
    };

    switch (action) {
      case "check": {
        const status = await checkNotebookLM(nlmConfig);
        return NextResponse.json(status);
      }

      case "questions": {
        // Generate structured questions for manual mode
        const topic = payload.topic as string;
        const type = payload.type as string;
        if (!topic) {
          return NextResponse.json({ error: "Topic required" }, { status: 400 });
        }

        let questions;
        switch (type) {
          case "review":
            questions = generateReviewQuestions(topic, (payload.paperCount as number) ?? 0);
            break;
          case "variables":
            questions = generateVariableQuestions(topic);
            break;
          case "theories":
            questions = generateTheoryQuestions(topic);
            break;
          case "ideas":
            questions = generateIdeaQuestions(topic);
            break;
          default:
            questions = generateReviewQuestions(topic, 0);
        }

        return NextResponse.json({
          questions: questions.map((q) => ({
            question: q.question,
            purpose: q.purpose,
          })),
          instructions: "请在 NotebookLM 中逐个提问以上问题，将回答粘贴回平台。",
        });
      }

      case "analyze": {
        // Run analysis via proxy (auto mode) or return questions (manual mode)
        const topic = payload.topic as string;
        const type = payload.type as string;
        if (!topic) {
          return NextResponse.json({ error: "Topic required" }, { status: 400 });
        }

        let queries;
        switch (type) {
          case "review":
            queries = generateReviewQuestions(topic, (payload.paperCount as number) ?? 0);
            break;
          case "variables":
            queries = generateVariableQuestions(topic);
            break;
          case "theories":
            queries = generateTheoryQuestions(topic);
            break;
          case "ideas":
            queries = generateIdeaQuestions(topic);
            break;
          default:
            queries = generateReviewQuestions(topic, 0);
        }

        const result = await runDeepAnalysis(nlmConfig, queries);
        const combined = combineAnswers(result.answers, queries);

        return NextResponse.json({
          analysis: combined,
          answers: result.answers,
          sessionId: result.sessionId,
          mode: nlmConfig.mode,
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: "NotebookLM error", details: String(error) },
      { status: 500 }
    );
  }
}
