/** Обёртка над Cloudflare D1. Весь доступ к базе идёт через неё. */
import { SCHEMA, SCHEMA_VERSION } from './schema.js';

const clean = (a) => a.map((x) => (x === undefined ? null : typeof x === 'boolean' ? (x ? 1 : 0) : x));

export class Db {
  constructor(d1) { this.d1 = d1; }
  stmt(sql, ...a) { return this.d1.prepare(sql).bind(...clean(a)); }
  first(sql, ...a) { return this.stmt(sql, ...a).first(); }
  async all(sql, ...a) { return (await this.stmt(sql, ...a).all()).results || []; }
  run(sql, ...a) { return this.stmt(sql, ...a).run(); }
  /** Несколько операторов в одной транзакции: либо все, либо ни одного. */
  batch(stmts) { return this.d1.batch(stmts.filter(Boolean)); }

  async nextCounter(name, start = 1) {
    const r = await this.first(
      `INSERT INTO counters(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`, name, start);
    return r.value;
  }
}

let schemaReady = null;

/** Применить схему один раз на экземпляр воркера (идемпотентно). */
export function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      const v = await db.first(`SELECT value FROM counters WHERE name = 'schema_version'`).catch(() => null);
      if (v && v.value >= SCHEMA_VERSION) return;
      await db.batch(SCHEMA.map((s) => db.d1.prepare(s)));
      await db.run(`INSERT INTO counters(name, value) VALUES ('schema_version', ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value`, SCHEMA_VERSION);
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

/** Распознать ошибки, которые выбрасывают триггеры и ограничения базы. */
export function dbErrorCode(e) {
  const m = String(e?.message || e?.cause?.message || '');
  if (m.includes('SWAG_VOTE_NOT_ACTIVE')) return 'VOTE_NOT_ACTIVE';
  if (m.includes('SWAG_ALREADY_VOTED')) return 'ALREADY_VOTED';
  if (m.includes('SWAG_INVITE_UNAVAILABLE')) return 'INVITE_UNAVAILABLE';
  if (m.includes('UNIQUE constraint failed: participants.vote_id, participants.name_key')) return 'NAME_TAKEN';
  if (m.includes('UNIQUE constraint failed: ballots.participant_id')) return 'ALREADY_VOTED';
  if (m.includes('UNIQUE constraint failed')) return 'UNIQUE';
  return null;
}
