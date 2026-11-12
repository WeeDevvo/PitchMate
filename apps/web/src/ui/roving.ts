/**
 * Arrow-key movement for a one-tab-stop group (tabs, radio-style segments):
 * the index the key moves to among the enabled items, wrapping at the ends,
 * or `null` when the key isn't a movement key.
 */
export function nextRovingIndex(key: string, current: number, enabled: readonly boolean[]): number | null {
  const order = enabled.flatMap((isEnabled, index) => (isEnabled ? [index] : []));
  if (order.length === 0) return null;

  const position = Math.max(order.indexOf(current), 0);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return order[(position + 1) % order.length];
    case 'ArrowLeft':
    case 'ArrowUp':
      return order[(position - 1 + order.length) % order.length];
    case 'Home':
      return order[0];
    case 'End':
      return order[order.length - 1];
    default:
      return null;
  }
}
