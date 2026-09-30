'use strict';
/** Фоновые задачи: начало голосований, предупреждение «осталось 30 минут», автозавершение и протоколы. */
const { db, now } = require('../db');
const votes = require('./votes');
const events = require('./events');

const WARN_MS = 30 * 60 * 1000;

function tick() {
  const t = now();
  const nowMs = Date.parse(t);

  // Началось
  for (const v of db.prepare(`SELECT id, number, title, ends_at FROM votes
      WHERE cancelled_at IS NULL AND closed_at IS NULL AND starts_at <= ? AND ends_at > ?`).all(t, t)) {
    if (events.markEvent(v.id, 'started')) {
      events.audit('system', 'scheduler', 'vote.started', v.id, {});
      events.notify({ audience: 'vote', voteId: v.id, kind: 'started', title: 'Голосование началось', body: `Голосование № ${v.number} открыто для приёма голосов.` });
    }
    // Осталось 30 минут
    const left = Date.parse(v.ends_at) - nowMs;
    if (left <= WARN_MS && left > 0 && events.markEvent(v.id, 'ending_soon')) {
      const min = Math.max(1, Math.round(left / 60000));
      events.notify({ audience: 'vote', voteId: v.id, kind: 'ending_soon', title: `До окончания голосования осталось ${min} мин.`, body: `Голосование № ${v.number}. Если вы ещё не проголосовали — сделайте это до окончания срока.` });
    }
  }

  // Завершение по сроку + протокол
  for (const row of db.prepare(`SELECT * FROM votes WHERE cancelled_at IS NULL AND closed_at IS NULL AND ends_at <= ?`).all(t)) {
    try { votes.finalizeIfDue(row); } catch (e) { console.error('[scheduler] finalize', row.id, e); }
  }
}

function start(intervalMs = 15000) {
  tick();
  const h = setInterval(() => { try { tick(); } catch (e) { console.error('[scheduler]', e); } }, intervalMs);
  h.unref();
  return h;
}

module.exports = { start, tick };
