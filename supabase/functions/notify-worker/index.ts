// Воркер уведомлений: pg_cron раз в минуту будит его через pg_net (apikey = секретный ключ).
// Задачи захватывает и фильтрует SQL (worker_claim_jobs): сюда приходят только активные
// брони live-заведений с подписками. Здесь — текст и отправка Web Push, затем результат в БД.
import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';
import webpush from 'web-push';
import { z } from 'zod';

import { json } from '../_shared/http.ts';

const jobSchema = z.object({
  id: z.uuid(),
  kind: z.enum([
    'booking_created',
    'reminder_24h',
    'reminder_2h',
    'booking_rescheduled',
    'booking_cancelled',
  ]),
  recipient: z.enum(['guest', 'owner']),
  tenant_slug: z.string(),
  tenant_name: z.string(),
  timezone: z.string(),
  hall_name: z.string(),
  start_at: z.string(),
  customer_name: z.string(),
  guests: z.number().int(),
  subscriptions: z.array(z.object({ endpoint: z.string(), p256dh: z.string(), auth: z.string() })),
});
type Job = z.infer<typeof jobSchema>;

function when(job: Job): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: job.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(job.start_at));
}

function message(job: Job): { title: string; body: string; url: string } {
  const at = `${job.hall_name}, ${when(job)}`;
  if (job.recipient === 'owner') {
    const title = {
      booking_created: 'Новая бронь',
      booking_rescheduled: 'Бронь перенесена',
      booking_cancelled: 'Бронь отменена',
      reminder_24h: 'Бронь завтра',
      reminder_2h: 'Бронь через 2 часа',
    }[job.kind];
    return {
      title,
      body: `${at} · ${job.customer_name}, гостей: ${job.guests}`,
      url: `/s/${job.tenant_slug}/owner/bookings`,
    };
  }
  const title = {
    booking_created: 'Бронь подтверждена',
    booking_rescheduled: 'Бронь перенесена',
    booking_cancelled: 'Бронь отменена',
    reminder_24h: 'Напоминание: бронь завтра',
    reminder_2h: 'Через 2 часа ждём вас',
  }[job.kind];
  return { title, body: `${job.tenant_name}: ${at}`, url: `/s/${job.tenant_slug}/` };
}

function vapidConfigured(): boolean {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return false;
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', pub, priv);
  return true;
}

async function sendJob(job: Job): Promise<{ ok: boolean; error?: string; gone: string[] }> {
  const payload = JSON.stringify(message(job));
  const gone: string[] = [];
  const errors: string[] = [];
  let delivered = 0;
  for (const sub of job.subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: job.kind.startsWith('reminder') ? 3600 : 86_400, urgency: 'high' },
      );
      delivered += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(sub.endpoint);
      else errors.push(`${status ?? 'ERR'} ${(e as Error).message}`.slice(0, 200));
    }
  }
  // Хотя бы одно устройство получило (или все подписки мертвы) — задача закрыта.
  if (delivered > 0 || errors.length === 0) return { ok: true, gone };
  return { ok: false, error: errors.join('; '), gone };
}

export default {
  fetch: withSupabase({ auth: 'secret' }, async (_req, ctx) => {
    const { data, error } = await ctx.supabaseAdmin.rpc('worker_claim_jobs', {
      p_limit: 50,
      p_lease: '2 minutes',
    });
    if (error) return json({ ok: false, error: error.message }, 500);
    const jobs = z.array(jobSchema).parse(data);
    if (jobs.length === 0) return json({ ok: true, sent: 0, failed: 0 });

    const ready = vapidConfigured();
    let sent = 0;
    let failed = 0;
    for (const job of jobs) {
      const result = ready
        ? await sendJob(job)
        : { ok: false, error: 'VAPID_NOT_CONFIGURED', gone: [] as string[] };
      const { error: completeError } = await ctx.supabaseAdmin.rpc('worker_complete_job', {
        p_job_id: job.id,
        p_ok: result.ok,
        p_error: result.error ?? null,
        p_gone_endpoints: result.gone,
      });
      if (completeError) console.error('worker_complete_job', job.id, completeError.message);
      if (result.ok) sent += 1;
      else failed += 1;
    }
    return json({ ok: true, sent, failed });
  }),
};
