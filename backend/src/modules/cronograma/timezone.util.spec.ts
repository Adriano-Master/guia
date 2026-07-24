import {
  addDays,
  isValidIanaTimezone,
  wallDateNow,
  wallMinutesNow,
  weekdayOf,
  zonedTimeToUtc,
} from './timezone.util';

describe('timezone.util (unit) — ADR-03: janelas locais persistem em UTC', () => {
  describe('zonedTimeToUtc', () => {
    it('08:00 em America/Sao_Paulo (UTC-3, sem DST) → 11:00Z', () => {
      const utc = zonedTimeToUtc({ year: 2026, month: 7, day: 6 }, 8 * 60, 'America/Sao_Paulo');
      expect(utc.toISOString()).toBe('2026-07-06T11:00:00.000Z');
    });

    it('14:00 em America/Sao_Paulo → 17:00Z', () => {
      const utc = zonedTimeToUtc({ year: 2026, month: 7, day: 6 }, 14 * 60, 'America/Sao_Paulo');
      expect(utc.toISOString()).toBe('2026-07-06T17:00:00.000Z');
    });

    it('timezone UTC é identidade', () => {
      const utc = zonedTimeToUtc({ year: 2026, month: 7, day: 6 }, 8 * 60, 'UTC');
      expect(utc.toISOString()).toBe('2026-07-06T08:00:00.000Z');
    });

    it('America/New_York respeita DST: verão (EDT, -4) e inverno (EST, -5)', () => {
      const verao = zonedTimeToUtc({ year: 2026, month: 7, day: 6 }, 8 * 60, 'America/New_York');
      expect(verao.toISOString()).toBe('2026-07-06T12:00:00.000Z');

      const inverno = zonedTimeToUtc({ year: 2026, month: 1, day: 6 }, 8 * 60, 'America/New_York');
      expect(inverno.toISOString()).toBe('2026-01-06T13:00:00.000Z');
    });

    it('meia-noite local e último minuto do dia não trocam de dia local', () => {
      const inicio = zonedTimeToUtc({ year: 2026, month: 7, day: 6 }, 0, 'America/Sao_Paulo');
      expect(inicio.toISOString()).toBe('2026-07-06T03:00:00.000Z');
      const fim = zonedTimeToUtc({ year: 2026, month: 7, day: 6 }, 23 * 60 + 59, 'America/Sao_Paulo');
      expect(fim.toISOString()).toBe('2026-07-07T02:59:00.000Z');
    });
  });

  describe('wallDateNow / weekdayOf / addDays', () => {
    it('wallDateNow devolve a data local do timezone, não a UTC', () => {
      // 01:00Z de 7/jul = 22:00 de 6/jul em São Paulo
      const ref = new Date('2026-07-07T01:00:00Z');
      expect(wallDateNow('America/Sao_Paulo', ref)).toEqual({ year: 2026, month: 7, day: 6 });
      expect(wallDateNow('UTC', ref)).toEqual({ year: 2026, month: 7, day: 7 });
    });

    it('wallMinutesNow devolve os minutos locais desde 00:00 (usado para pular janelas de hoje já encerradas)', () => {
      const ref = new Date('2026-07-06T12:00:00Z'); // 09:00 em São Paulo
      expect(wallMinutesNow('America/Sao_Paulo', ref)).toBe(9 * 60);
      expect(wallMinutesNow('UTC', ref)).toBe(12 * 60);
      // 02:59Z de 7/jul = 23:59 de 6/jul em São Paulo (véspera, último minuto)
      expect(wallMinutesNow('America/Sao_Paulo', new Date('2026-07-07T02:59:00Z'))).toBe(1439);
    });

    it('weekdayOf: 2026-07-06 é segunda (1); 2026-07-05 é domingo (0)', () => {
      expect(weekdayOf({ year: 2026, month: 7, day: 6 })).toBe(1);
      expect(weekdayOf({ year: 2026, month: 7, day: 5 })).toBe(0);
    });

    it('addDays atravessa mês e ano corretamente', () => {
      expect(addDays({ year: 2026, month: 7, day: 31 }, 7)).toEqual({
        year: 2026,
        month: 8,
        day: 7,
      });
      expect(addDays({ year: 2026, month: 12, day: 29 }, 7)).toEqual({
        year: 2027,
        month: 1,
        day: 5,
      });
    });
  });

  describe('isValidIanaTimezone', () => {
    it('aceita identificadores IANA válidos', () => {
      expect(isValidIanaTimezone('America/Sao_Paulo')).toBe(true);
      expect(isValidIanaTimezone('UTC')).toBe(true);
    });

    it('rejeita identificadores inválidos', () => {
      expect(isValidIanaTimezone('Marte/Cratera')).toBe(false);
      expect(isValidIanaTimezone('')).toBe(false);
    });
  });
});
