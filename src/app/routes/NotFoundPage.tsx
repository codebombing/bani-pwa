import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { VStack } from '@astryxdesign/core/VStack';

export function NotFoundPage() {
  return (
    <VStack padding={6}>
      <EmptyState
        title="Страница не найдена"
        description="Проверьте ссылку — возможно, в ней опечатка."
        actions={<Button label="На главную" href="/" />}
      />
    </VStack>
  );
}
