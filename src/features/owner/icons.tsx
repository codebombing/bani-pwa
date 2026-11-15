import type { SVGProps } from "react";

/** Линейная иконка 24×24 в стиле кабинета; dot — красная точка «есть новое». */
export const svg = (d: string, dot = false) =>
  function LineIcon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        <path d={d} />
        {dot && <circle cx="20" cy="4" r="4" fill="var(--color-error)" stroke="none" />}
      </svg>
    );
  };

const LIST = "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01";
export const ListIcon = svg(LIST);
export const ListIconDot = svg(LIST, true);
export const CalendarIcon = svg("M4 6h16v14H4zM4 10h16M9 3v4M15 3v4");
export const GearIcon = svg(
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
);
export const TrashIcon = svg("M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6");
