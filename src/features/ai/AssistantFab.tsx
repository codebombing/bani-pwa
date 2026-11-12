import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { useEffect, useState, type SVGProps } from 'react';

import type { AiReply, ChatTurn } from './aiApi';
import { LazyAssistant } from './LazyAssistant';

function SparkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z" />
      <path d="M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" opacity=".75" />
    </svg>
  );
}

/**
 * Круглая кнопка помощника справа внизу поверх всего: мягко «дышит», не перекрывает
 * действия. По нажатию остальное размывается (html[data-assistant]) и открывается чат.
 */
export function AssistantFab({
  mode,
  ask,
  onBook,
}: {
  mode: 'guest' | 'owner';
  ask: (turns: ChatTurn[]) => Promise<AiReply>;
  onBook?: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (open) root.dataset.assistant = 'open';
    else delete root.dataset.assistant;
    return () => {
      delete root.dataset.assistant;
    };
  }, [open]);

  return (
    <>
      {!open && (
        <aside className="assistant-fab" aria-label="Помощник">
          <IconButton
            label={mode === 'guest' ? 'Помощник: время и цены' : 'Помощник: брони и деньги'}
            tooltip="Помощник"
            icon={<Icon icon={SparkIcon} />}
            variant="primary"
            size="lg"
            elevation="med"
            onClick={() => setOpen(true)}
          />
        </aside>
      )}
      {open && (
        <LazyAssistant
          mode={mode}
          ask={ask}
          onBook={
            onBook
              ? () => {
                  setOpen(false);
                  onBook();
                }
              : undefined
          }
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
