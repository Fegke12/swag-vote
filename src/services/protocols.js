'use strict';
/** Официальные протоколы: снимок итогов + генерация PDF. */
const path = require('path');
const PDFDocument = require('pdfkit');
const { db, now, nextCounter, pad } = require('../db');
const { sha256 } = require('../util');
const { VOTE_TYPES, CHOICES } = require('./catalog');

const DISPLAY_TZ = process.env.DISPLAY_TZ || 'Europe/Moscow';
const fmt = (iso) => iso ? new Intl.DateTimeFormat('ru-RU', {
  timeZone: DISPLAY_TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso)) : '—';

function participantsSnapshot(v) {
  const line = (p) => [p.position_title, p.organization, p.division].filter(Boolean).join(' — ');
  if (v.secret) {
    return db.prepare(`SELECT first_name, last_name, position_title, organization, division FROM participants
                       WHERE vote_id = ? AND has_voted = 1 ORDER BY last_name, first_name`).all(v.id)
      .map((p) => ({ name: `${p.first_name} ${p.last_name}`, position: line(p) }));
  }
  return db.prepare(`SELECT p.first_name, p.last_name, p.position_title, p.organization, p.division, b.choice, b.receipt_no, b.cast_at
                     FROM participants p JOIN ballots b ON b.participant_id = p.id WHERE p.vote_id = ? ORDER BY b.cast_at`).all(v.id)
    .map((p) => ({ name: `${p.first_name} ${p.last_name}`, position: line(p), choice: p.choice, receipt_no: p.receipt_no, cast_at: p.cast_at }));
}

function buildData(v, s, number, createdAt) {
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
    participants: participantsSnapshot(v),
  };
  data.checksum = sha256(JSON.stringify(data)).slice(0, 32).toUpperCase();
  return data;
}

function create(v, s) {
  const existing = db.prepare('SELECT * FROM protocols WHERE vote_id = ?').get(v.id);
  if (existing) return existing;
  const number = `П-${pad(nextCounter('protocol_number', 1))}`;
  const createdAt = now();
  const data = buildData(v, s, number, createdAt);
  db.prepare('INSERT INTO protocols(number, vote_id, data_json, created_at) VALUES (?,?,?,?)').run(number, v.id, JSON.stringify(data), createdAt);
  return db.prepare('SELECT * FROM protocols WHERE vote_id = ?').get(v.id);
}

/** Переформирование (например, после фиксации решения Спикером). Номер сохраняется. */
function refresh(v, s) {
  const p = db.prepare('SELECT * FROM protocols WHERE vote_id = ?').get(v.id);
  if (!p) return create(v, s);
  const data = buildData(v, s, p.number, now());
  db.prepare('UPDATE protocols SET data_json = ?, created_at = ? WHERE id = ?').run(JSON.stringify(data), data.created_at, p.id);
  return db.prepare('SELECT * FROM protocols WHERE id = ?').get(p.id);
}

function forVote(voteId) {
  const p = db.prepare('SELECT * FROM protocols WHERE vote_id = ?').get(voteId);
  return p ? { id: p.id, number: p.number, created_at: p.created_at, data: JSON.parse(p.data_json) } : null;
}

const DECISION = { adopted: 'ПРИНЯТО', rejected: 'НЕ ПРИНЯТО', pending: 'ОЖИДАЕТ ФИКСАЦИИ СПИКЕРОМ' };

/** PDF протокола (кириллица — шрифт DejaVu). */
function pdf(protocol) {
  const d = protocol.data;
  const fontDir = path.dirname(require.resolve('dejavu-fonts-ttf/package.json')) + '/ttf/';
  const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 56, bottom: 64, left: 64, right: 64 },
    info: { Title: `Протокол ${d.number}`, Author: 'Генеральная Ассамблея штата SWAG', Subject: d.vote.title } });
  doc.registerFont('R', fontDir + 'DejaVuSerif.ttf');
  doc.registerFont('B', fontDir + 'DejaVuSerif-Bold.ttf');
  doc.registerFont('S', fontDir + 'DejaVuSans.ttf');
  doc.registerFont('SB', fontDir + 'DejaVuSans-Bold.ttf');

  const NAVY = '#0f1d33', GOLD = '#a8843a', MUTED = '#5b6474', LINE = '#c9ced8';
  const W = doc.page.width - 128, L = 64;

  // Эмблема
  const cx = doc.page.width / 2, cy = 88;
  doc.save().circle(cx, cy, 26).lineWidth(1.4).stroke(GOLD).circle(cx, cy, 21).lineWidth(0.6).stroke(GOLD);
  const star = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 5.5 : 13, a = -Math.PI / 2 + i * Math.PI / 5; star.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  doc.polygon(...star).fill(NAVY).restore();

  doc.y = 124;
  doc.font('SB').fontSize(9).fillColor(GOLD).text('ГЕНЕРАЛЬНАЯ АССАМБЛЕЯ ШТАТА SWAG', L, doc.y, { width: W, align: 'center', characterSpacing: 2 });
  doc.moveDown(0.6).font('B').fontSize(16).fillColor(NAVY).text('ПРОТОКОЛ ЭЛЕКТРОННОГО ГОЛОСОВАНИЯ', { width: W, align: 'center' });
  doc.moveDown(0.3).font('S').fontSize(10).fillColor(MUTED).text(`Протокол № ${d.number}   ·   Голосование № ${d.vote.number}`, { width: W, align: 'center' });
  doc.moveDown(0.8).moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.8).stroke(GOLD).moveDown(1);

  const row = (label, value, opts = {}) => {
    const y = doc.y;
    doc.font('S').fontSize(9.5).fillColor(MUTED).text(label, L, y, { width: 170 });
    const h1 = doc.y - y;
    doc.font(opts.bold ? 'B' : 'R').fontSize(opts.size || 10.5).fillColor(NAVY).text(value, L + 180, y, { width: W - 180 });
    doc.y = Math.max(doc.y, y + h1) + 5;
    doc.x = L;
  };

  row('Предмет голосования', `${d.vote.type_label}: «${d.vote.title}»`, { bold: true });
  if (d.vote.initiator) row('Инициатор', d.vote.initiator);
  row('Форма голосования', d.vote.secret ? 'Тайное электронное голосование' : 'Открытое электронное голосование');
  row('Дата начала', fmt(d.vote.starts_at));
  row('Дата окончания', fmt(d.vote.closed_at || d.vote.ends_at) + (d.vote.closed_early ? ' (досрочно)' : ''));
  row('Правило принятия', d.results.rule_text);
  doc.moveDown(0.4);

  // Таблица итогов
  const r = d.results;
  const cells = [
    ['Всего приглашённых', r.invited], ['Приняли участие', r.voted], ['Не приняли участие', r.not_voted],
    ['Явка', r.turnout == null ? '—' : `${String(r.turnout).replace('.', ',')} %`],
    ['ЗА', r.tally.for], ['ПРОТИВ', r.tally.against],
  ];
  if (d.vote.allow_abstain) cells.push(['ВОЗДЕРЖАЛИСЬ', r.tally.abstain]);
  if (r.required_for != null) cells.push(['Требовалось голосов «ЗА»', r.required_for]);
  const colW = W / 2, rh = 22;
  let ty = doc.y;
  cells.forEach(([k, val], i) => {
    const x = L + (i % 2) * colW, y = ty + Math.floor(i / 2) * rh;
    doc.rect(x, y, colW, rh).lineWidth(0.5).stroke(LINE);
    doc.font('S').fontSize(9.5).fillColor(MUTED).text(k, x + 10, y + 6.5, { width: colW - 80 });
    doc.font('SB').fontSize(10.5).fillColor(NAVY).text(String(val), x + colW - 70, y + 6, { width: 60, align: 'right' });
  });
  doc.y = ty + Math.ceil(cells.length / 2) * rh + 16; doc.x = L;

  // Решение
  const dy = doc.y;
  const decColor = r.decision === 'adopted' ? '#1f6b45' : r.decision === 'rejected' ? '#8a2a2a' : GOLD;
  doc.rect(L, dy, W, 40).fill('#f4f1e8');
  doc.rect(L, dy, 3, 40).fill(decColor);
  doc.font('S').fontSize(9).fillColor(MUTED).text('РЕШЕНИЕ', L + 16, dy + 8);
  doc.font('SB').fontSize(15).fillColor(decColor).text(DECISION[r.decision] + (r.quorum_met ? '' : ' — КВОРУМ НЕ ДОСТИГНУТ'), L + 16, dy + 19);
  doc.y = dy + 54; doc.x = L;

  doc.font('SB').fontSize(9).fillColor(GOLD).text('ПОСТАНОВЛЕНИЕ ПО РЕЗУЛЬТАТАМ ГОЛОСОВАНИЯ', { characterSpacing: 1 });
  doc.moveDown(0.4).font('R').fontSize(10.5).fillColor(NAVY).text(d.resolution || '—', { width: W, align: 'justify', lineGap: 2 });
  for (const n of r.notes || []) doc.moveDown(0.3).font('S').fontSize(8.5).fillColor(MUTED).text('Примечание: ' + n, { width: W });

  // Список участников
  if (d.participants.length) {
    doc.moveDown(1).font('SB').fontSize(9).fillColor(GOLD)
      .text(d.vote.secret ? 'УЧАСТНИКИ ГОЛОСОВАНИЯ (ФАКТ УЧАСТИЯ; ВЫБОР НЕ РАСКРЫВАЕТСЯ)' : 'ПОИМЁННЫЕ РЕЗУЛЬТАТЫ ГОЛОСОВАНИЯ', { characterSpacing: 1 });
    doc.moveDown(0.4);
    d.participants.forEach((p, i) => {
      if (doc.y > doc.page.height - 110) doc.addPage();
      const y = doc.y;
      doc.font('S').fontSize(9).fillColor(MUTED).text(String(i + 1).padStart(2, '0'), L, y, { width: 22 });
      doc.font('SB').fontSize(9.5).fillColor(NAVY).text(p.name, L + 26, y, { width: 150 });
      const h = doc.y;
      doc.font('S').fontSize(8.5).fillColor(MUTED).text(p.position || '—', L + 180, y, { width: d.vote.secret ? W - 180 : W - 270 });
      let bottom = Math.max(h, doc.y);
      if (!d.vote.secret) {
        doc.font('SB').fontSize(9).fillColor(NAVY).text(CHOICES[p.choice]?.label || '', L + W - 84, y, { width: 84, align: 'right' });
      }
      doc.y = bottom + 3; doc.x = L;
      doc.moveTo(L, doc.y).lineTo(L + W, doc.y).lineWidth(0.3).stroke(LINE); doc.y += 4;
    });
  }

  // Подпись
  if (doc.y > doc.page.height - 170) doc.addPage();
  doc.moveDown(2);
  const sy = doc.y;
  doc.font('S').fontSize(9.5).fillColor(MUTED).text('Спикер Конгресса штата SWAG', L, sy);
  doc.moveTo(L + 200, sy + 12).lineTo(L + W - 150, sy + 12).lineWidth(0.6).stroke(NAVY);
  doc.font('R').fontSize(10).fillColor(NAVY).text(d.vote.speaker_name || '', L + W - 145, sy, { width: 145, align: 'right' });
  doc.y = sy + 34; doc.x = L;
  doc.font('S').fontSize(9).fillColor(MUTED).text(`Дата формирования протокола: ${fmt(d.created_at)} (${DISPLAY_TZ})`);
  doc.text(`Контрольная сумма документа: ${d.checksum}`);

  // Колонтитулы
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // иначе текст колонтитула создаёт новую страницу
    const fy = doc.page.height - 40;
    doc.moveTo(L, fy - 8).lineTo(L + W, fy - 8).lineWidth(0.4).stroke(LINE);
    doc.font('S').fontSize(7.5).fillColor(MUTED)
      .text(`Электронная система голосования Генеральной Ассамблеи штата SWAG · Протокол ${d.number}`, L, fy, { width: W - 60, lineBreak: false })
      .text(`${i + 1} / ${range.count}`, L + W - 60, fy, { width: 60, align: 'right', lineBreak: false });
  }
  doc.end();
  return doc;
}

module.exports = { create, refresh, forVote, pdf, fmt, DECISION };
