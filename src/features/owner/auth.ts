import type { Session } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { getSupabase } from "../../shared/supabase";

/** Сессия владельца: undefined — ещё загружается, null — не вошёл. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const supabase = getSupabase();
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return session;
}

/** Ссылка для входа на почту. Новых пользователей не создаёт: владельцев приглашает owner:invite. */
export async function sendMagicLink(email: string, slug: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${window.location.origin}/s/${slug}/owner/`,
    },
  });
  if (error) {
    // Supabase не раскрывает, есть ли такой пользователь, — отвечаем одинаково.
    if (/signups? not allowed|user not found/i.test(error.message)) return;
    throw new Error(
      /rate limit/i.test(error.message)
        ? "Слишком часто. Подождите минуту и попробуйте снова."
        : "Не удалось отправить ссылку. Попробуйте ещё раз.",
    );
  }
}

/** Вход по ссылке от owner:link (token_hash в #hash). */
export async function verifyLinkToken(tokenHash: string): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (error) throw new Error(error.message);
}

/** Выход: сессия, кэш запросов и приватные данные кабинета удаляются с устройства. */
export async function signOut(queryClient: QueryClient): Promise<void> {
  await getSupabase().auth.signOut({ scope: "local" });
  queryClient.clear();
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("bani:owner:")) sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage недоступен — нечего чистить.
  }
}
