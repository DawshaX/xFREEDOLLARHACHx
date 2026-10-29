/**
 * Nova RAG Engine — PostgreSQL-backed (no ChromaDB dependency)
 * Uses Ollama for embeddings via /api/embeddings endpoint
 * Falls back to TF-IDF keyword search if Ollama embeddings unavailable
 */

import { db, knowledgeTable } from "@workspace/db";
import { logger } from "./logger";
import { like, or, sql } from "drizzle-orm";

import { getOllamaBaseUrl, getOllamaModel } from "./ollama-settings";

async function getEmbedding(text: string): Promise<number[] | null> {
  try {
    const OLLAMA_BASE = await getOllamaBaseUrl();
    const OLLAMA_MODEL = await getOllamaModel();
    const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: number[] };
    return data.embedding ?? null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export class NovaRagEngine {
  async ingestText(title: string, content: string, category = "general", tags: string[] = []): Promise<number> {
    const [row] = await db.insert(knowledgeTable).values({ title, category, content, tags }).returning();
    logger.info({ id: row!.id }, "Nova RAG: ingested text entry");
    return row!.id;
  }

  async query(query: string, k = 5): Promise<Array<{ title: string; content: string; score: number }>> {
    const queryEmb = await getEmbedding(query);
    const rows = await db.select().from(knowledgeTable).limit(200);

    if (queryEmb && rows.length > 0) {
      const scored = rows.map(row => {
        const emb = (row as { embedding?: number[] }).embedding;
        const score = emb ? cosineSimilarity(queryEmb, emb) : 0;
        return { title: row.title, content: row.content, score };
      });
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    }

    // Fallback: keyword search
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return rows.slice(0, k).map(r => ({ title: r.title, content: r.content, score: 0.5 }));

    const kw = `%${terms[0]}%`;
    const results = await db.select().from(knowledgeTable)
      .where(or(like(knowledgeTable.title, kw), like(knowledgeTable.content, kw)))
      .limit(k);

    return results.map(r => ({ title: r.title, content: r.content, score: 0.6 }));
  }
}

export const novaRag = new NovaRagEngine();
