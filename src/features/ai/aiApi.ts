import { z } from 'zod';

import { readPublicEnv } from '../../shared/env';
import { getSupabase } from '../../shared/supabase';

/** Клиент Edge Function ai-chat. Ответ проходит Zod; история хранится только в памяти экрана. */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const replySchema = z.object({
  ok: z.literal(true),
  answer: z.string(),
  tool: z.string().nullable(),
  llm: z.boolean(),
  reason: z.string().nullable(),
  actions: z.array(z.string()),
});
export type AiReply = z.infer<typeof replySchema>;

const errorSchema = z.object({ ok: z.literal(false), message: z.string() });

function parse(data: unknown): AiReply {
  const ok = replySchema.safeParse(data);
  if (ok.success) return ok.data;
  const err = errorSchema.safeParse(data);
  throw new Error(err.success ? err.data.message : 'Ассистент временно недоступен');
}

const lastTurns = (turns: ChatTurn[]) => turns.slice(-12);

export async function askGuest(slug: string, token: string | null, turns: ChatTurn[]) {
  const env = readPublicEnv();
  if (!env.success) throw new Error('Приложение не настроено');
  let res: Response;
  try {
    res = await fetch(`${env.data.VITE_SUPABASE_URL}/functions/v1/ai-chat`, {
      method: 'POST',
      headers: {
        apikey: env.data.VITE_SUPABASE_PUBLISHABLE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mode: 'guest',
        slug,
        ...(token ? { token } : {}),
        messages: lastTurns(turns),
      }),
    });
  } catch {
    throw new Error('Нет связи с сервером');
  }
  return parse(await res.json().catch(() => null));
}

/** Владелец: supabase-js сам подставляет JWT сессии; членство проверяет сервер. */
export async function askOwner(slug: string, turns: ChatTurn[]) {
  const { data, error } = await getSupabase().functions.invoke('ai-chat', {
    body: { mode: 'owner', slug, messages: lastTurns(turns) },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body: unknown = context ? await context.json().catch(() => null) : null;
    return parse(body);
  }
  return parse(data);
}
