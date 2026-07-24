/**
 * Conversão de horário local (timezone IANA) → UTC usando apenas a Intl API
 * (ADR-03: persistir UTC, sem dependência de biblioteca de timezone).
 */

export interface WallDate {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timezone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timezone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(timezone, dtf);
  }
  return dtf;
}

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    getFormatter(timezone);
    return true;
  } catch {
    return false;
  }
}

/** Partes da data/hora local (wall clock) de um instante UTC no timezone dado. */
function wallParts(instant: Date, timezone: string): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const { type, value } of getFormatter(timezone).formatToParts(instant)) {
    if (type !== 'literal') {
      parts[type] = Number(value);
    }
  }
  return parts;
}

/** Offset (ms) do timezone em relação ao UTC no instante dado (leste = positivo). */
function tzOffsetMs(utcTs: number, timezone: string): number {
  const p = wallParts(new Date(utcTs), timezone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - utcTs;
}

/** Data local (wall clock) "de hoje" no timezone dado. */
export function wallDateNow(timezone: string, ref: Date = new Date()): WallDate {
  const p = wallParts(ref, timezone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Minutos desde 00:00 do horário local (wall clock) atual no timezone dado. */
export function wallMinutesNow(timezone: string, ref: Date = new Date()): number {
  const p = wallParts(ref, timezone);
  return p.hour * 60 + p.minute;
}

/** Dia da semana (0=Dom … 6=Sáb) de uma data local. */
export function weekdayOf(date: WallDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** Soma dias a uma data local (aritmética puramente de calendário). */
export function addDays(date: WallDate, days: number): WallDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Instante UTC correspondente a (data local + minutos desde 00:00) no timezone.
 * Duas passadas de offset cobrem transições de DST; horário local inexistente
 * (spring forward) é mapeado para o instante com o offset pós-transição.
 */
export function zonedTimeToUtc(date: WallDate, minutesOfDay: number, timezone: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, 0, minutesOfDay);
  const offset1 = tzOffsetMs(guess, timezone);
  let ts = guess - offset1;
  const offset2 = tzOffsetMs(ts, timezone);
  if (offset2 !== offset1) {
    ts = guess - offset2;
  }
  return new Date(ts);
}
