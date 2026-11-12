import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useMutation } from '@tanstack/react-query';

import { IOS_INSTALL_HINT, pushSupport, subscribePush, type PushSubscriptionBody } from './push';

/**
 * Включение push с честной логикой: на iPhone в Safari — инструкция установки вместо кнопки,
 * запрет в браузере — подсказка, без поддержки — ничего не обещаем.
 */
export function PushToggle({
  slug,
  label,
  description,
  save,
}: {
  slug: string;
  label: string;
  description: string;
  save: (sub: PushSubscriptionBody) => Promise<unknown>;
}) {
  const support = pushSupport();
  const enable = useMutation({
    mutationFn: async () => save(await subscribePush(slug)),
  });

  if (support === 'ios-install') return <Text color="secondary">{IOS_INSTALL_HINT}</Text>;
  if (support === 'unsupported') return null;
  if (support === 'denied') {
    return (
      <Text color="secondary">
        Уведомления запрещены для этого сайта — разрешите их в настройках браузера.
      </Text>
    );
  }
  if (enable.isSuccess) {
    return <Banner status="success" title="Уведомления включены" description={description} />;
  }
  return (
    <VStack gap={2}>
      <Button
        variant="secondary"
        label={label}
        isLoading={enable.isPending}
        onClick={() => enable.mutate()}
      />
      {enable.isError && (
        <Text color="secondary">
          {enable.error instanceof Error ? enable.error.message : 'Не удалось включить'}
        </Text>
      )}
    </VStack>
  );
}
