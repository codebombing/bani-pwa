// AI-ассистент: POST /ai-chat { mode: 'guest' | 'owner', slug, token?, messages }.
// guest — publishable-ключ (опционально токен своей брони); owner — JWT владельца,
// членство проверяется на сервере. Порядок:
//   1) роутер определяет намерение и сервер САМ выполняет инструмент своего режима;
//   2) если LLM настроен и бюджет есть — модель формулирует ответ (tool loop ≤ 4);
//   3) иначе / при ошибке провайдера — ответ из результата инструмента без LLM.
// Бронирование от ассистента не зависит: он только читает данные.
import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';
import { z } from 'zod';

import { route, todayIn } from '../_shared/ai/router.ts';
import { clientIp, fail, HttpError, json, readJson } from '../_shared/http.ts';
import { slugSchema } from '../_shared/schemas.ts';
import { TOKEN_RE, tokenHashBytea } from '../_shared/token.ts';
import { answerFromTool, HELP } from './answer.ts';
import { llmAnswer, llmConfig, llmJsonIntent, ToolsUnsupported } from './llm.ts';
import { runTool, type ToolContext } from './tools.ts';

type Ctx = Parameters<Parameters<typeof withSupabase>[1]>[1];

const bodySchema = z.object({
  mode: z.enum(['guest', 'owner']),
  slug: slugSchema,
  token: z.string().regex(TOKEN_RE).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(1000),
      }),
    )
    .min(1)
    .max(12),
});

const TENANT_DAILY = Number(Deno.env.get('LLM_TENANT_DAILY_REQUESTS') ?? 300);
const GLOBAL_DAILY = Number(Deno.env.get('LLM_GLOBAL_DAILY_REQUESTS') ?? 5000);

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 'Только POST');
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return fail('VALIDATION_ERROR', 'Некорректный запрос', parsed.error.issues);
  const body = parsed.data;

  const { data: rl, error: rlError } = await ctx.supabaseAdmin.rpc('consume_rate_limit', {
    p_key: `ai:ip:${clientIp(req) ?? 'unknown'}`,
    p_limit: 20,
    p_window: '1 minute',
  });
  if (rlError) throw rlError;
  if (rl !== true)
    return fail('RATE_LIMITED', 'Слишком много вопросов подряд, попробуйте через минуту');

  const { data: tenant, error: tErr } = await ctx.supabaseAdmin
    .from('public_tenants')
    .select('id, slug, name, timezone')
    .eq('slug', body.slug)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!tenant) return fail('TENANT_NOT_FOUND', 'Заведение не найдено');

  if (body.mode === 'owner') {
    const userId = ctx.jwtClaims?.sub;
    if (ctx.authMode !== 'user' || !userId) return fail('FORBIDDEN', 'Войдите в кабинет владельца');
    // Под RLS вызывающего: строка видна только самому члену заведения.
    const { data: member, error } = await ctx.supabase
      .from('tenant_members')
      .select('role')
      .eq('tenant_id', tenant.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!member) return fail('FORBIDDEN', 'Нет доступа к заведению');
  }

  const { data: halls, error: hErr } = await ctx.supabaseAdmin
    .from('public_halls')
    .select('id, key, name, min_duration_min')
    .eq('tenant_id', tenant.id)
    .order('sort');
  if (hErr) throw hErr;

  const toolCtx: ToolContext = {
    mode: body.mode,
    tenant,
    halls: halls ?? [],
    admin: ctx.supabaseAdmin,
    caller: ctx.supabase,
    tokenHash: body.mode === 'guest' && body.token ? await tokenHashBytea(body.token) : null,
  };
  const now = new Date();
  const today = todayIn(tenant.timezone, now);
  const question = body.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';

  // 1) Роутер + детерминированный инструмент.
  const intent = route(question, {
    mode: body.mode,
    timezone: tenant.timezone,
    now,
    halls: toolCtx.halls,
    hasBookingToken: toolCtx.tokenHash !== null,
  });
  let tool: string | null = intent.tool;
  let result: unknown = null;
  if (tool) {
    try {
      result = await runTool(toolCtx, tool, intent.args);
    } catch (e) {
      result = { error: e instanceof Error ? e.message : 'ошибка' };
    }
  }

  const reply = (answer: string, llm: boolean, reason: string | null) =>
    json({
      ok: true,
      answer,
      tool,
      llm,
      reason,
      actions: body.mode === 'guest' ? ['book'] : [],
    });

  // 2) LLM, если настроен и есть бюджет.
  const cfg = llmConfig();
  if (!cfg)
    return reply(answerFromTool(tool, result, body.mode, tenant.timezone), false, 'not_configured');

  const estimate = Math.ceil(body.messages.reduce((n, m) => n + m.content.length, 0) / 3) + 600;
  const budget = await ctx.supabaseAdmin.rpc('consume_llm_budget', {
    p_tenant_id: tenant.id,
    p_tokens: estimate,
    p_tenant_daily_requests: TENANT_DAILY,
    p_global_daily_requests: GLOBAL_DAILY,
  });
  if (budget.error || budget.data !== true) {
    const text = tool ? answerFromTool(tool, result, body.mode, tenant.timezone) : HELP[body.mode];
    return reply(
      `${text}\n\nПодробный ассистент сегодня недоступен — лимит запросов исчерпан.`,
      false,
      'budget',
    );
  }

  try {
    const out = await llmAnswer(cfg, toolCtx, body.messages, today, tool ? { tool, result } : null);
    if (!tool && out.tools.length) tool = out.tools[0] ?? null;
    if (out.text) return reply(out.text, true, null);
  } catch (e) {
    if (e instanceof ToolsUnsupported && !tool) {
      try {
        const picked = await llmJsonIntent(cfg, toolCtx, question, today);
        if (picked) {
          tool = picked.tool;
          result = await runTool(toolCtx, picked.tool, picked.args);
          return reply(
            answerFromTool(tool, result, body.mode, tenant.timezone),
            true,
            'json_fallback',
          );
        }
      } catch (inner) {
        console.error('ai-chat json fallback', inner);
      }
    } else {
      console.error('ai-chat llm', e);
    }
  }
  // 3) Провайдер недоступен — вежливо и с полезными данными, если они есть.
  const text = tool ? answerFromTool(tool, result, body.mode, tenant.timezone) : HELP[body.mode];
  return reply(text, false, 'provider_error');
}

export default {
  fetch: withSupabase({ auth: ['user', 'publishable'] }, async (req, ctx) => {
    try {
      return await handle(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.code, e.message, e.details);
      console.error('ai-chat error', e);
      return fail('SERVER_ERROR', 'Ассистент временно недоступен');
    }
  }),
};
