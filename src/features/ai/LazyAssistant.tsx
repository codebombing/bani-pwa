import { lazy, Suspense, type ComponentProps } from 'react';

// Чат-компоненты грузятся только когда помощника открыли.
const AssistantSheet = lazy(() =>
  import('./AssistantSheet').then((m) => ({ default: m.AssistantSheet })),
);

export function LazyAssistant(props: ComponentProps<typeof AssistantSheet>) {
  return (
    <Suspense fallback={null}>
      <AssistantSheet {...props} />
    </Suspense>
  );
}
