import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { ApiError, publicApi, type QuoteInput } from './api';

/** 4xx — ответ по существу (нет брони, слот занят): не повторяем; сеть/5xx — один повтор. */
function retry(count: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return count < 1;
}

export const bookingKeys = {
  catalog: (slug: string) => ['public', slug, 'catalog'] as const,
  availability: (slug: string) => ['public', slug, 'availability'] as const,
  booking: (slug: string, token: string) => ['private', slug, 'booking', token] as const,
};

export function useCatalog(slug: string) {
  return useQuery({
    queryKey: bookingKeys.catalog(slug),
    queryFn: ({ signal }) => publicApi.catalog(slug, signal),
    staleTime: 60_000,
    retry,
  });
}

export function useAvailability(
  slug: string,
  params: { hall_id: string; date: string; duration_min: number } | null,
) {
  return useQuery({
    queryKey: [...bookingKeys.availability(slug), params],
    queryFn: ({ signal }) => {
      if (!params) throw new Error('availability: нет параметров');
      return publicApi.availability(slug, params, signal);
    },
    enabled: params !== null,
    staleTime: 15_000,
    retry,
  });
}

export function useQuote(slug: string, input: QuoteInput | null) {
  return useQuery({
    queryKey: ['public', slug, 'quote', input],
    queryFn: ({ signal }) => {
      if (!input) throw new Error('quote: нет параметров');
      return publicApi.quote(slug, input, signal);
    },
    enabled: input !== null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry,
  });
}

/** Приватные данные брони: не храним в кэше дольше, чем открыт экран. */
export function useBooking(slug: string, token: string) {
  return useQuery({
    queryKey: bookingKeys.booking(slug, token),
    queryFn: ({ signal }) => publicApi.booking(slug, token, signal),
    staleTime: 0,
    gcTime: 0,
    retry,
  });
}
