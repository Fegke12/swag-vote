'use strict';
/** HTTP-утилиты: ограничение частоты запросов, заголовки безопасности, обработка ошибок. */
const { AppError, E } = require('./util');

const buckets = new Map();
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k);
}, 60_000).unref();

/** Простое ограничение частоты по IP (для продакшена с несколькими инстансами — вынести в Redis). */
function limit(name, max, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const t = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < t) { b = { count: 0, reset: t + windowMs }; buckets.set(key, b); }
    if (++b.count > max) return next(E.RATE_LIMIT());
    next();
  };
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  next();
}

/** Запросы, меняющие состояние, принимаем только как JSON с того же сайта (защита от CSRF). */
function jsonOnlyForWrites(req, res, next) {
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    if (!req.is('application/json')) return next(E.VALIDATION('Неверный формат запроса.'));
    const site = req.get('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site)) return next(E.FORBIDDEN('Запрос отклонён: неверный источник.'));
  }
  next();
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AppError) {
    return res.status(err.status).json({ ok: false, error: { code: err.code, title: err.title, message: err.human, ...(err.extra || {}) } });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_JSON', title: 'Неверный формат запроса', message: '' } });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: { code: 'TOO_LARGE', title: 'Слишком большой объём данных', message: 'Сократите текст документа.' } });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: { code: 'INTERNAL', title: 'Внутренняя ошибка системы', message: 'Повторите попытку позже. Если ошибка повторяется — обратитесь к администратору.' } });
}

module.exports = { limit, securityHeaders, jsonOnlyForWrites, errorHandler };
