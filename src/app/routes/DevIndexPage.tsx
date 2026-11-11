import { EmptyState } from '@astryxdesign/core/EmptyState';
import { VStack } from '@astryxdesign/core/VStack';

/** Служебная страница. Список опубликованных заведений из БД — этап 2. */
export function DevIndexPage() {
  return (
    <VStack padding={6} gap={4}>
      <EmptyState
        title="Откройте ссылку заведения"
        description="Адрес вида /s/название-заведения/ вам пришлёт заведение."
      />
    </VStack>
  );
}
