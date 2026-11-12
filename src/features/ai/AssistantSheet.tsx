import { BottomSheet } from '@astryxdesign/core/BottomSheet';
import { Button } from '@astryxdesign/core/Button';
import {
  ChatComposer,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
} from '@astryxdesign/core/Chat';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import type { AiReply, ChatTurn } from './aiApi';

const SUGGESTIONS = {
  guest: [
    'Что свободно завтра?',
    'Сколько стоит в субботу в 18:00 на 3 часа?',
    'Когда у меня бронь?',
  ],
  owner: ['Кто сегодня придёт?', 'Сколько заработали за неделю?', 'Сколько денег ожидается?'],
} as const;

/**
 * Чат с ассистентом в BottomSheet. Ассистент только читает данные: бронировать гость
 * продолжает обычной кнопкой (onBook), а без LLM ответы строятся по данным сервера.
 */
export function AssistantSheet({
  mode,
  ask,
  onBook,
  onClose,
}: {
  mode: 'guest' | 'owner';
  ask: (turns: ChatTurn[]) => Promise<AiReply>;
  onBook?: () => void;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [lastReply, setLastReply] = useState<AiReply | null>(null);
  const send = useMutation({
    mutationFn: ask,
    onSuccess: (reply) => {
      setLastReply(reply);
      setTurns((t) => [...t, { role: 'assistant', content: reply.answer }]);
    },
  });

  const submit = (text: string) => {
    const content = text.trim();
    if (!content || send.isPending) return;
    const next: ChatTurn[] = [...turns, { role: 'user', content }];
    setTurns(next);
    send.mutate(next);
  };

  return (
    <BottomSheet
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      label="Помощник"
      height="70dvh"
    >
      <VStack gap={3} height="100%">
        <HStack gap={2} vAlign="center" justify="between">
          <Text weight="semibold">Помощник</Text>
          <Button variant="ghost" size="sm" label="Закрыть" onClick={onClose} />
        </HStack>

        {turns.length === 0 ? (
          <VStack gap={2}>
            <Text color="secondary">
              {mode === 'guest'
                ? 'Спросите про свободное время и цены. Забронировать можно в пару нажатий кнопкой «Забронировать».'
                : 'Спросите про брони, деньги и загрузку. Помощник только читает данные.'}
            </Text>
            {SUGGESTIONS[mode].map((s) => (
              <Button key={s} variant="secondary" size="sm" label={s} onClick={() => submit(s)} />
            ))}
          </VStack>
        ) : (
          <ChatMessageList align="top" density="compact" isStreaming={send.isPending}>
            {[
              ...turns.map((t, i) => (
                <ChatMessage key={i} sender={t.role}>
                  <ChatMessageBubble>
                    <VStack gap={1}>
                      {t.content.split('\n').map((line, j) => (
                        <Text key={j}>{line}</Text>
                      ))}
                    </VStack>
                  </ChatMessageBubble>
                </ChatMessage>
              )),
              ...(send.isPending
                ? [
                    <ChatMessage key="pending" sender="assistant">
                      <ChatMessageBubble variant="ghost">Смотрю…</ChatMessageBubble>
                    </ChatMessage>,
                  ]
                : []),
              ...(send.isError
                ? [
                    <ChatMessage key="error" sender="system">
                      <ChatMessageBubble variant="ghost">
                        {send.error instanceof Error ? send.error.message : 'Не получилось'}
                      </ChatMessageBubble>
                    </ChatMessage>,
                  ]
                : []),
            ]}
          </ChatMessageList>
        )}

        {lastReply && !lastReply.llm && lastReply.reason !== 'not_configured' && (
          <Text color="secondary">
            Подробный ассистент сейчас недоступен — показываю данные напрямую.
          </Text>
        )}
        {mode === 'guest' && onBook && turns.length > 0 && (
          <Button variant="primary" label="Забронировать" onClick={onBook} />
        )}
        <ChatComposer placeholder="Ваш вопрос…" isDisabled={send.isPending} onSubmit={submit} />
      </VStack>
    </BottomSheet>
  );
}
