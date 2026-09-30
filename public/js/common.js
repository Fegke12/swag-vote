/* Общие утилиты фронтенда: API, форматирование, иконки, модальные окна, уведомления. */
'use strict';

const SWAG = (() => {
  // ---------- API ----------
  class ApiError extends Error {
    constructor(status, error) {
      super(error?.title || 'Ошибка');
      this.status = status;
      this.code = error?.code || 'UNKNOWN';
      this.title = error?.title || 'Не удалось выполнить действие';
      this.human = error?.message || '';
      this.field = error?.field || null;
      this.data = error || {};
    }
  }

  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch('/api' + path, {
        method, credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ApiError(0, { code: 'NETWORK', title: 'Нет соединения с сервером', message: 'Проверьте подключение к интернету и повторите попытку.' });
    }
    let data = null;
    try { data = await res.json(); } catch { /* пустой ответ */ }
    if (!res.ok) throw new ApiError(res.status, data?.error || { title: 'Ошибка сервера', message: `Код ответа ${res.status}` });
    return data;
  }

  // ---------- форматирование ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  function fmtDate(iso, { time = true } = {}) {
    if (!iso) return '—';
    const d = new Date(iso);
    const s = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
    return time ? `${s}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
  }
  function fmtTime(iso) { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  function fmtLong(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function ago(iso) {
    const s = Math.round((now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'только что';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} ${plural(m, 'минуту', 'минуты', 'минут')} назад`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
    return fmtDate(iso);
  }
  function duration(ms) {
    if (ms <= 0) return '00:00:00';
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return d > 0 ? `${d} д ${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
  }
  const pct = (n) => (n == null ? '—' : `${String(n).replace('.', ',')} %`);
  // Поправка на расхождение часов клиента и сервера
  let clockSkew = 0;
  function syncClock(serverIso) { if (serverIso) clockSkew = Date.parse(serverIso) - Date.now(); }
  function now() { return Date.now() + clockSkew; }
  function toLocalInput(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const fromLocalInput = (v) => (v ? new Date(v).toISOString() : '');

  const CHOICE = { for: 'ЗА', against: 'ПРОТИВ', abstain: 'ВОЗДЕРЖАЛСЯ' };
  const CHOICE_PL = { for: 'ЗА', against: 'ПРОТИВ', abstain: 'ВОЗДЕРЖАЛИСЬ' };
  const DECISION = { adopted: 'Принято', rejected: 'Не принято', pending: 'Ожидает решения' };

  // ---------- иконки (контурные, 24×24) ----------
  const P = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    minus: '<path d="M5 12h14"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6M9 9h2"/>',
    download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
    idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16c.6-1.5 1.8-2.3 3.2-2.3s2.6.8 3.2 2.3M14.5 10h3.5M14.5 13.5h3.5"/>',
    seal: '<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.3-1.5 7.2 5-2.5 5 2.5-1.5-7.2"/><path d="m10 9 1.4 1.4L14 7.8"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2M16 16h2v2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
    log: '<path d="M8 4h11v16H8zM8 4H5v16h3"/><path d="M11 8h5M11 12h5M11 16h3"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.7.8 2.7 2.6 3 5.2"/>',
    logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.1"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>',
    external: '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
    ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 12V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 12v3a3 3 0 0 1-3 3H4"/>',
    branch: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 8v8M18 11c0 4-6 3-11.2 5.5"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4l3 2"/>',
    message: '<path d="M4 5h16v11H9l-5 4z"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    paperclip: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.2 17.2a1.7 1.7 0 0 1-2.4-2.4L14.5 7"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.2L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4.2L20 15M20 20v-5h-5"/>',
    vote: '<path d="M5 12h14v8H5z"/><path d="M8 12 14 4l3.5 3L13 12"/>',
    gavel: '<path d="m13 5 6 6M11.5 6.5l6 6M15.5 3.5l5 5-3 3-5-5zM9.5 9.5 4 15l3 3 5.5-5.5M3 21h9"/>',
  };
  function icon(name, cls = '') {
    return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  }

  // ---------- DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function html(el, markup) { el.innerHTML = markup; return el; }
  function statusPill(status, label, big) {
    const L = label || { pending: 'Ожидает начала', active: 'Активно', closed: 'Завершено', cancelled: 'Отменено' }[status];
    return `<span class="status status-${esc(status)}${big ? ' status-lg' : ''}">${esc(L)}</span>`;
  }
  function decisionMark(d) {
    if (!d) return '<span class="muted">—</span>';
    const ic = d === 'adopted' ? 'check' : d === 'rejected' ? 'x' : 'clock';
    return `<span class="decision decision-${d}">${icon(ic)}${DECISION[d]}</span>`;
  }

  // ---------- уведомления ----------
  function toasts() {
    let t = $('.toasts');
    if (!t) { t = document.createElement('div'); t.className = 'toasts'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
    return t;
  }
  function toast(title, desc = '', type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div><div class="t">${esc(title)}</div>${desc ? `<div class="d">${esc(desc)}</div>` : ''}</div>`;
    toasts().appendChild(el);
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, 5200);
  }
  function toastError(e) { toast(e.title || 'Ошибка', e.human || e.message || '', 'error'); }

  // ---------- модальные окна ----------
  function modal({ title = '', body = '', wide = false, actions = [], onOpen, dismissable = true }) {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal${wide ? ' modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mdl-t">
      ${title ? `<div class="modal-head"><h2 id="mdl-t">${title}</h2></div>` : ''}
      <div class="modal-body"></div>
      ${actions.length ? '<div class="modal-foot"></div>' : ''}
    </div>`;
    const bodyEl = $('.modal-body', back);
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    const prevFocus = document.activeElement;
    const close = () => {
      back.remove(); document.body.classList.remove('no-scroll');
      document.removeEventListener('keydown', onKey);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) close(); };
    const foot = $('.modal-foot', back);
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = `btn ${a.class || ''}`; b.innerHTML = a.html || esc(a.label);
      b.addEventListener('click', async () => {
        if (a.onClick) {
          b.disabled = true;
          try { const r = await a.onClick({ close, body: bodyEl, button: b }); if (r !== false && a.close !== false) close(); }
          catch (e) { toastError(e); }
          finally { b.disabled = false; }
        } else close();
      });
      foot.appendChild(b);
    });
    back.addEventListener('mousedown', (e) => { if (e.target === back && dismissable) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back); document.body.classList.add('no-scroll');
    const focusEl = $('input, select, textarea', bodyEl) || $('.modal-foot .btn:last-child', back);
    if (focusEl) setTimeout(() => focusEl.focus(), 30);
    if (onOpen) onOpen({ close, body: bodyEl });
    return { close, el: back, body: bodyEl };
  }

  function confirmDialog({ title, text, confirmLabel = 'Подтвердить', danger = false, input = null }) {
    return new Promise((resolve) => {
      let done = false;
      const inputHtml = input ? `<div class="field" style="margin:14px 0 0"><label>${esc(input.label)}</label>${input.type === 'datetime'
        ? `<input class="input" type="datetime-local" id="cd-in" value="${esc(input.value || '')}">`
        : `<textarea class="textarea" id="cd-in" rows="3" placeholder="${esc(input.placeholder || '')}"></textarea>`}</div>` : '';
      const m = modal({
        title, body: `<p style="margin:0;color:var(--ink-2)">${text}</p>${inputHtml}`,
        actions: [
          { label: 'Отмена', class: 'btn-ghost', onClick: () => { done = true; resolve(null); } },
          { label: confirmLabel, class: danger ? 'btn-danger' : 'btn-primary', onClick: ({ body }) => { done = true; resolve(input ? ($('#cd-in', body).value || '') : true); } },
        ],
      });
      const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(null); } });
      obs.observe(document.body, { childList: true });
    });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast('Ссылка скопирована', text, 'success');
  }

  // ---------- диаграмма ----------
  const COLORS = { for: '#1d6a45', against: '#922f2f', abstain: '#b58a22' };
  function donut(tally, keys = ['for', 'against', 'abstain']) {
    const total = keys.reduce((s, k) => s + (tally[k] || 0), 0);
    const r = 70, C = 2 * Math.PI * r;
    let off = 0;
    const segs = total ? keys.filter((k) => tally[k] > 0).map((k) => {
      const len = (tally[k] / total) * C;
      const gap = keys.filter((x) => tally[x] > 0).length > 1 ? 2.5 : 0;
      const s = `<circle cx="90" cy="90" r="${r}" fill="none" stroke="${COLORS[k]}" stroke-width="22" stroke-dasharray="${Math.max(len - gap, 0.01)} ${C}" stroke-dashoffset="${-off}"/>`;
      off += len; return s;
    }).join('') : '';
    return `<div class="donut"><svg viewBox="0 0 180 180" role="img" aria-label="Диаграмма распределения голосов">
      <circle cx="90" cy="90" r="${r}" fill="none" stroke="#eceef2" stroke-width="22"/>${segs}</svg>
      <div class="center"><b>${total}</b><span>${plural(total, 'голос', 'голоса', 'голосов')}</span></div></div>`;
  }
  function tallyRows(tally, allowAbstain = true) {
    const keys = allowAbstain ? ['for', 'against', 'abstain'] : ['for', 'against'];
    const total = keys.reduce((s, k) => s + (tally[k] || 0), 0);
    return `<div class="tally-rows">${keys.map((k) => {
      const p = total ? Math.round((tally[k] / total) * 1000) / 10 : 0;
      return `<div class="tally-row c-${k}"><div class="name"><i></i>${CHOICE_PL[k]}</div>
        <div class="bar"><span style="width:${p}%"></span></div>
        <div class="val">${tally[k]}<small>${pct(p)}</small></div></div>`;
    }).join('')}</div>`;
  }

  return {
    api, ApiError, esc, fmtDate, fmtTime, fmtLong, plural, ago, duration, pct, now, syncClock, toLocalInput, fromLocalInput,
    CHOICE, CHOICE_PL, DECISION, icon, $, $$, html, statusPill, decisionMark, toast, toastError, modal, confirmDialog, copyText,
    donut, tallyRows,
  };
})();
