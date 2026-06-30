// Money helpers. The API returns Money as { minor, currency } (integer minor units).
export function money(minor: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format((minor || 0) / 100);
}
export function minorOf(m: any): number {
  if (m == null) return 0;
  if (typeof m === 'number') return m;
  return m.minor ?? 0;
}
