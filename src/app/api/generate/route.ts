import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an expert educator specializing in creating high-quality Anki flashcards from lecture content.

Your task is to generate flashcards that help students learn and retain the key concepts from the provided lecture material.

Guidelines for excellent flashcards:
- Each card tests ONE specific concept, fact, or relationship
- Questions (fronts) are clear, specific, and unambiguous
- Answers (backs) are concise but complete — no more than 2-3 sentences
- Cover definitions, key concepts, important facts, formulas, and relationships
- Use varied question types: "What is...", "How does...", "Why...", "What are the steps to..."
- Avoid vague or overly broad questions

Output ONLY valid JSON objects, one per line, in exactly this format:
{"front": "question here", "back": "answer here"}

Do not include any other text, headers, explanations, or formatting — just the JSON objects, one per line.`;

export async function POST(req: NextRequest) {
  try {
    const { content, numCards } = await req.json() as { content: string; numCards: number };

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return new Response("Lecture content is required", { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return new Response("ANTHROPIC_API_KEY not configured", { status: 500 });
    }

    const cardCount = Math.min(Math.max(numCards || 20, 5), 50);
    const userMessage = `Generate exactly ${cardCount} Anki flashcards from the following lecture content. Cover the most important concepts, facts, and relationships.\n\nLecture content:\n${content.trim()}`;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const anthropicStream = client.messages.stream({
            model: "claude-opus-4-6",
            max_tokens: 8192,
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
          });

          for await (const event of anthropicStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }

          controller.close();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          controller.enqueue(encoder.encode(`\n__ERROR__:${message}`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(`Failed to generate flashcards: ${message}`, {
      status: 500,
    });
  }
}
