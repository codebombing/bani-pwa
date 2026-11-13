import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { VStack } from '@astryxdesign/core/VStack';
import { Icon } from '@astryxdesign/core/Icon';
import { useEffect, type ReactNode, type SVGProps } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { askOwner } from '../ai/aiApi';
import { AssistantFab } from '../ai/AssistantFab';
import { useOwner } from './ownerContext';

// Короткие подписи без иконок: на 375 px длинные («Календарь», «Статистика») обрезаются.
const svg = (d: string) =>
  function TabIcon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        <path d={d} />
      </svg>
    );
  };

// Иконки вместо подписей (подпись остаётся для экранных читалок и подсказки).
const TABS = [
  { value: '', label: 'График', icon: svg('M4 6h16v14H4zM4 10h16M9 3v4M15 3v4') },
  {
    value: 'bookings',
    label: 'Брони',
    icon: svg('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'),
  },
  { value: 'stats', label: 'Отчёт', icon: svg('M4 20V10M10 20V4M16 20v-7M22 20H2') },
  { value: 'more', label: 'Ещё', icon: svg('M5 12h.01M12 12h.01M19 12h.01') },
] as const;

/** Оболочка кабинета: контент + нижняя навигация (4 раздела с подписями). */
export function OwnerShell({ children }: { children: ReactNode }) {
  const { tenant } = useOwner();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const base = `/s/${tenant.slug}/owner`;
  const current =
    pathname
      .replace(base, '')
      .replace(/^\/|\/$/g, '')
      .split('/')[0] ?? '';
  const active = TABS.some((t) => t.value === current) ? current : '';

  // Кабинет — свой, более спокойный фон (global.css, html[data-area='owner']).
  useEffect(() => {
    document.documentElement.dataset.area = 'owner';
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
            <SegmentedControl
              label="Разделы кабинета"
              layout="fill"
              size="sm"
              value={active}
              onChange={(value) => navigate(value ? `${base}/${value}` : `${base}/`)}
            >
              {TABS.map((t) => (
                <SegmentedControlItem
                  key={t.value}
                  value={t.value}
                  label={t.label}
                  icon={<Icon icon={t.icon} size="lg" />}
                  isLabelHidden
                />
              ))}
            </SegmentedControl>
          </LayoutFooter>
        }
      />
      <AssistantFab mode="owner" ask={(turns) => askOwner(tenant.slug, turns)} />
    </VStack>
  );
}
