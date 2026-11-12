import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { askOwner } from '../ai/aiApi';
import { AssistantFab } from '../ai/AssistantFab';
import { useOwner } from './ownerContext';

// Короткие подписи без иконок: на 375 px длинные («Календарь», «Статистика») обрезаются.
const TABS = [
  { value: '', label: 'График' },
  { value: 'bookings', label: 'Брони' },
  { value: 'stats', label: 'Отчёт' },
  { value: 'more', label: 'Ещё' },
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
                <SegmentedControlItem key={t.value} value={t.value} label={t.label} />
              ))}
            </SegmentedControl>
          </LayoutFooter>
        }
      />
      <AssistantFab mode="owner" ask={(turns) => askOwner(tenant.slug, turns)} />
    </VStack>
  );
}
