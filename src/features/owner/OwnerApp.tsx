import { EmptyState } from '@astryxdesign/core/EmptyState';
import { VStack } from '@astryxdesign/core/VStack';
import { useParams } from 'react-router';

/** Кабинет владельца /s/:slug/owner/*. Вход и календарь — этап 6. */
export function OwnerApp() {
  const { slug = '' } = useParams();
  return (
    <VStack padding={6} as="main">
      <EmptyState
        title="Кабинет владельца"
        description={`Заведение «${slug}»: вход и календарь появятся на этапе 6.`}
      />
    </VStack>
  );
}
