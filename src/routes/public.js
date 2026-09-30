'use strict';
/** API участника голосования (доступ по приглашению). */
const express = require('express');
const { randomToken } = require('../util');
const { E } = require('../util');
const participation = require('../services/participation');
const events = require('../services/events');
const markdown = require('../services/markdown');
const documents = require('../services/documents');
const protocols = require('../services/protocols');
const { db } = require('../db');
const { limit } = require('../http');

const router = express.Router();

const pCookie = (voteId) => `swag_p_${voteId}`;
const DEVICE_COOKIE = 'swag_dev';

function cookieOpts(req, maxAgeMs) {
  return { httpOnly: true, sameSite: 'lax', secure: req.secure || process.env.COOKIE_SECURE === '1', path: '/', maxAge: maxAgeMs };
}

function deviceId(req, res) {
  let id = req.cookies[DEVICE_COOKIE];
  if (!id || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) {
    id = randomToken(24);
    res.cookie(DEVICE_COOKIE, id, cookieOpts(req, 400 * 24 * 3600 * 1000));
  }
  return id;
}

/** Голосование по коду + токен участника из cookie. */
function ctx(req) {
  const { inv, vote } = participation.resolve(req.params.code);
  return { inv, vote, token: req.cookies[pCookie(vote.id)] };
}

/** Доступ к материалам: действующее приглашение или уже идентифицированный участник. */
function assertMaterialsAccess(c) {
  const p = participation.participantBySession(c.vote.id, c.token);
  if (p) return p;
  if (c.inv.revoked_at) throw E.INVITE_REVOKED();
  if (c.vote.status === 'cancelled') throw E.VOTE_CANCELLED();
  if (c.vote.status !== 'closed' && Date.now() >= Date.parse(c.inv.expires_at)) throw E.INVITE_EXPIRED();
  return null;
}

router.get('/v/:code', (req, res) => {
  let token = null;
  const inv = require('../services/invites').byCode(req.params.code);
  if (inv) token = req.cookies[pCookie(inv.vote_id)];
  deviceId(req, res);
  res.json(participation.state(req.params.code, token));
});

router.post('/v/:code/identify', limit('identify', 20, 60_000), (req, res) => {
  const { vote } = participation.resolve(req.params.code);
  const out = participation.identify(req.params.code, req.body || {}, {
    deviceId: deviceId(req, res),
    existingToken: req.cookies[pCookie(vote.id)],
  });
  const ttl = Math.max(Date.parse(vote.ends_at) - Date.now(), 0) + 30 * 24 * 3600 * 1000;
  res.cookie(pCookie(vote.id), out.token, cookieOpts(req, ttl));
  res.json({ ok: true, participant: out.participant });
});

router.post('/v/:code/ballot', limit('ballot', 20, 60_000), (req, res) => {
  const c = ctx(req);
  const out = participation.cast(req.params.code, c.token, req.body?.choice);
  res.json({ ok: true, ...out });
});

router.get('/v/:code/document', (req, res) => {
  const c = ctx(req);
  assertMaterialsAccess(c);
  const { html, toc } = markdown.render(c.vote.body);
  const rev = db.prepare('SELECT MAX(revision_no) m FROM bill_revisions WHERE vote_id = ?').get(c.vote.id).m || 1;
  res.json({ html, toc, revision: rev, title: c.vote.title, number: c.vote.number, type_label: c.vote.type_label });
});

router.get('/v/:code/document/download', (req, res) => {
  const c = ctx(req);
  assertMaterialsAccess(c);
  const rev = db.prepare('SELECT MAX(revision_no) m FROM bill_revisions WHERE vote_id = ?').get(c.vote.id).m || 1;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="SWAG-${c.vote.number}-r${rev}.html"; filename*=UTF-8''${encodeURIComponent(`Документ № ${c.vote.number} (ред. ${rev}).html`)}`);
  res.send(documents.standalone(c.vote, rev));
});

router.get('/v/:code/notifications', (req, res) => {
  const c = ctx(req);
  const p = participation.participantBySession(c.vote.id, c.token);
  if (!p) return res.json({ items: [] });
  res.json({ items: events.participantNotifications(c.vote.id, p.id, Number(req.query.since) || 0) });
});

router.get('/v/:code/comments', (req, res) => {
  const c = ctx(req);
  if (!c.vote.allow_comments) return res.json({ items: [] });
  assertMaterialsAccess(c);
  res.json({ items: participation.listComments(c.vote.id) });
});

router.post('/v/:code/comments', limit('comment', 10, 60_000), (req, res) => {
  const c = ctx(req);
  res.json({ items: participation.addComment(req.params.code, c.token, req.body?.body) });
});

router.get('/v/:code/protocol.pdf', (req, res) => {
  const c = ctx(req);
  if (c.vote.status !== 'closed' || !c.vote.show_results) throw E.FORBIDDEN('Протокол будет доступен после завершения голосования, если Спикер разрешил публикацию результатов.');
  const p = protocols.forVote(c.vote.id);
  if (!p) throw E.NOT_FOUND('Протокол');
  sendPdf(res, p);
});

function sendPdf(res, p) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="SWAG-protocol-${p.data.vote.number}.pdf"; filename*=UTF-8''${encodeURIComponent(`Протокол ${p.number}.pdf`)}`);
  protocols.pdf(p).pipe(res);
}

module.exports = { router, sendPdf };
