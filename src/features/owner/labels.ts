import type { OwnerBooking } from "./ownerApi";

/** В кабинете бронь различается только цветом: новая (не открывали), предстоит, прошла. */
export type BookingKind = "new" | "upcoming" | "past";

export function bookingKind(
  b: Pick<OwnerBooking, "end_at" | "seen_at" | "status">,
  now = Date.now(),
): BookingKind {
  if (b.status === "completed" || b.status === "no_show" || Date.parse(b.end_at) <= now) {
    return "past";
  }
  return b.seen_at ? "upcoming" : "new";
}

export const KIND_DOT: Record<
  BookingKind,
  { variant: "accent" | "success" | "neutral"; label: string }
> = {
  new: { variant: "accent", label: "новая" },
  upcoming: { variant: "success", label: "предстоит" },
  past: { variant: "neutral", label: "прошла" },
};

export const SOURCE_LABEL: Record<OwnerBooking["source"], string> = {
  online: "онлайн",
  phone: "по телефону",
  messenger: "мессенджер",
  walk_in: "на месте",
  owner: "владелец",
};

export function guestsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} гость`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} гостя`;
  return `${n} гостей`;
}
