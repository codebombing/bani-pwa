// OpenAI-совместимый провайдер (LLM_BASE_URL / LLM_API_KEY / LLM_MODEL — только секреты
// функций, никогда не VITE_*). Tool loop ограничен 4 итерациями. Если провайдер не умеет
// tool calling — fallback: модель возвращает JSON {intent, args}, он проходит Zod.
import { z } from 'zod';

import type { Mode } from '../_shared/ai/router.ts';
import { allowedTools, runTool, type ToolContext, toolSpecs } from './tools.ts';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function llmConfig(): LlmConfig | null {
  const baseUrl = Deno.env.get('LLM_BASE_URL');
  const apiKey = Deno.env.get('LLM_API_KEY');
  const model = Deno.env.get('LLM_MODEL');
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model };
}

type Message =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
type ToolCall = z.infer<typeof toolCallSchema>;

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z.array(toolCallSchema).optional(),
        }),
      }),
    )
    .min(1),
});

export class ToolsUnsupported extends Error {}

async function complete(cfg: LlmConfig, messages: Message[], tools?: unknown[]) {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.2,
      max_tokens: 500,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (tools && res.status === 400 && /tool|function/i.test(text))
      throw new ToolsUnsupported(text);
    throw new Error(`LLM HTTP ${res.status}`);
  }
  return completionSchema.parse(await res.json()).choices[0]!.message;
}

export function systemPrompt(mode: Mode, ctx: ToolContext, today: string): string {
  const halls = ctx.halls.map((h) => `${h.name} (id ${h.id})`).join('; ');
  const role =
    mode === 'guest'
      ? 'Ты — помощник гостей бани. Помогаешь узнать свободное время, цену и статус своей брони.'
      : 'Ты — помощник владельца бани. Отвечаешь по броням, деньгам и загрузке.';
  return [
    role,
    `Заведение: ${ctx.tenant.name}. Сегодня ${today} (${ctx.tenant.timezone}). Залы: ${halls}.`,
    'Отвечай по-русски, коротко, только фактами из результатов инструментов. Не придумывай цены, время и брони.',
    'Суммы в результатах — в копейках: переводи в рубли. Не проси и не повторяй персональные данные без необходимости.',
    mode === 'guest'
      ? 'Ты не создаёшь и не отменяешь брони: для брони предложи кнопку «Забронировать».'
      : 'Ты только читаешь данные; изменения владелец делает в кабинете.',
  ].join('\n');
}

/** Ответ модели с инструментами своего режима; preloaded — результат роутера. */
export async function llmAnswer(
  cfg: LlmConfig,
  ctx: ToolContext,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  today: string,
  preloaded: { tool: string; result: unknown } | null,
): Promise<{ text: string; tools: string[] }> {
  const messages: Message[] = [{ role: 'system', content: systemPrompt(ctx.mode, ctx, today) }];
  if (preloaded) {
    messages.push({
      role: 'system',
      content: `Сервер уже выполнил ${preloaded.tool}: ${JSON.stringify(preloaded.result).slice(0, 6000)}`,
    });
  }
  messages.push(...history);
  const used: string[] = [];
  const tools = toolSpecs(ctx.mode);

  for (let i = 0; i < 4; i += 1) {
    const msg = await complete(cfg, messages, tools);
    if (!msg.tool_calls?.length) return { text: (msg.content ?? '').trim(), tools: used };
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let content: string;
      try {
        const args: unknown = JSON.parse(call.function.arguments || '{}');
        content = JSON.stringify(await runTool(ctx, call.function.name, args)).slice(0, 6000);
        used.push(call.function.name);
      } catch (e) {
        content = JSON.stringify({ error: e instanceof Error ? e.message : 'ошибка инструмента' });
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  const last = await complete(cfg, messages);
  return { text: (last.content ?? '').trim(), tools: used };
}

const jsonIntentSchema = z.object({
  intent: z.string().nullable(),
  args: z.record(z.string(), z.unknown()).default({}),
});

/** Fallback без tool calling: модель выбирает инструмент JSON-ом, исполняет сервер. */
export async function llmJsonIntent(
  cfg: LlmConfig,
  ctx: ToolContext,
  question: string,
  today: string,
): Promise<{ tool: string; args: unknown } | null> {
  const names = allowedTools(ctx.mode).join(', ');
  const msg = await complete(cfg, [
    {
      role: 'system',
      content: `${systemPrompt(ctx.mode, ctx, today)}\nВерни только JSON {"intent": одно из [${names}] или null, "args": {...}} без пояснений.`,
    },
    { role: 'user', content: question },
  ]);
  const raw = /\{[\s\S]*\}/.exec(msg.content ?? '')?.[0];
  if (!raw) return null;
  const parsed = jsonIntentSchema.safeParse(JSON.parse(raw));
  if (!parsed.success || !parsed.data.intent) return null;
  if (!allowedTools(ctx.mode).includes(parsed.data.intent as never)) return null;
  return { tool: parsed.data.intent, args: parsed.data.args };
}
