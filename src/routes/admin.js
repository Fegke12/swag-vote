'use strict';
/** API панели Спикера Конгресса. */
const express = require('express');
const QRCode = require('qrcode');
const { db, now } = require('../db');
const { E, str, int } = require('../util');
const auth = require('../services/auth');
const votes = require('../services/votes');
const invites = require('../services/invites');
const events = require('../services/events');
const protocols = require('../services/protocols');
const markdown = require('../services/markdown');
const documents = require('../services/documents');
const participation = require('../services/participation');
const { CHOICES } = require('../services/catalog');
const { limit } = require('../http');
const { sendPdf } = require('./public');

const router = express.Router();
const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;
const id = (req, name = 'id') => int(req.params[name], { min: 1, max: 1e12, label: 'Идентификатор' });

// ---------- авторизация ----------

router.post('/auth/login', limit('login', 10, 5 * 60_000), (req, res) => {
  const { token, user } = auth.login(req.body?.login, req.body?.password);
  res.cookie(auth.COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.COOKIE_SECURE === '1', path: '/', maxAge: auth.SESSION_TTL_MS });
  res.json({ ok: true, user });
});

router.post('/auth/logout', (req, res) => {
  auth.logout(req.cookies[auth.COOKIE], auth.userBySession(req.cookies[auth.COOKIE]));
  res.clearCookie(auth.COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  res.json({ user: auth.userBySession(req.cookies[auth.COOKIE]) });
});

// Всё ниже — только для Спикера
router.use('/admin', auth.requireSpeaker);

router.get('/admin/dashboard', (req, res) => res.json(votes.dashboard()));

router.get('/admin/votes', (req, res) => {
  res.json({ items: votes.list({
    status: str(req.query.status, { max: 20 }), type: str(req.query.type, { max: 20 }),
    q: str(req.query.q, { max: 200 }), from: req.query.from || '', to: req.query.to || '',
  }) });
});

router.post('/admin/votes', (req, res) => {
  const { vote, invite } = votes.create(req.body || {}, req.user, { invite: req.body?.invite || {} });
  res.status(201).json({ ok: true, vote, invite: invites.present(invite, vote, baseUrl(req)) });
});

/** Карточка голосования для Спикера. */
router.get('/admin/votes/:id', (req, res) => {
  const v = votes.mustGet(id(req));
  const s = votes.summary(v);
  // В тайном голосовании промежуточный подсчёт скрыт до завершения: иначе по уведомлениям
  // «участник проголосовал» можно было бы сопоставить человека и изменение счёта.
  const hideTally = v.secret && v.status !== 'closed';
  const participants = db.prepare(`
    SELECT p.*, b.choice AS choice FROM participants p
    LEFT JOIN ballots b ON b.participant_id = p.id
    WHERE p.vote_id = ? ORDER BY p.has_voted DESC, p.voted_at, p.identified_at`).all(v.id)
    .map((p) => ({
      id: p.id, name: `${p.first_name} ${p.last_name}`, position_kind: p.position_kind, position_title: p.position_title,
      organization: p.organization, division: p.division, has_voted: !!p.has_voted,
      identified_at: p.identified_at, voted_at: p.voted_at,
      choice: v.secret ? null : p.choice, receipt_no: v.secret ? null : p.receipt_no,
    }));
  const rel = (vid) => vid ? db.prepare('SELECT id, number, title FROM votes WHERE id = ?').get(vid) : null;
  res.json({
    vote: v,
    summary: hideTally ? { ...s, tally: null, cast: null, evaluation: { ...s.evaluation, decision: null, required_for: null } } : s,
    tally_hidden: hideTally,
    invites: invites.listForVote(v.id).map((i) => invites.present(i, v, baseUrl(req))),
    participants,
    revisions: db.prepare('SELECT revision_no, note, created_at FROM bill_revisions WHERE vote_id = ? ORDER BY revision_no DESC').all(v.id),
    attachments: db.prepare('SELECT id, title, url, created_at FROM attachments WHERE vote_id = ? ORDER BY id').all(v.id),
    comments: db.prepare('SELECT id, author_label, body, hidden, created_at FROM comments WHERE vote_id = ? ORDER BY id').all(v.id),
    protocol: protocols.forVote(v.id),
    parent: rel(v.parent_id),
    children: db.prepare('SELECT id, number, title, relation FROM votes WHERE parent_id = ? ORDER BY id').all(v.id),
    log: events.listAudit({ voteId: v.id, limit: 200 }),
  });
});

router.patch('/admin/votes/:id', (req, res) => res.json({ ok: true, vote: votes.update(id(req), req.body || {}, req.user) }));
router.post('/admin/votes/:id/close', (req, res) => res.json({ ok: true, vote: votes.closeEarly(id(req), req.user) }));
router.post('/admin/votes/:id/cancel', (req, res) => res.json({ ok: true, vote: votes.cancel(id(req), req.body?.reason, req.user) }));
router.post('/admin/votes/:id/decision', (req, res) => res.json({ ok: true, vote: votes.setManualDecision(id(req), req.body?.decision, req.user) }));

router.post('/admin/votes/:id/revote', (req, res) => {
  const { vote, invite } = votes.revote(id(req), req.body || {}, req.user);
  res.status(201).json({ ok: true, vote, invite: invites.present(invite, vote, baseUrl(req)) });
});

router.post('/admin/votes/:id/amendment', (req, res) => {
  const { vote, invite } = votes.amendment(id(req), req.body || {}, req.user);
  res.status(201).json({ ok: true, vote, invite: invites.present(invite, vote, baseUrl(req)) });
});

router.get('/admin/votes/:id/revisions/:no', (req, res) => {
  const r = db.prepare('SELECT * FROM bill_revisions WHERE vote_id = ? AND revision_no = ?').get(id(req), id(req, 'no'));
  if (!r) throw E.NOT_FOUND('Редакция');
  res.json({ ...r, html: markdown.render(r.body).html });
});

router.post('/admin/render', (req, res) => {
  res.json(markdown.render(str(req.body?.body, { max: 200000 })));
});

// ---------- приглашения ----------

router.post('/admin/votes/:id/invites', (req, res) => {
  const v = votes.mustGet(id(req));
  if (v.status === 'closed' || v.status === 'cancelled') throw E.FORBIDDEN('Голосование завершено или отменено — новое приглашение не нужно.');
  const inv = invites.create(v.id, { expires_at: req.body?.expires_at || v.ends_at, ...req.body }, req.user);
  res.status(201).json({ ok: true, invite: invites.present(inv, v, baseUrl(req)) });
});

router.post('/admin/invites/:id/revoke', (req, res) => {
  const inv = invites.revoke(id(req), req.user);
  res.json({ ok: true, invite: invites.present(inv, votes.get(inv.vote_id), baseUrl(req)) });
});

router.post('/admin/invites/:id/extend', (req, res) => {
  const inv = invites.extend(id(req), req.body || {}, req.user);
  res.json({ ok: true, invite: invites.present(inv, votes.get(inv.vote_id), baseUrl(req)) });
});

router.get('/admin/invites/:id/qr.:fmt', async (req, res, next) => {
  try {
    const inv = invites.byId(id(req));
    if (!inv) throw E.NOT_FOUND('Приглашение');
    const url = invites.present(inv, null, baseUrl(req)).url;
    const opts = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0f1d33', light: '#ffffff' } };
    if (req.params.fmt === 'svg') {
      res.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
    } else if (req.params.fmt === 'png') {
      const buf = await QRCode.toBuffer(url, { ...opts, width: 720 });
      res.type('image/png');
      if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="SWAG-invite-${inv.code}.png"`);
      res.send(buf);
    } else throw E.NOT_FOUND('Формат');
  } catch (e) { next(e); }
});

// ---------- участники, документы, обсуждение ----------

router.post('/admin/participants/:id/reset', (req, res) => {
  const p = db.prepare('SELECT * FROM participants WHERE id = ?').get(id(req));
  if (!p) throw E.NOT_FOUND('Участник');
  if (p.has_voted) throw E.FORBIDDEN('Участник уже проголосовал — сброс невозможен.');
  db.transaction(() => {
    db.prepare('DELETE FROM notifications WHERE participant_id = ?').run(p.id);
    db.prepare('UPDATE comments SET participant_id = NULL WHERE participant_id = ?').run(p.id);
    db.prepare('DELETE FROM participants WHERE id = ?').run(p.id);
    db.prepare('UPDATE invites SET uses = MAX(uses - 1, 0) WHERE id = ?').run(p.invite_id);
    events.audit('speaker', req.user.id, 'participant.reset', p.vote_id, { name: `${p.first_name} ${p.last_name}` });
  })();
  res.json({ ok: true });
});

router.post('/admin/votes/:id/attachments', (req, res) => {
  const v = votes.mustGet(id(req));
  const title = str(req.body?.title, { max: 200, required: true, label: 'Название документа' });
  const url = str(req.body?.url, { max: 1000, required: true, label: 'Ссылка' });
  if (!/^https?:\/\//i.test(url)) throw E.VALIDATION('Ссылка должна начинаться с http:// или https://', 'url');
  db.prepare('INSERT INTO attachments(vote_id, title, url, created_at) VALUES (?,?,?,?)').run(v.id, title, url, now());
  events.audit('speaker', req.user.id, 'attachment.added', v.id, { title });
  res.status(201).json({ ok: true });
});

router.delete('/admin/attachments/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id(req));
  if (!a) throw E.NOT_FOUND('Документ');
  db.prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
  events.audit('speaker', req.user.id, 'attachment.removed', a.vote_id, { title: a.title });
  res.json({ ok: true });
});

router.post('/admin/comments/:id/hide', (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(id(req));
  if (!c) throw E.NOT_FOUND('Комментарий');
  db.prepare('UPDATE comments SET hidden = 1 WHERE id = ?').run(c.id);
  events.audit('speaker', req.user.id, 'comment.hidden', c.vote_id, {});
  res.json({ ok: true });
});

// ---------- протоколы, документы, экспорт ----------

router.get('/admin/votes/:id/protocol', (req, res) => {
  const p = protocols.forVote(id(req));
  if (!p) throw E.NOT_FOUND('Протокол');
  res.json(p);
});

router.get('/admin/votes/:id/protocol.pdf', (req, res) => {
  votes.mustGet(id(req));
  const p = protocols.forVote(id(req));
  if (!p) throw E.NOT_FOUND('Протокол');
  sendPdf(res, p);
});

router.get('/admin/votes/:id/document.html', (req, res) => {
  const v = votes.mustGet(id(req));
  const rev = db.prepare('SELECT MAX(revision_no) m FROM bill_revisions WHERE vote_id = ?').get(v.id).m || 1;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="SWAG-${v.number}-r${rev}.html"`);
  res.send(documents.standalone(v, rev));
});

router.get('/admin/votes/:id/export.:fmt', (req, res) => {
  const v = votes.mustGet(id(req));
  if (v.secret && v.status !== 'closed') throw E.FORBIDDEN('Итоги тайного голосования доступны для экспорта после его завершения.');
  const s = votes.summary(v);
  const rows = db.prepare(`SELECT p.first_name, p.last_name, p.position_title, p.organization, p.division, p.has_voted, p.voted_at, b.choice, b.receipt_no
                           FROM participants p LEFT JOIN ballots b ON b.participant_id = p.id WHERE p.vote_id = ? ORDER BY p.last_name`).all(v.id);
  events.audit('speaker', req.user.id, 'export', v.id, { format: req.params.fmt });
  if (req.params.fmt === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="SWAG-vote-${v.number}.json"`);
    return res.json({
      exported_at: now(), vote: v, summary: s,
      participants: rows.map((r) => ({
        name: `${r.first_name} ${r.last_name}`, position: participation.positionLine(r), voted: !!r.has_voted,
        voted_at: v.secret ? null : r.voted_at, choice: v.secret ? null : r.choice, receipt_no: v.secret ? null : r.receipt_no,
      })),
    });
  }
  if (req.params.fmt === 'csv') {
    const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Голосование', v.number, v.title].map(q).join(';'),
      ['ЗА', s.tally.for, 'ПРОТИВ', s.tally.against, 'ВОЗДЕРЖАЛИСЬ', s.tally.abstain, 'Явка %', s.turnout ?? ''].map(q).join(';'),
      '',
      ['ФИО', 'Должность', 'Организация', 'Подразделение', 'Проголосовал', 'Время', 'Голос', 'Идентификатор'].map(q).join(';'),
      ...rows.map((r) => [
        `${r.first_name} ${r.last_name}`, r.position_title, r.organization, r.division, r.has_voted ? 'да' : 'нет',
        v.secret ? '' : r.voted_at, v.secret ? 'тайно' : (CHOICES[r.choice]?.label || ''), v.secret ? '' : r.receipt_no,
      ].map(q).join(';')),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="SWAG-vote-${v.number}.csv"`);
    return res.send('﻿' + lines.join('\r\n'));
  }
  throw E.NOT_FOUND('Формат');
});

// ---------- журнал, уведомления, статистика ----------

router.get('/admin/log', (req, res) => {
  res.json({ items: events.listAudit({
    voteId: req.query.vote_id ? int(req.query.vote_id, { min: 1, max: 1e12 }) : null,
    limit: int(req.query.limit, { min: 1, max: 500 }) || 150,
    before: req.query.before ? int(req.query.before, { min: 1, max: 1e12 }) : null,
  }) });
});

router.get('/admin/notifications', (req, res) => res.json(events.speakerNotifications({ since: Number(req.query.since) || 0 })));
router.post('/admin/notifications/read', (req, res) => { events.markSpeakerRead(); res.json({ ok: true }); });

router.get('/admin/members', (req, res) => res.json(votes.memberStats()));

module.exports = router;
