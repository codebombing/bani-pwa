import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Стек шагов, синхронизированный с историей браузера: каждый шаг вперёд — pushState,
 * системная кнопка «Назад» (popstate) возвращает на предыдущий шаг, а не уводит со страницы.
 */
export function useStepHistory<S extends string>(initial: S, onClosed: () => void) {
  const [stack, setStack] = useState<S[]>([initial]);
  const depth = useRef(0);
  const afterUnwind = useRef<(() => void) | null>(null);
  const onClosedRef = useRef(onClosed);

  useEffect(() => {
    onClosedRef.current = onClosed;
  }, [onClosed]);

  useEffect(() => {
    // Первый шаг тоже кладём в историю — Back закрывает поток, оставаясь на странице.
    window.history.pushState({ bookingFlow: true }, '');
    depth.current = 1;

    const onPop = () => {
      if (afterUnwind.current) {
        const cb = afterUnwind.current;
        afterUnwind.current = null;
        depth.current = 0;
        cb();
        return;
      }
      depth.current = Math.max(0, depth.current - 1);
      setStack((s) => {
        const next = s.slice(0, -1);
        if (next.length === 0) queueMicrotask(() => onClosedRef.current());
        return next;
      });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const push = useCallback((step: S) => {
    window.history.pushState({ bookingFlow: true }, '');
    depth.current += 1;
    setStack((s) => [...s, step]);
  }, []);

  const back = useCallback(() => window.history.back(), []);

  /** Вернуться к уже пройденному шагу (например, к выбору времени после SLOT_TAKEN). */
  const backTo = useCallback(
    (step: S) => {
      const idx = stack.lastIndexOf(step);
      if (idx < 0) return;
      const n = stack.length - 1 - idx;
      if (n > 0) window.history.go(-n);
    },
    [stack],
  );

  /** Закрыть поток, убрав свои записи из истории, затем выполнить cb (например, навигацию). */
  const close = useCallback((cb?: () => void) => {
    const n = depth.current;
    setStack([]);
    if (n === 0) {
      (cb ?? onClosedRef.current)();
      return;
    }
    afterUnwind.current = () => {
      if (cb) cb();
      onClosedRef.current();
    };
    window.history.go(-n);
  }, []);

  return { step: stack[stack.length - 1] ?? null, index: stack.length, push, back, backTo, close };
}
