/** Today's date for the system prompt, so the model knows "now". */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Sunday, November 15, 2026" in the phone's local time zone. */
export function formatDateLong(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function dateSentence(d: Date): string {
  return `Today is ${formatDateLong(d)}.`;
}

/** The system prompt with today's date appended (or just the date, if the prompt is empty). */
export function withDate(systemPrompt: string, d: Date): string {
  const p = systemPrompt.trim();
  return p ? `${p}\n\n${dateSentence(d)}` : dateSentence(d);
}
