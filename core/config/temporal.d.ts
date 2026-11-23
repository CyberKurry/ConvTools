declare namespace Temporal {
  class Instant {
    static from(input: string): Instant;
    static fromEpochNanoseconds(ns: bigint): Instant;
    readonly epochNanoseconds: bigint;
    toString(): string;
    toZonedDateTimeISO(timeZone: string): ZonedDateTime;
  }

  class PlainDate {
    static from(input: string): PlainDate;
    toString(): string;
  }

  class PlainDateTime {
    static from(input: string, options?: { overflow?: 'constrain' | 'reject' }): PlainDateTime;
    static compare(a: PlainDateTime, b: PlainDateTime): number;
    toZonedDateTime(timeZone: string, options?: { disambiguation?: 'earlier' | 'later' | 'compatible' }): ZonedDateTime;
  }

  class ZonedDateTime {
    toInstant(): Instant;
    toPlainDateTime(): PlainDateTime;
    toString(): string;
  }

  const Now: {
    instant(): Instant;
    plainDateISO(): PlainDate;
  };
}

interface TemporalGlobal {
  Instant: typeof Temporal.Instant;
  PlainDate: typeof Temporal.PlainDate;
  PlainDateTime: typeof Temporal.PlainDateTime;
  Now: {
    instant(): Temporal.Instant;
    plainDateISO(): Temporal.PlainDate;
  };
}

interface GlobalThis {
  Temporal: TemporalGlobal;
}
