import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { useEffect, useState, type SVGProps } from 'react';

import type { AiReply, ChatTurn } from './aiApi';
import { LazyAssistant } from './LazyAssistant';

/** Берёзовый веник; класс venik-swing — периодический «взмах» (global.css). */
function VenikIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <g className="venik-swing">
        <path d="M4.5 20.5 L10 13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <g fill="currentColor">
          <ellipse cx="14" cy="8.5" rx="5.2" ry="7" transform="rotate(38 14 8.5)" />
          <ellipse
            cx="10.6"
            cy="9.4"
            rx="2.4"
            ry="4"
            transform="rotate(12 10.6 9.4)"
            opacity=".75"
          />
          <ellipse
            cx="16.6"
            cy="12.6"
            rx="2.4"
            ry="4"
            transform="rotate(64 16.6 12.6)"
            opacity=".75"
          />
        </g>
      </g>
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
            icon={<Icon icon={VenikIcon} />}
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
