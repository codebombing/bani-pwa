import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/VStack';
import { isRouteErrorResponse, useRouteError } from 'react-router';

export function RouteErrorPage() {
  const error = useRouteError();
  const description = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Неизвестная ошибка';
  return (
    <VStack padding={6}>
      <Banner
        status="error"
        title="Что-то пошло не так"
        description={description}
        endContent={<Button label="Обновить" onClick={() => window.location.reload()} />}
      />
    </VStack>
  );
}
