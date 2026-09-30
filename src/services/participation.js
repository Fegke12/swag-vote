'use strict';
/**
 * Сторона участника: доступ по приглашению, идентификация, регистрация голоса.
 * Все проверки выполняются здесь, на сервере; браузер присылает только выбор.
 */
const crypto = require('crypto');
const { db, now, nextCounter, pad } = require('../db');
const { E, str, bool, sha256, randomToken, nameKey } = require('../util');
const { POSITIONS, CHOICES } = require('./catalog');
const votes = require('./votes');
const invites = require('./invites');
const events = require('./events');

function positionLine(p) {
  return [p.position_title, p.organization, p.division].filter(Boolean).join(' — ');
}

function participantBySession(voteId, token) {
  if (!token) return null;
  return db.prepare('SELECT * FROM participants WHERE vote_id = ? AND session_hash = ?').get(voteId, sha256(token)) || null;
}

/** Найти приглашение и голосование. Бросает понятную ошибку, если ссылка недействительна. */
function resolve(code) {
  const inv = invites.byCode(code);
  if (!inv) throw E.INVITE_INVALID();
  const vote = votes.get(inv.vote_id);
  if (!vote) throw E.INVITE_INVALID();
  return { inv, vote };
}

/** Проверка, можно ли по приглашению пройти идентификацию нового участника. */
function assertCanJoin(inv, vote) {
  if (inv.revoked_at) throw E.INVITE_REVOKED();
  if (vote.status === 'cancelled') throw E.VOTE_CANCELLED();
  if (vote.status === 'closed') throw E.VOTE_CLOSED();
  if (Date.now() >= Date.parse(inv.expires_at)) throw E.INVITE_EXPIRED();
  if (inv.max_uses != null && inv.uses >= inv.max_uses) throw E.INVITE_EXHAUSTED();
}

function publicVote(v) {
  const parent = v.parent_id ? db.prepare('SELECT number, title FROM votes WHERE id = ?').get(v.parent_id) : null;
  return {
    number: v.number, type: v.type, type_label: v.type_label,
    title: v.title, hint: v.hint, description: v.description,
    has_body: !!v.body.trim(),
    initiator: v.initiator, speaker_name: v.speaker_name,
    starts_at: v.starts_at, ends_at: v.ends_at, closed_at: v.closed_at, closed_early: v.closed_early,
    status: v.status, status_label: v.status_label, status_long: v.status_long,
    secret: v.secret, allow_abstain: v.allow_abstain, allow_comments: v.allow_comments,
    show_results: v.show_results,
    rule_text: v.rule_text,
    relation: v.relation, parent,
    revision: db.prepare('SELECT MAX(revision_no) m FROM bill_revisions WHERE vote_id = ?').get(v.id).m || 1,
    attachments: db.prepare('SELECT id, title, url FROM attachments WHERE vote_id = ? ORDER BY id').all(v.id),
    cancel_reason: v.cancel_reason,
  };
}

/** Итоги для участника — только после завершения и только если Спикер разрешил. */
function publicResults(v) {
  if (v.status !== 'closed' || !v.show_results) return null;
  const s = votes.summary(v);
  const out = {
    tally: s.tally, cast: s.cast, invited: s.invited, voted: s.voted, not_voted: s.not_voted, turnout: s.turnout,
    decision: s.evaluation.decision, rule_text: s.evaluation.rule_text, required_for: s.evaluation.required_for,
    quorum_met: s.evaluation.quorum_met, resolution: s.resolution,
    protocol: db.prepare('SELECT number, created_at FROM protocols WHERE vote_id = ?').get(v.id) || null,
    voters: null,
  };
  if (v.show_voter_list) {
    out.voters = v.secret
      ? db.prepare(`SELECT first_name || ' ' || last_name AS name, position_title, organization, division FROM participants
                    WHERE vote_id = ? AND has_voted = 1 ORDER BY last_name, first_name`).all(v.id)
          .map((p) => ({ name: p.name, position: positionLine(p) }))
      : db.prepare(`SELECT p.first_name || ' ' || p.last_name AS name, p.position_title, p.organization, p.division, b.choice
                    FROM participants p JOIN ballots b ON b.participant_id = p.id
                    WHERE p.vote_id = ? ORDER BY p.last_name, p.first_name`).all(v.id)
          .map((p) => ({ name: p.name, position: positionLine(p), choice: p.choice }));
  }
  return out;
}

function presentParticipant(p, vote) {
  if (!p) return { identified: false };
  return {
    identified: true,
    name: `${p.first_name} ${p.last_name}`,
    position: positionLine(p),
    has_voted: !!p.has_voted,
    voted_at: p.voted_at,
    receipt_no: vote.secret ? null : p.receipt_no,   // в тайном голосовании номер не хранится за участником
  };
}

/** Состояние страницы голосования для участника. */
function state(code, token) {
  let inv, vote;
  try { ({ inv, vote } = resolve(code)); }
  catch (e) { return { ok: false, error: errorPayload(e) }; }

  const p = participantBySession(vote.id, token);
  const base = { vote: publicVote(vote), participant: presentParticipant(p, vote), server_time: now() };

  if (inv.revoked_at && !p) return { ok: false, error: errorPayload(E.INVITE_REVOKED()), ...base, vote: null };
  if (vote.status === 'cancelled') return { ok: false, error: errorPayload(E.VOTE_CANCELLED()), ...base };
  if (vote.status === 'closed') {
    return { ok: false, error: errorPayload(p?.has_voted ? E.ALREADY_VOTED() : E.VOTE_CLOSED()), closed: true, ...base, results: publicResults(vote) };
  }
  if (!p) {
    try { assertCanJoin(inv, vote); }
    catch (e) { return { ok: false, error: errorPayload(e), ...base, vote: e.code === 'INVITE_EXHAUSTED' ? base.vote : null }; }
  }
  return { ok: true, ...base };
}

function errorPayload(e) {
  if (e && e.code) return { code: e.code, title: e.title, message: e.human, ...(e.extra || {}) };
  return { code: 'INTERNAL', title: 'Внутренняя ошибка', message: 'Повторите попытку позже.' };
}

/** Идентификация участника. Возвращает токен сессии участника (кладётся в httpOnly cookie). */
function identify(code, input, { deviceId, existingToken }) {
  const { inv, vote } = resolve(code);

  const already = participantBySession(vote.id, existingToken);
  if (already) return { token: existingToken, participant: presentParticipant(already, vote) };

  assertCanJoin(inv, vote);

  const first = str(input.first_name, { max: 60, required: true, label: 'Имя', field: 'first_name' });
  const last = str(input.last_name, { max: 60, required: true, label: 'Фамилия', field: 'last_name' });
  const kind = String(input.position_kind || '');
  if (!POSITIONS[kind]) throw E.VALIDATION('Выберите должность.', 'position_kind');
  let title = POSITIONS[kind];
  let org = '', div = '';
  if (kind === 'custom') {
    title = str(input.position_title, { max: 120, required: true, label: 'Должность', field: 'position_title' });
    org = str(input.organization, { max: 120, label: 'Департамент / организация', field: 'organization' });
    div = str(input.division, { max: 120, label: 'Подразделение / отдел', field: 'division' });
  } else {
    org = str(input.organization, { max: 120, required: true, label: 'Департамент / организация', field: 'organization' });
    div = str(input.division, { max: 120, required: kind === 'leader' || kind === 'deputy', label: 'Подразделение / отдел', field: 'division' });
  }
  if (!bool(input.confirm)) throw E.VALIDATION('Подтвердите достоверность указанных сведений.', 'confirm');

  const key = nameKey(first, last);
  if (key.length < 3) throw E.VALIDATION('Укажите полные имя и фамилию.', 'last_name');
  const deviceHash = deviceId ? sha256(deviceId) : null;
  const token = randomToken();

  const participant = db.transaction(() => {
    const invNow = invites.byId(inv.id);
    assertCanJoin(invNow, vote);
    const dup = db.prepare('SELECT has_voted FROM participants WHERE vote_id = ? AND name_key = ?').get(vote.id, key);
    if (dup) throw dup.has_voted ? E.ALREADY_VOTED() : E.NAME_TAKEN();
    if (invNow.one_per_device && deviceHash &&
        db.prepare('SELECT 1 FROM participants WHERE vote_id = ? AND device_hash = ?').get(vote.id, deviceHash)) {
      throw E.DEVICE_USED();
    }
    // Атомарно занимаем место в лимите приглашения
    const upd = db.prepare(`UPDATE invites SET uses = uses + 1 WHERE id = ? AND (max_uses IS NULL OR uses < max_uses)`).run(inv.id);
    if (upd.changes !== 1) throw E.INVITE_EXHAUSTED();
    const r = db.prepare(`INSERT INTO participants(vote_id, invite_id, first_name, last_name, position_kind, position_title,
        organization, division, name_key, session_hash, device_hash, identified_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(vote.id, inv.id, first, last, kind, title, org, div, key, sha256(token), deviceHash, now());
    const p = db.prepare('SELECT * FROM participants WHERE id = ?').get(r.lastInsertRowid);
    events.audit('participant', `P-${p.id}`, 'participant.identified', vote.id, { name: `${first} ${last}`, position: positionLine(p), invite: inv.code });
    return p;
  })();

  return { token, participant: presentParticipant(participant, vote) };
}

/** Регистрация голоса. */
function cast(code, token, choiceRaw) {
  const { vote } = resolve(code);
  const choice = String(choiceRaw || '');
  if (!CHOICES[choice]) throw E.VALIDATION('Выберите вариант решения.', 'choice');

  const p = participantBySession(vote.id, token);
  if (vote.status === 'cancelled') throw E.VOTE_CANCELLED();
  if (vote.status === 'closed') throw E.VOTE_CLOSED();
  if (!p) throw E.NOT_IDENTIFIED();
  if (p.has_voted) throw E.ALREADY_VOTED();
  if (vote.status === 'pending') throw E.VOTE_PENDING(vote.starts_at);
  if (choice === 'abstain' && !vote.allow_abstain) throw E.ABSTAIN_DISABLED();

  const result = db.transaction(() => {
    // Повторная проверка статуса внутри транзакции (защита от гонки с завершением)
    const fresh = votes.hydrate(votes.getRow(vote.id));
    if (fresh.status !== 'active') throw fresh.status === 'cancelled' ? E.VOTE_CANCELLED() : E.VOTE_CLOSED();
    const ts = now();
    const mark = db.prepare('UPDATE participants SET has_voted = 1, voted_at = ? WHERE id = ? AND has_voted = 0').run(ts, p.id);
    if (mark.changes !== 1) throw E.ALREADY_VOTED();

    let receipt;
    if (vote.secret) {
      // Тайное голосование: бюллетень не связан с участником; случайный id и номер исключают сопоставление по порядку
      for (;;) {
        receipt = String(crypto.randomInt(100000, 999999));
        if (!db.prepare('SELECT 1 FROM ballots WHERE receipt_no = ?').get(receipt)) break;
      }
      let id;
      for (;;) { id = crypto.randomInt(1, 2 ** 47); if (!db.prepare('SELECT 1 FROM ballots WHERE id = ?').get(id)) break; }
      db.prepare('INSERT INTO ballots(id, vote_id, receipt_no, choice, participant_id, cast_at) VALUES (?,?,?,?,NULL,NULL)')
        .run(id, vote.id, receipt, choice);
    } else {
      receipt = pad(nextCounter('ballot_receipt', 1));
      db.prepare('INSERT INTO ballots(vote_id, receipt_no, choice, participant_id, cast_at) VALUES (?,?,?,?,?)')
        .run(vote.id, receipt, choice, p.id, ts);
      db.prepare('UPDATE participants SET receipt_no = ? WHERE id = ?').run(receipt, p.id);
    }
    // В журнал и уведомления выбор тайного голосования не попадает
    events.audit('participant', `P-${p.id}`, 'ballot.cast', vote.id, vote.secret ? { secret: true } : { receipt, choice });
    events.notify({ audience: 'participant', voteId: vote.id, participantId: p.id, kind: 'ballot', title: 'Ваш голос зарегистрирован', body: `Идентификатор голоса: #${receipt}` });
    events.notify({ audience: 'speaker', voteId: vote.id, kind: 'ballot', title: 'Новый участник проголосовал', body: `${p.first_name} ${p.last_name} · голосование № ${vote.number}` });
    return { receipt_no: receipt, voted_at: ts };
  })();

  return { ...result, choice: vote.secret ? null : choice };
}

// ---------- обсуждение ----------

function listComments(voteId) {
  return db.prepare('SELECT id, author_label, body, created_at FROM comments WHERE vote_id = ? AND hidden = 0 ORDER BY id').all(voteId);
}

function addComment(code, token, bodyRaw) {
  const { vote } = resolve(code);
  if (!vote.allow_comments) throw E.FORBIDDEN('Обсуждение для этого голосования не открыто.');
  if (vote.status === 'closed' || vote.status === 'cancelled') throw E.FORBIDDEN('Обсуждение закрыто.');
  const p = participantBySession(vote.id, token);
  if (!p) throw E.NOT_IDENTIFIED();
  const body = str(bodyRaw, { max: 2000, required: true, label: 'Комментарий' });
  const recent = db.prepare(`SELECT COUNT(*) c FROM comments WHERE participant_id = ? AND created_at > ?`).get(p.id, new Date(Date.now() - 60000).toISOString()).c;
  if (recent >= 5) throw E.RATE_LIMIT();
  const label = `${p.first_name} ${p.last_name}${positionLine(p) ? ' · ' + positionLine(p) : ''}`;
  db.prepare('INSERT INTO comments(vote_id, participant_id, author_label, body, created_at) VALUES (?,?,?,?,?)').run(vote.id, p.id, label, body, now());
  events.audit('participant', `P-${p.id}`, 'comment.added', vote.id, {});
  return listComments(vote.id);
}

module.exports = { resolve, state, identify, cast, participantBySession, publicResults, positionLine, listComments, addComment, errorPayload };
