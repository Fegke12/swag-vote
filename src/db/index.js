'use strict';
/**
 * Подключение к базе данных.
 * Сейчас — SQLite (файл data/swag.db). Весь SQL сосредоточен в src/services/*,
 * поэтому переход на PostgreSQL/MySQL затрагивает только этот модуль и сервисы.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'swag.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const now = () => new Date().toISOString();

/** Следующее значение именованного счётчика (атомарно). */
function nextCounter(name, start = 1) {
  const row = db.prepare(
    `INSERT INTO counters(name, value) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET value = value + 1
     RETURNING value`
  ).get(name, start);
  return row.value;
}

const pad = (n, len = 6) => String(n).padStart(len, '0');

module.exports = { db, now, nextCounter, pad, DB_PATH };
