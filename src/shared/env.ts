import { z } from 'zod';

/** Публичные переменные фронтенда. Секреты (service role, LLM key) сюда не попадают никогда. */
const publicEnvSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function readPublicEnv(source: Record<string, unknown> = import.meta.env) {
  return publicEnvSchema.safeParse(source);
}
