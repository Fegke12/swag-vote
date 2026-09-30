/** Фоновые задачи (Cron Trigger раз в минуту): начало, «осталось 30 минут», автозавершение и протоколы. */
import { now } from '../lib/util.js';
import * as votes from './votes.js';
import { audit, notify, markEvent } from './events.js';

const WARN_MS = 30 * 60 * 1000;

export async function tick(db) {
  const t = now();
  const nowMs = Date.parse(t);

  for (const v of await db.all(`SELECT id, number, ends_at FROM votes
      WHERE cancelled_at IS NULL AND closed_at IS NULL AND starts_at <= ? AND ends_at > ?`, t, t)) {
    if (await markEvent(db, v.id, 'started')) {
      await audit(db, 'system', 'scheduler', 'vote.started', v.id, {});
      await notify(db, { audience: 'vote', voteId: v.id, kind: 'started', title: 'Голосование началось', body: `Голосование № ${v.number} открыто для приёма голосов.` });
    }
    const left = Date.parse(v.ends_at) - nowMs;
    if (left <= WARN_MS && left > 0 && await markEvent(db, v.id, 'ending_soon')) {
      const min = Math.max(1, Math.round(left / 60000));
      await notify(db, { audience: 'vote', voteId: v.id, kind: 'ending_soon', title: `До окончания голосования осталось ${min} мин.`,
        body: `Голосование № ${v.number}. Если вы ещё не проголосовали — сделайте это до окончания срока.` });
    }
  }

  await votes.finalizeDue(db);

  // Уборка: истёкшие сессии и счётчики ограничения частоты
  await db.batch([
    db.stmt('DELETE FROM sessions WHERE expires_at < ?', t),
    db.stmt('DELETE FROM rate_limits WHERE reset_at < ?', nowMs),
  ]);
}
