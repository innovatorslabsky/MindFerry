/** A date and time in the person's own locale, or nothing when the value is not a date. */
export function whenLabel(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}
