import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Item } from "@astryxdesign/core/Item";
import { List } from "@astryxdesign/core/List";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";

import {
  addDays,
  formatDateLong,
  formatRub,
  formatTimeInTz,
  todayInTz,
  zonedDayRange,
} from "../../shared/format";
import { OwnerBookingSheet } from "./OwnerBookingSheet";
import { ownerApi, ownerErrorMessage } from "./ownerApi";
import { ownerKey, useOwner } from "./ownerContext";
import { bookingKind, guestsLabel, KIND_DOT } from "./labels";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Календарь дня по залам: брони и блокировки. */
export function CalendarPage() {
  const { tenant, halls } = useOwner();
  const tz = tenant.timezone;
  const today = todayInTz(tz);
  const [params, setParams] = useSearchParams();
  const raw = params.get("d");
  const date = raw && DATE_RE.test(raw) ? raw : today;
  const setDate = (d: string) => setParams(d === today ? {} : { d });
  const range = zonedDayRange(date, tz);

  const [openId, setOpenId] = useState<string | null>(null);

  const bookings = useQuery({
    queryKey: ownerKey(tenant.id, "day", date, "bookings"),
    queryFn: () => ownerApi.bookings(tenant.id, range.from, range.to),
  });
  const blocks = useQuery({
    queryKey: ownerKey(tenant.id, "day", date, "blocks"),
    queryFn: () => ownerApi.blocks(tenant.id, range.from, range.to),
  });
  const opened = bookings.data?.find((b) => b.id === openId) ?? null;
  const loading = bookings.isPending || blocks.isPending;
  const error = bookings.error ?? blocks.error;

  return (
    <VStack as="main" padding={4} gap={4} maxWidth={720}>
      <HStack justify="between" vAlign="center" gap={2}>
        <Button
          variant="ghost"
          label="Предыдущий день"
          isIconOnly
          icon={<Icon icon="chevronLeft" />}
          onClick={() => setDate(addDays(date, -1))}
        />
        <VStack gap={0.5} hAlign="center">
          <Heading level={1}>{date === today ? "Сегодня" : formatDateLong(date)}</Heading>
          {date === today && <Text color="secondary">{formatDateLong(date)}</Text>}
        </VStack>
        <Button
          variant="ghost"
          label="Следующий день"
          isIconOnly
          icon={<Icon icon="chevronRight" />}
          onClick={() => setDate(addDays(date, 1))}
        />
      </HStack>
      {date !== today && (
        <Button
          variant="secondary"
          size="sm"
          label="К сегодняшнему дню"
          onClick={() => setDate(today)}
        />
      )}

      {error && (
        <Banner
          status="error"
          title="Не удалось загрузить календарь"
          description={ownerErrorMessage(error)}
          endContent={
            <Button
              label="Повторить"
              onClick={() => {
                void bookings.refetch();
                void blocks.refetch();
              }}
            />
          }
        />
      )}

      {halls.map((hall) => {
        const hallBookings = (bookings.data ?? []).filter((b) => b.hall_id === hall.id);
        const hallBlocks = (blocks.data ?? []).filter((b) => b.hallId === hall.id);
        return (
          <Card key={hall.id} padding={4}>
            <VStack gap={3}>
              <Heading level={2}>{hall.name}</Heading>

              {loading ? (
                <Skeleton height={56} />
              ) : hallBookings.length === 0 && hallBlocks.length === 0 ? (
                <Text color="secondary">Броней нет</Text>
              ) : (
                <List hasDividers>
                  {hallBookings.map((b) => {
                    const kind = bookingKind(b);
                    const time = `${formatTimeInTz(b.start_at, tz)}–${formatTimeInTz(b.end_at, tz)} · ${b.customer_name}`;
                    return (
                      <Item
                        key={b.id}
                        label={
                          kind === "past" ? (
                            <Text color="secondary">{time}</Text>
                          ) : (
                            <Text weight={kind === "new" ? "semibold" : undefined}>{time}</Text>
                          )
                        }
                        description={`${guestsLabel(b.guests)} · ${formatRub(b.total_amount)}`}
                        startContent={<StatusDot {...KIND_DOT[kind]} />}
                        onClick={() => setOpenId(b.id)}
                      />
                    );
                  })}
                  {hallBlocks.map((bl) => (
                    <Item
                      key={bl.occupancyId}
                      label={`${formatTimeInTz(bl.from, tz)}–${formatTimeInTz(bl.to, tz)} · закрыто`}
                      description={bl.reason}
                      startContent={<StatusDot variant="neutral" label="Блокировка" />}
                    />
                  ))}
                </List>
              )}
            </VStack>
          </Card>
        );
      })}

      {opened && (
        <OwnerBookingSheet
          booking={opened}
          hallName={halls.find((h) => h.id === opened.hall_id)?.name ?? "Зал"}
          onClose={() => setOpenId(null)}
        />
      )}
    </VStack>
  );
}
