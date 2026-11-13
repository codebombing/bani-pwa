import '@fontsource/ruslan-display/cyrillic-400.css';

/**
 * Надпись-логотип заведения: крыша с перекрещенными коньками, труба с паром и название
 * старорусским шрифтом. Текст настраивается в business.json → theme.wordmark
 * ({ top, main, sub }); без настройки берётся из названия («Баня «Берёзка»» → «Баня» / «Берёзка»).
 */
export interface WordmarkText {
  top?: string;
  main?: string;
  sub?: string;
}

function fromName(name: string): Required<Pick<WordmarkText, 'main'>> & WordmarkText {
  const quoted = /^(.*?)[«"](.+?)[»"]\s*$/.exec(name.trim());
  if (quoted?.[2]) return { top: quoted[1]?.trim() || undefined, main: quoted[2] };
  return { main: name };
}

const INK = '#F3E4CF';
const WOOD = '#C9A27C';

export function Wordmark({ name, wordmark }: { name: string; wordmark?: WordmarkText }) {
  const base = fromName(name);
  const top = wordmark?.top ?? base.top;
  const main = wordmark?.main ?? base.main;
  const sub = wordmark?.sub;
  // Длинное название — меньше кегль, чтобы влезло в ширину 300.
  const mainSize = Math.min(54, Math.floor(300 / Math.max(1, main.length * 0.62)));
  const topSize = top ? Math.min(28, Math.floor(260 / Math.max(1, top.length * 0.6))) : 0;
  const height = 120 + (top ? topSize + 6 : 0) + mainSize + (sub ? 22 : 0);
  const yTop = 120 + topSize;
  const yMain = yTop + mainSize + (top ? 6 : 0);
  const ySub = yMain + 20;

  return (
    <svg
      viewBox={`0 0 320 ${height}`}
      width="100%"
      style={{ maxWidth: 320, display: 'block' }}
      role="img"
      aria-label={name}
    >
      <title>{name}</title>
      {/* крыша: два перекрещенных бревна с «коньками» */}
      <g stroke={WOOD} strokeWidth={13} strokeLinecap="round" fill="none">
        <path d="M60 112 L172 26" />
        <path d="M260 112 L148 26" />
      </g>
      <g fill={WOOD}>
        <path d="M172 26c8-8 18-10 26-4-6 1-10 4-12 9-4-3-9-4-14-5z" />
        <path d="M148 26c-8-8-18-10-26-4 6 1 10 4 12 9 4-3 9-4 14-5z" />
        <rect x={153} y={8} width={14} height={30} rx={3} />
        {/* труба */}
        <rect x={214} y={44} width={18} height={30} rx={2} />
      </g>
      <path
        d="M223 40c-8-8 8-12 0-20s8-12 0-18"
        stroke={INK}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        opacity={0.7}
      />
      {/* звёздочка-оберег под коньком */}
      <g fill={INK} transform="translate(160 64)">
        {[0, 60, 120].map((r) => (
          <ellipse key={r} rx={3} ry={9} transform={`rotate(${r})`} />
        ))}
      </g>
      <g fill={INK} textAnchor="middle" fontFamily="'Ruslan Display', serif">
        {top && (
          <text x={160} y={yTop} fontSize={topSize}>
            {top}
          </text>
        )}
        <text x={160} y={yMain} fontSize={mainSize}>
          {main}
        </text>
        {sub && (
          <text
            x={160}
            y={ySub}
            fontSize={12}
            fontFamily="system-ui, sans-serif"
            letterSpacing={2}
            opacity={0.85}
          >
            {sub.toUpperCase()}
          </text>
        )}
      </g>
    </svg>
  );
}
