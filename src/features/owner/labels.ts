import type { OwnerBooking } from './ownerApi';

export const STATUS_LABEL: Record<OwnerBooking['status'], string> = {
  pending: 'ждёт подтверждения',
  confirmed: 'подтверждена',
  completed: 'гости пришли',
  cancelled: 'отменена',
  no_show: 'не пришли',
};

export const STATUS_VARIANT: Record<
  OwnerBooking['status'],
  'success' | 'warning' | 'error' | 'neutral' | 'accent'
> = {
  pending: 'warning',
  confirmed: 'accent',
  completed: 'success',
  cancelled: 'error',
  no_show: 'neutral',
};

export const SOURCE_LABEL: Record<OwnerBooking['source'], string> = {
  online: 'онлайн',
  phone: 'по телефону',
  messenger: 'мессенджер',
  walk_in: 'на месте',
  owner: 'владелец',
};

export function guestsLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} гость`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} гостя`;
  return `${n} гостей`;
}
