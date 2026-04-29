#!/usr/bin/env python3
"""
STORM Bridge — Runs Stanford STORM analysis on academic papers.

Optimized for ScholarFlow's academic research pipeline:
- Uses DeepSeek V4 Flash via litellm
- Generates structured literature reviews from paper full text
- Supports different analysis modes: review, variables, theories, gaps

Usage:
  echo '{"topic":"...","papers":[...],"mode":"review","api_key":"..."}' | python3 storm-bridge.py
"""

import json
import sys

# Analysis mode prompts — each tailored for a specific ScholarFlow section
PROMPTS = {
    "review": """You are a senior management research expert conducting a systematic literature review.

Based on the provided papers (with full text when available), generate a comprehensive, publication-quality literature review.

Structure MUST include ALL of the following sections:

1. **研究背景与问题界定** (2-3 paragraphs)
   - Define the core research question
   - Explain why this topic matters theoretically and practically

2. **文献主题分类** (3-5 themes)
   For each theme:
   - Theme name and scope
   - Key papers and their contributions [cite by number]
   - How papers in this theme relate to each other
   - Evolution of thought within the theme

3. **理论框架综述**
   - What theories are used across papers (e.g., RBV, institutional theory, signaling theory)?
   - How are theories applied, extended, or challenged?
   - Cross-theory connections and integration opportunities

4. **方法论分析**
   - Research methods used (empirical, experimental, case study, etc.)
   - Data sources and sample characteristics
   - Methodological strengths and limitations

5. **核心发现与贡献**
   - Convergent findings across papers
   - Contradictory or inconsistent findings
   - Unique contributions of individual papers

6. **研究空白与未来方向** (at least 3 specific gaps)
   - Each gap must be grounded in the reviewed literature
   - Suggest specific research questions for each gap
   - Identify methodological opportunities

Requirements:
- Respond in Chinese (学术写作风格)
- Cite papers using [number] format matching the input order
- Be analytical, not descriptive — compare, contrast, synthesize
- Minimum 3000 Chinese characters
- Every claim must reference specific papers""",

    "variables": """You are a meta-analysis expert extracting variable relationships from academic papers.

From the provided papers, extract ALL variable relationships into a structured format.

For EACH relationship found, identify:
1. Independent Variable (IV) — with measurement approach if mentioned
2. Dependent Variable (DV) — with measurement approach if mentioned
3. Mediating Variables — the mechanism/pathway
4. Moderating Variables — boundary conditions
5. Effect direction (positive/negative/mixed/nonsignificant)
6. Evidence strength (sample size, method quality)
7. Which paper(s) support this relationship [cite by number]

Also provide:
- A meta-summary of the most consistent findings
- Variables that appear across multiple papers
- Contradictory findings and possible explanations
- Gaps: important relationships not yet studied

Respond in Chinese. Be exhaustive — extract EVERY variable relationship mentioned.""",

    "theories": """You are a theoretical framework analyst for management research.

From the provided papers, identify and analyze ALL theoretical frameworks:

For each theory:
1. Theory name (Chinese + English)
2. Core constructs and their definitions
3. Key assumptions
4. Boundary conditions
5. How it's used in each paper (extends/tests/challenges/combines)
6. Seminal references mentioned

Then analyze cross-theory connections:
- Shared constructs between theories
- Complementary vs. competing explanations
- Integration opportunities for a unified framework
- Which theory combinations are novel vs. well-established

Finally, propose an integrated theoretical framework:
- Central theory and supporting theories
- How they connect and at what level
- What new insights the integration provides

Respond in Chinese. Ground every claim in specific papers [cite by number].""",

    "gaps": """You are a research gap analyst specializing in identifying publishable research opportunities.

From the provided papers, conduct a systematic gap analysis:

1. **方法论空白** — What methods haven't been applied to this topic?
   - Missing data sources (e.g., longitudinal, experimental, cross-cultural)
   - Missing analytical techniques (e.g., machine learning, qualitative comparative analysis)

2. **理论空白** — What theoretical perspectives are missing?
   - Theories from adjacent fields not yet applied
   - Under-explored theoretical mechanisms

3. **情境空白** — What contexts haven't been studied?
   - Geographic/cultural contexts
   - Industry sectors
   - Time periods or events

4. **变量空白** — What relationships haven't been examined?
   - Untested mediators or moderators
   - Unexplored dependent variables
   - Missing control variables

For EACH gap, provide:
- Why it matters (theoretical and practical significance)
- Specific research question(s) to address it
- Suggested methodology
- Feasibility assessment (data availability, sample access)

Respond in Chinese. Be specific and actionable — each gap should be directly publishable.""",
}


def run_analysis(topic: str, papers: list, mode: str, api_key: str):
    """Run STORM-style analysis using litellm with DeepSeek."""
    import litellm

    # Build paper context with full text
    paper_texts = []
    for i, p in enumerate(papers[:30]):
        text = f"[{i+1}] {p.get('title', 'Unknown')}"
        if p.get('year'):
            text += f" ({p['year']})"
        if p.get('venue'):
            text += f" — {p['venue']}"
        if p.get('authors'):
            authors = p['authors'] if isinstance(p['authors'], str) else ', '.join(
                a.get('name', '') if isinstance(a, dict) else str(a) for a in p['authors'][:5]
            )
            text += f"\nAuthors: {authors}"
        if p.get('fullText'):
            # Use full text (up to 8000 chars per paper for deep analysis)
            text += f"\n\n{p['fullText'][:8000]}"
        elif p.get('abstract'):
            text += f"\nAbstract: {p['abstract']}"
        paper_texts.append(text)

    papers_context = "\n\n" + "=" * 40 + "\n\n".join(paper_texts)

    system = PROMPTS.get(mode, PROMPTS["review"])

    response = litellm.completion(
        model="deepseek/deepseek-chat",
        api_key=api_key,
        api_base="https://api.deepseek.com",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": f"Research topic: {topic}\n\nPapers ({len(papers)} total):\n{papers_context}"},
        ],
        temperature=0.7,
        max_tokens=8000,
    )

    return {
        "article": response.choices[0].message.content,
        "outline": "",
        "status": "success",
        "mode": mode,
        "tokens": {
            "input": response.usage.prompt_tokens if response.usage else 0,
            "output": response.usage.completion_tokens if response.usage else 0,
        },
    }


def main():
    input_data = json.loads(sys.stdin.read())
    topic = input_data.get("topic", "")
    papers = input_data.get("papers", [])
    mode = input_data.get("mode", "review")
    api_key = input_data.get("api_key", "")

    if not topic or not papers:
        print(json.dumps({"status": "error", "error": "topic and papers required"}))
        return

    if not api_key:
        print(json.dumps({"status": "error", "error": "api_key required"}))
        return

    try:
        result = run_analysis(topic, papers, mode, api_key)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e), "article": "", "outline": ""}))


if __name__ == "__main__":
    main()
