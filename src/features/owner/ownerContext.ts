import type { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import type { OwnerHall, OwnerTenant } from "./ownerApi";

export interface OwnerCtx {
  tenant: OwnerTenant;
  halls: OwnerHall[];
  email: string;
  role: "owner" | "staff";
}

export const OwnerContext = createContext<OwnerCtx | null>(null);

export function useOwner(): OwnerCtx {
  const ctx = useContext(OwnerContext);
  if (!ctx) throw new Error("useOwner вне кабинета владельца");
  return ctx;
}

/** Все приватные запросы кабинета — под этим префиксом (очищаются при выходе). */
export const ownerKey = (tenantId: string, ...rest: unknown[]) =>
  ["private", "owner", tenantId, ...rest] as const;

/**
 * После изменения: ждём только брони/блокировки (быстро), а свободное время
 * (get_availability — цена каждого слота) обновляем в фоне.
 */
export async function refreshOwnerData(queryClient: QueryClient, tenantId: string): Promise<void> {
  const isSlots = (key: readonly unknown[]) => key.includes("free") || key.includes("move");
  void queryClient.invalidateQueries({
    queryKey: ownerKey(tenantId),
    predicate: (q) => isSlots(q.queryKey),
  });
  // refetchType 'all': списки других вкладок (Брони/График) тоже перезагружаются
  // сразу, а не показывают старый статус при переключении.
  await queryClient.invalidateQueries({
    queryKey: ownerKey(tenantId),
    predicate: (q) => !isSlots(q.queryKey),
    refetchType: "all",
  });
}
