/**
 * Helper centralizado para zona horaria de negocio.
 * Usa America/Mexico_City (equivale America/Monterrey UTC-6 sin DST actual)
 * y evita dependencia extra (luxon/dayjs) usando Intl.
 *
 * REGLAS:
 * - end_date son DATE (solo día) inclusivo: fin 27 activo todo el 27, vence el 28 00:00
 * - time_of_day son TIME "HH:MM" sin fecha ni TZ, siempre Monterrey
 * - scheduled_datetime se crea como today Monterrey + time_of_day Monterrey
 */

export const APP_TIMEZONE = 'America/Mexico_City';

export function nowInMonterrey(): Date {
  const now = new Date();
  const str = now.toLocaleString('en-US', { timeZone: APP_TIMEZONE });
  return new Date(str);
}

export function todayInMonterrey(): Date {
  const n = nowInMonterrey();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** Parsea "2026-08-27" o "2026-08-27T00:00:00.000Z" como Date local 00:00 (solo día) */
export function parseDateOnly(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    // Si viene de Prisma como Date (con 00:00Z), extrae solo YYYY-MM-DD en Monterrey
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value).split('-'); // YYYY-MM-DD
    const y = Number(parts[0]); const m = Number(parts[1]); const d = Number(parts[2]);
    return new Date(y, m - 1, d);
  }
  const s = String(value).trim();
  if (!s) return null;
  const datePart = s.split('T')[0].split(' ')[0];
  const [y, m, d] = datePart.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** "08:00" o "08:00:00" -> minutos 0-1439 */
export function timeStringToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Date de DB TIME (1970-01-01T08:00:00) -> minutos Monterrey */
export function timeDateToMinutes(time: Date): number {
  // Usa Intl para obtener hora en Monterrey, no getHours() del contenedor
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(time);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const mi = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return h * 60 + mi;
}

export function minutesToTimeString(min: number): string {
  const norm = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Crea Date para scheduled_datetime: today Monterrey + minutos Monterrey */
export function buildScheduledDatetime(today: Date, minutes: number): Date {
  const d = new Date(today.getTime());
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/** Compara solo días (ignora hora). Retorna true si a > b por día */
export function isAfterDay(a: Date, b: Date): boolean {
  const ad = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bd = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return ad.getTime() > bd.getTime();
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
