import { Avatar } from '@astryxdesign/core/Avatar';
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
import { useEffect, useRef, useState } from 'react';

import type { AiReply, ChatTurn } from './aiApi';
import banshikUrl from './banshik.svg';

const NAME = 'Банщик';

// Шапка и поле ввода прилипают к краям шторки, лента прокручивается между ними.
const STICKY_TOP = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  paddingBlock: 'var(--spacing-2, 8px)',
  background: 'var(--color-background-popover)',
} as const;
const STICKY_BOTTOM = {
  position: 'sticky',
  bottom: 0,
  zIndex: 1,
  paddingBlock: 'var(--spacing-2, 8px)',
  background: 'var(--color-background-popover)',
} as const;

const GREETING = {
  guest:
    'Привет! Я Банщик 🌿 Соберётесь попариться — подскажу, когда свободно, сколько стоит, и помогу записаться в пару касаний.',
  owner:
    'Привет! Я Банщик. Расскажу, кто сегодня придёт, сколько заработали и что ожидается, найду бронь по имени или телефону.',
} as const;

const SUGGESTIONS = {
  guest: [
    'Что свободно завтра вечером?',
    'Сколько стоит в субботу в 18:00 на 3 часа?',
    'Когда у меня бронь?',
  ],
  owner: ['Кто сегодня придёт?', 'Сколько заработали за неделю?', 'Сколько денег ожидается?'],
} as const;

function Lines({ text }: { text: string }) {
  return (
    <VStack gap={1}>
      {text.split('\n').map((line, j) => (
        <Text key={j}>{line}</Text>
      ))}
    </VStack>
  );
}

/**
 * Чат с помощником в BottomSheet: шапка с аватаром, прокручиваемая лента над полем ввода.
 * Помощник только читает данные: бронирует гость обычной кнопкой (onBook).
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
  const listRef = useRef<HTMLDivElement>(null);
  const send = useMutation({
    mutationFn: ask,
    onSuccess: (reply) => {
      setLastReply(reply);
      setTurns((t) => [...t, { role: 'assistant', content: reply.answer }]);
    },
  });

  // Новое сообщение — лента прокручивается вниз.
  useEffect(() => {
    listRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length, send.isPending]);

  const submit = (text: string) => {
    const content = text.trim();
    if (!content || send.isPending) return;
    const next: ChatTurn[] = [...turns, { role: 'user', content }];
    setTurns(next);
    send.mutate(next);
  };

  const bot = (key: string, body: React.ReactNode, ghost = false) => (
    <ChatMessage
      key={key}
      sender="assistant"
      avatar={<Avatar src={banshikUrl} name={NAME} size="sm" />}
    >
      <ChatMessageBubble variant={ghost ? 'ghost' : 'filled'}>{body}</ChatMessageBubble>
    </ChatMessage>
  );

  return (
    <BottomSheet
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      label="Помощник Банщик"
      height="75dvh"
    >
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" justify="between" style={STICKY_TOP}>
          <HStack gap={2} vAlign="center">
            <Avatar src={banshikUrl} name={NAME} size="lg" />
            <VStack gap={0}>
              <Text weight="semibold">{NAME}</Text>
              <Text color="secondary">{send.isPending ? 'думает…' : 'на связи'}</Text>
            </VStack>
          </HStack>
          <Button variant="ghost" size="sm" label="Закрыть" onClick={onClose} />
        </HStack>

        {/* Лента с фиксированной высотой: прокручивается сама, поле ввода всегда видно. */}
        <ChatMessageList
          ref={listRef}
          align="top"
          density="compact"
          isStreaming={send.isPending}
          style={{ scrollMarginBottom: 160 }}
        >
          {[
            bot('greeting', <Text>{GREETING[mode]}</Text>),
            ...turns.map((t, i) =>
              t.role === 'assistant' ? (
                bot(String(i), <Lines text={t.content} />)
              ) : (
                <ChatMessage key={i} sender="user">
                  <ChatMessageBubble>
                    <Lines text={t.content} />
                  </ChatMessageBubble>
                </ChatMessage>
              ),
            ),
            ...(turns.length === 0
              ? [
                  <VStack key="suggestions" gap={2}>
                    {SUGGESTIONS[mode].map((s) => (
                      <Button
                        key={s}
                        variant="secondary"
                        size="sm"
                        label={s}
                        onClick={() => submit(s)}
                      />
                    ))}
                  </VStack>,
                ]
              : []),
            ...(send.isPending ? [bot('pending', 'Смотрю…', true)] : []),
            ...(send.isError
              ? [
                  bot(
                    'error',
                    send.error instanceof Error
                      ? send.error.message
                      : 'Не получилось, попробуйте ещё раз',
                    true,
                  ),
                ]
              : []),
          ]}
        </ChatMessageList>

        <VStack gap={2} style={STICKY_BOTTOM}>
          {lastReply && !lastReply.llm && lastReply.reason !== 'not_configured' && (
            <Text color="secondary">
              Подробный помощник сейчас недоступен — показываю данные напрямую.
            </Text>
          )}
          {mode === 'guest' && onBook && turns.length > 0 && (
            <Button variant="secondary" size="sm" label="Записаться" onClick={onBook} />
          )}
          <ChatComposer
            placeholder="Спросите Банщика…"
            isDisabled={send.isPending}
            onSubmit={submit}
          />
        </VStack>
      </VStack>
    </BottomSheet>
  );
}
