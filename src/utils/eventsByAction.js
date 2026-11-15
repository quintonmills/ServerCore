export function eventsByAction(events) {
  const keyedEvents = [];
  const usedKeys = new Set();
  const entries = events instanceof Map
    ? [...events.values()]
    : Array.isArray(events) ? events : Object.values(events || {});
  for (const [index, event] of entries.entries()) {
    const label = [
      event.action,
      event.type,
      event.playerId,
    ].find((value) => typeof value === 'string' && value.trim())
      ?.trim()
      .replace(/[.$\0]/g, '_') || `event ${index + 1}`;
    let key = label;
    let suffix = 2;
    while (usedKeys.has(key)) {
      key = `${label} (${suffix})`;
      suffix += 1;
    }
    usedKeys.add(key);
    keyedEvents.push([key, event]);
  }
  return Object.fromEntries(keyedEvents);
}
