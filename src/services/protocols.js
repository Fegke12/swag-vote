/** Официальные протоколы: снимок итогов. PDF собирается в браузере из этих данных. */
import { now, pad, sha256 } from '../lib/util.js';

const posLine = (p) => [p.position_title, p.organization, p.division].filter(Boolean).join(' — ');

async function participantsSnapshot(db, v) {
  if (v.secret) {
    return (await db.all(`SELECT first_name, last_name, position_title, organization, division FROM participants
                          WHERE vote_id = ? AND has_voted = 1 ORDER BY last_name, first_name`, v.id))
      .map((p) => ({ name: `${p.first_name} ${p.last_name}`, position: posLine(p) }));
  }
  return (await db.all(`SELECT p.first_name, p.last_name, p.position_title, p.organization, p.division, b.choice, b.receipt_no, b.cast_at
                        FROM participants p JOIN ballots b ON b.participant_id = p.id WHERE p.vote_id = ? ORDER BY b.cast_at`, v.id))
    .map((p) => ({ name: `${p.first_name} ${p.last_name}`, position: posLine(p), choice: p.choice, receipt_no: p.receipt_no, cast_at: p.cast_at }));
}

async function buildData(db, v, s, number, createdAt) {
  const data = {
    number, created_at: createdAt,
    vote: {
      number: v.number, type: v.type, type_label: v.type_label, title: v.title, hint: v.hint,
      initiator: v.initiator, speaker_name: v.speaker_name, starts_at: v.starts_at, ends_at: v.ends_at,
      closed_at: v.closed_at, closed_early: v.closed_early, secret: v.secret, allow_abstain: v.allow_abstain,
    },
    results: {
      tally: s.tally, cast: s.cast, invited: s.invited, voted: s.voted, not_voted: s.not_voted, turnout: s.turnout,
      decision: s.evaluation.decision, quorum_met: s.evaluation.quorum_met, required_for: s.evaluation.required_for,
      rule_text: s.evaluation.rule_text, notes: s.evaluation.notes,
    },
    resolution: s.resolution,
    participants: await participantsSnapshot(db, v),
  };
  data.checksum = (await sha256(JSON.stringify(data))).slice(0, 32).toUpperCase();
  return data;
}

export async function create(db, v, s) {
  const existing = await db.first('SELECT * FROM protocols WHERE vote_id = ?', v.id);
  if (existing) return existing;
  const number = `П-${pad(await db.nextCounter('protocol_number', 1))}`;
  const createdAt = now();
  const data = await buildData(db, v, s, number, createdAt);
  await db.run('INSERT OR IGNORE INTO protocols(number, vote_id, data_json, created_at) VALUES (?,?,?,?)', number, v.id, JSON.stringify(data), createdAt);
  return db.first('SELECT * FROM protocols WHERE vote_id = ?', v.id);
}

/** Переформирование (после фиксации решения Спикером). Номер сохраняется. */
export async function refresh(db, v, s) {
  const p = await db.first('SELECT * FROM protocols WHERE vote_id = ?', v.id);
  if (!p) return create(db, v, s);
  const data = await buildData(db, v, s, p.number, now());
  await db.run('UPDATE protocols SET data_json = ?, created_at = ? WHERE id = ?', JSON.stringify(data), data.created_at, p.id);
  return p;
}

export async function forVote(db, voteId) {
  const p = await db.first('SELECT * FROM protocols WHERE vote_id = ?', voteId);
  return p ? { id: p.id, number: p.number, created_at: p.created_at, data: JSON.parse(p.data_json) } : null;
}
