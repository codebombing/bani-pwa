import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { sendMagicLink } from './auth';
import { ownerErrorMessage } from './ownerApi';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage({ slug, tenantName }: { slug: string; tenantName?: string }) {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const send = useMutation({ mutationFn: () => sendMagicLink(email, slug) });
  const emailError = EMAIL_RE.test(email.trim())
    ? null
    : 'Введите почту, например owner@example.ru';

  return (
    <VStack as="main" padding={4} gap={6} maxWidth={480}>
      <VStack gap={2}>
        <Text color="secondary">{tenantName ?? 'Кабинет владельца'}</Text>
        <Heading level={1}>Вход в кабинет</Heading>
        <Text color="secondary">Пришлём ссылку для входа на почту владельца. Пароль не нужен.</Text>
      </VStack>

      {send.isSuccess ? (
        <VStack gap={3}>
          <Banner
            status="success"
            title="Ссылка отправлена"
            description={`Если ${email.trim()} есть среди владельцев, письмо придёт в течение минуты. Откройте ссылку на этом устройстве.`}
          />
          {import.meta.env.DEV && (
            <Link href="http://127.0.0.1:54324" isExternalLink>
              Локально письма приходят в Mailpit
            </Link>
          )}
          <Button variant="ghost" label="Отправить ещё раз" onClick={() => send.reset()} />
        </VStack>
      ) : (
        <VStack gap={4}>
          <TextInput
            label="Почта"
            type="email"
            value={email}
            autoComplete="email"
            isRequired
            onChange={setEmail}
            onEnter={() => {
              setTouched(true);
              if (!emailError) send.mutate();
            }}
            status={touched && emailError ? { type: 'error', message: emailError } : undefined}
          />
          {send.isError && (
            <Banner
              status="error"
              title="Не отправлено"
              description={ownerErrorMessage(send.error)}
            />
          )}
          <Button
            variant="primary"
            size="lg"
            width="100%"
            label="Получить ссылку для входа"
            isLoading={send.isPending}
            onClick={() => {
              setTouched(true);
              if (!emailError) send.mutate();
            }}
          />
          <Text color="secondary">Регистрации нет: доступ выдаёт администратор системы.</Text>
        </VStack>
      )}
    </VStack>
  );
}
