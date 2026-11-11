import { EmptyState } from '@astryxdesign/core/EmptyState';
import { VStack } from '@astryxdesign/core/VStack';
import { useParams } from 'react-router';

/** Гостевое приложение заведения /s/:slug/*. Экраны бронирования — этап 5. */
export function GuestApp() {
  const { slug = '' } = useParams();
  return (
    <VStack padding={6} as="main">
      <EmptyState
        title="Онлайн-бронирование скоро заработает"
        description={`Заведение «${slug}»: экраны гостя появятся на этапе 5.`}
      />
    </VStack>
  );
}
