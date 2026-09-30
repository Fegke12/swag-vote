'use strict';
/** Авторизация Спикера Конгресса: пароль (scrypt) + серверная сессия в httpOnly cookie. */
const crypto = require('crypto');
const { db, now } = require('../db');
const { E, sha256, randomToken, str } = require('../util');
const events = require('./events');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'swag_admin';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

/** Создать учётную запись Спикера при первом запуске (из переменных окружения). */
function ensureSpeaker() {
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0) return null;
  const login = process.env.SPEAKER_LOGIN || 'speaker';
  const password = process.env.SPEAKER_PASSWORD || randomToken(9);
  const name = process.env.SPEAKER_NAME || 'Спикер Конгресса';
  db.prepare('INSERT INTO users(login, password_hash, display_name, role, created_at) VALUES (?,?,?,?,?)')
    .run(login, hashPassword(password), name, 'speaker', now());
  return { login, password, generated: !process.env.SPEAKER_PASSWORD };
}

function login(loginRaw, password) {
  const loginName = str(loginRaw, { max: 60, required: true, label: 'Логин' });
  const u = db.prepare('SELECT * FROM users WHERE login = ?').get(loginName);
  // Проверяем пароль даже для несуществующего пользователя — одинаковое время ответа
  const ok = u ? verifyPassword(String(password || ''), u.password_hash) : (verifyPassword('x', hashPassword('y')), false);
  if (!ok) throw new (require('../util').AppError)('BAD_CREDENTIALS', 401, 'Неверный логин или пароль', 'Проверьте данные и попробуйте снова.');
  const token = randomToken();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
  db.prepare('INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), u.id, now(), new Date(Date.now() + SESSION_TTL_MS).toISOString());
  events.audit('speaker', u.id, 'auth.login', null, {});
  return { token, user: publicUser(u) };
}

function logout(token, user) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  if (user) events.audit('speaker', user.id, 'auth.logout', null, {});
}

function userBySession(token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), now());
  return row ? publicUser(row) : null;
}

function publicUser(u) { return { id: u.id, login: u.login, display_name: u.display_name, role: u.role }; }

/** Express middleware: только для Спикера. */
function requireSpeaker(req, res, next) {
  const user = userBySession(req.cookies[COOKIE]);
  if (!user) return next(E.UNAUTHORIZED());
  req.user = user;
  next();
}

module.exports = { COOKIE, SESSION_TTL_MS, ensureSpeaker, login, logout, userBySession, requireSpeaker, hashPassword };
