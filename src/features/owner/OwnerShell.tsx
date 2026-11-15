import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { VStack } from "@astryxdesign/core/VStack";
import { useQuery } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";

import { askOwner } from "../ai/aiApi";
import { AssistantFab } from "../ai/AssistantFab";
import { CalendarIcon, GearIcon, ListIcon, ListIconDot } from "./icons";
import { ownerApi } from "./ownerApi";
import { ownerKey, useOwner } from "./ownerContext";

/** Оболочка кабинета: контент + нижняя навигация из квадратных кнопок-иконок. */
export function OwnerShell({ children }: { children: ReactNode }) {
  const { tenant } = useOwner();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const base = `/s/${tenant.slug}/owner`;
  const current =
    pathname
      .replace(base, "")
      .replace(/^\/|\/$/g, "")
      .split("/")[0] ?? "";

  // Красная точка на «Бронях», пока есть непрочитанные онлайн-брони.
  const unseen = useQuery({
    queryKey: ownerKey(tenant.id, "unseen"),
    queryFn: () => ownerApi.unseenCount(tenant.id),
    refetchInterval: 60_000,
  });
  const hasNew = (unseen.data ?? 0) > 0;

  const tabs = [
    {
      value: "",
      alias: "bookings",
      label: hasNew ? "Брони, есть новые" : "Брони",
      icon: hasNew ? ListIconDot : ListIcon,
    },
    { value: "calendar", label: "График", icon: CalendarIcon },
    { value: "settings", label: "Настройки", icon: GearIcon },
  ];

  // Кабинет — свой, более спокойный фон (global.css, html[data-area='owner']).
  useEffect(() => {
    document.documentElement.dataset.area = "owner";
    return () => {
      delete document.documentElement.dataset.area;
    };
  }, []);

  return (
    <VStack height="100dvh">
      <Layout
        height="fill"
        content={
          <LayoutContent isScrollable padding={0} label={tenant.name}>
            {children}
          </LayoutContent>
        }
        footer={
          <LayoutFooter padding={2} hasDivider label="Разделы кабинета">
            <HStack as="nav" justify="around" vAlign="center">
              {tabs.map((t) => {
                const active = current === t.value || current === t.alias;
                return (
                  <IconButton
                    key={t.value}
                    size="lg"
                    variant={active ? "secondary" : "ghost"}
                    label={t.label}
                    tooltip={t.label}
                    icon={<Icon icon={t.icon} size="lg" />}
                    onClick={() => navigate(t.value ? `${base}/${t.value}` : `${base}/`)}
                  />
                );
              })}
            </HStack>
          </LayoutFooter>
        }
      />
      <AssistantFab mode="owner" ask={(turns) => askOwner(tenant.slug, turns)} />
    </VStack>
  );
}
