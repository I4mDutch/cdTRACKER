import { UNAVAILABLE, UNAVAILABLE_TITLE } from '../format';

/** Renders formatted text; the "unavailable" dash gets an explanatory tooltip. */
export function Val({ text }: { text: string }) {
  if (text === UNAVAILABLE) {
    return (
      <span title={UNAVAILABLE_TITLE} aria-label={UNAVAILABLE_TITLE}>
        {UNAVAILABLE}
      </span>
    );
  }
  return <>{text}</>;
}
