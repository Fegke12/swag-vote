/* Панель Спикера Конгресса: голосования, приглашения, участники, протоколы, журнал. */
'use strict';
(() => {
  const S = SWAG;
  const { $, $$, esc, icon, api } = S;
  const root = $('#root');

  let me = null;
  let configured = true;
  let meta = null;
  let counts = {};

  // ================= Вход =================
  async function boot() {
    try {
      let who;
      [meta, who] = await Promise.all([api('/meta'), api('/auth/me')]);
      me = who.user; configured = who.configured !== false;
      S.syncClock(meta.server_time);
    } catch (e) { root.innerHTML = `<div class="login-form" style="min-height:100vh"><div class="notice notice-danger">${icon('alert')}<div><strong>${esc(e.title)}</strong>${esc(e.human)}</div></div></div>`; return; }
    if (!me) return renderLogin();
    renderShell();
    route();
  }

  function renderLogin() {
    root.innerHTML = `<div class="login-page">
      <aside class="login-side">
        <div>
          <img class="big" src="/img/emblem.svg" alt="Герб штата SWAG">
          <div class="eyebrow" style="color:var(--gold-2)">Генеральная Ассамблея штата SWAG</div>
          <h1 style="margin-top:12px">ПАНЕЛЬ СПИКЕРА<br>КОНГРЕССА</h1>
          <p>Создание голосований, управление приглашениями, контроль участия, итоговые постановления и официальные протоколы.</p>
        </div>
        <div class="foot">Доступ предоставляется только Спикеру Конгресса штата SWAG. Все действия фиксируются в журнале.</div>
      </aside>
      <div class="login-form">
        <form class="card" id="login" novalidate>
          <div class="eyebrow">Служебный вход</div>
          <h2>Авторизация</h2>
          <p class="muted" style="font-size:14px;margin-bottom:22px">Введите учётные данные Спикера Конгресса.</p>
          ${configured ? '' : `<div class="notice notice-gold" style="margin-bottom:18px">${icon('info')}<div><strong>Пароль Спикера ещё не задан</strong>Добавьте секрет <span class="mono">SPEAKER_PASSWORD</span> в настройках Worker в Cloudflare (Settings → Variables and Secrets).</div></div>`}
          <div class="field"><label for="l-login">Логин</label><input class="input" id="l-login" name="login" autocomplete="username" required></div>
          <div class="field"><label for="l-pass">Пароль</label><input class="input" id="l-pass" name="password" type="password" autocomplete="current-password" required></div>
          <div class="notice notice-danger" id="l-err" hidden style="margin-bottom:16px"></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">${icon('lock')} Войти</button>
          <p style="text-align:center;margin:18px 0 0;font-size:13px"><a href="/">← На главную</a></p>
        </form>
      </div>
    </div>`;
    const f = $('#login');
    setTimeout(() => $('#l-login').focus(), 30);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', f); btn.disabled = true;
      try {
        const r = await api('/auth/login', { method: 'POST', body: { login: f.login.value, password: f.password.value } });
        me = r.user; renderShell(); route();
      } catch (err) {
        const box = $('#l-err'); box.hidden = false;
        box.innerHTML = `${icon('alert')}<div><strong>${esc(err.title)}</strong>${esc(err.human)}</div>`;
      } finally { btn.disabled = false; }
    });
  }

  // ================= Каркас =================
  const NAV = [
    ['dashboard', '#/', 'home', 'Дашборд'],
    ['votes', '#/votes', 'list', 'Голосования'],
    ['new', '#/new', 'plus', 'Создать голосование'],
    ['log', '#/log', 'log', 'Журнал событий'],
    ['members', '#/members', 'users', 'Статистика участников'],
  ];

  function renderShell() {
    const initials = me.display_name.split(' ').map((w) => w[0]).join('').slice(0, 2);
    root.innerHTML = `<div class="admin">
      <aside class="sidebar" id="sidebar">
        <a class="brand" href="#/"><img src="/img/emblem.svg" alt=""><span class="brand-text">
          <span class="brand-kicker">Конгресс штата SWAG</span><span class="brand-title">Панель Спикера Конгресса</span></span></a>
        <div class="side-label">Управление</div>
        <nav class="nav">${NAV.map(([k, h, ic, l]) => `<a href="${h}" data-nav="${k}">${icon(ic)}<span>${l}</span>${k === 'votes' ? '<span class="count" id="nav-active" hidden></span>' : ''}</a>`).join('')}</nav>
        <div class="side-label">Публичная часть</div>
        <nav class="nav"><a href="/" target="_blank" rel="noopener">${icon('external')}<span>Главная страница</span></a></nav>
        <div class="me"><div class="avatar">${esc(initials)}</div><div><div class="n">${esc(me.display_name)}</div><div class="r">Спикер Конгресса</div></div>
          <button class="btn btn-ghost btn-icon btn-sm" id="logout" title="Выйти" aria-label="Выйти">${icon('logout')}</button></div>
      </aside>
      <div class="admin-main">
        <div class="topbar"><div class="in">
          <button class="btn btn-ghost btn-icon menu-btn" id="menu" aria-label="Меню">${icon('menu')}</button>
          <h1>Панель Спикера Конгресса</h1>
          <span class="spacer"></span>
          <a class="btn btn-primary btn-sm hide-sm" href="#/new">${icon('plus')} Новое голосование</a>
          <div class="bell" id="bell">
            <button class="btn btn-ghost btn-icon" id="bell-btn" aria-label="Уведомления">${icon('bell')}</button>
            <span class="badge" id="bell-badge" hidden></span>
            <div class="bell-panel" id="bell-panel" hidden><header>Уведомления<button class="btn btn-ghost btn-sm" id="bell-read">Прочитано</button></header><div class="bell-list" id="bell-list"></div></div>
          </div>
        </div></div>
        <main class="admin-content" id="view"></main>
      </div>
    </div>`;
    $('#logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); me = null; location.hash = ''; renderLogin(); });
    $('#menu').addEventListener('click', () => toggleSidebar(true));
    $$('.nav a').forEach((a) => a.addEventListener('click', () => toggleSidebar(false)));
    setupBell();
  }

  function toggleSidebar(open) {
    $('#sidebar').classList.toggle('open', open);
    $('.sidebar-scrim')?.remove();
    if (open) {
      const s = document.createElement('div'); s.className = 'sidebar-scrim';
      s.addEventListener('click', () => toggleSidebar(false)); document.body.appendChild(s);
    }
  }

  // ================= Уведомления =================
  let lastNotif = 0;
  function setupBell() {
    const panel = $('#bell-panel');
    $('#bell-btn').addEventListener('click', async (e) => {
      e.stopPropagation(); panel.hidden = !panel.hidden;
      if (!panel.hidden) { $('#bell-badge').hidden = true; api('/admin/notifications/read', { method: 'POST', body: {} }).catch(() => {}); }
    });
    $('#bell-read').addEventListener('click', () => { panel.hidden = true; });
    document.addEventListener('click', (e) => { if (!e.target.closest('#bell')) panel.hidden = true; });
    pollNotif(true);
    setInterval(() => pollNotif(false), 15000);
  }
  let notifItems = [];
  async function pollNotif(first) {
    if (!me) return;
    try {
      const r = await api(`/admin/notifications?since=${lastNotif}`);
      if (r.items.length) {
        lastNotif = Math.max(lastNotif, ...r.items.map((i) => i.id));
        notifItems = [...r.items, ...notifItems].slice(0, 40);
        if (!first) {
          r.items.slice(0, 3).reverse().forEach((n) => S.toast(n.title, n.body));
          if (currentRoute.name === 'dashboard' || currentRoute.name === 'vote') route({ soft: true });
        }
      }
      $('#bell-list').innerHTML = notifItems.length ? notifItems.map((n) => `<div class="bell-item"><div class="t">${esc(n.title)}</div>
        ${n.body ? `<div class="d">${esc(n.body)}</div>` : ''}<time>${S.ago(n.at)}</time></div>`).join('') : '<div class="bell-empty">Уведомлений нет</div>';
      const b = $('#bell-badge'); b.hidden = !r.unread; b.textContent = r.unread > 99 ? '99+' : r.unread;
    } catch (e) { if (e.status === 401) { me = null; renderLogin(); } }
  }

  // ================= Маршрутизация =================
  let currentRoute = {};
  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = h.split('?');
    const q = Object.fromEntries(new URLSearchParams(qs || ''));
    const p = path.split('/').filter(Boolean);
    if (!p.length) return { name: 'dashboard', q };
    if (p[0] === 'votes' && p[1]) {
      if (p[2] === 'edit') return { name: 'edit', id: p[1], q };
      if (p[2] === 'amendment') return { name: 'amendment', id: p[1], q };
      return { name: 'vote', id: p[1], tab: p[2] || 'overview', q };
    }
    return { name: p[0], q };
  }

  async function route({ soft = false } = {}) {
    if (!me) return;
    const r = parseHash();
    const sameView = soft && r.name === currentRoute.name && r.id === currentRoute.id;
    currentRoute = r;
    $$('.nav a[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (r.name === 'vote' || r.name === 'edit' || r.name === 'amendment' ? 'votes' : r.name)));
    const view = $('#view');
    if (!sameView) { view.innerHTML = '<div class="muted" style="padding:40px 0">Загрузка…</div>'; window.scrollTo(0, 0); }
    try {
      switch (r.name) {
        case 'dashboard': await viewDashboard(view); break;
        case 'votes': await viewVotes(view, r.q); break;
        case 'new': await viewForm(view, { mode: 'create' }); break;
        case 'edit': await viewForm(view, { mode: 'edit', id: r.id }); break;
        case 'amendment': await viewForm(view, { mode: 'amendment', id: r.id }); break;
        case 'vote': await viewVote(view, r.id, r.tab, r.q, sameView); break;
        case 'log': await viewLog(view); break;
        case 'members': await viewMembers(view); break;
        default: view.innerHTML = `<div class="card empty">${icon('alert')}Раздел не найден. <a href="#/">На дашборд</a></div>`;
      }
    } catch (e) {
      if (e.status === 401) { me = null; return renderLogin(); }
      view.innerHTML = `<div class="notice notice-danger">${icon('alert')}<div><strong>${esc(e.title)}</strong>${esc(e.human)}</div></div>`;
    }
  }
  window.addEventListener('hashchange', () => route());

  const typeLabel = (t) => meta.vote_types[t] || t;
  const voteLink = (v) => `#/votes/${v.id}`;

  // ================= Дашборд =================
  async function viewDashboard(view) {
    const d = await api('/admin/dashboard');
    counts = d.stats;
    const na = $('#nav-active'); if (na) { na.hidden = !d.stats.active; na.textContent = d.stats.active; }
    view.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Генеральная Ассамблея штата SWAG</div><h2>Дашборд</h2>
        <p>Сводка по голосованиям и активности членов Ассамблеи · ${S.fmtLong(new Date(S.now()).toISOString())}</p></div>
        <div class="actions"><a class="btn btn-primary" href="#/new">${icon('plus')} Создать голосование</a></div></div>
      <div class="stats">
        <a class="card stat accent" href="#/votes?status=active" style="text-decoration:none"><div class="l">Активные голосования</div><div class="v">${d.stats.active}</div><div class="s">запланировано: ${d.stats.pending}</div></a>
        <a class="card stat" href="#/votes?status=closed" style="text-decoration:none"><div class="l">Завершено</div><div class="v">${d.stats.closed}</div><div class="s">отменено: ${d.stats.cancelled}</div></a>
        <a class="card stat" href="#/members" style="text-decoration:none"><div class="l">Участников</div><div class="v">${d.stats.participants}</div><div class="s">голосов подано: ${d.stats.ballots}</div></a>
        <div class="card stat"><div class="l">Протоколов</div><div class="v">${d.stats.protocols}</div><div class="s">официальных документов</div></div>
      </div>
      <div class="two-col">
        <section class="card">
          <div class="card-head"><h3>Последние голосования</h3><div class="actions"><a class="btn btn-sm btn-ghost" href="#/votes">Все голосования →</a></div></div>
          ${votesTable(d.recent, { compact: true })}
        </section>
        <section class="card">
          <div class="card-head"><h3>Последняя активность</h3><div class="actions"><a class="btn btn-sm btn-ghost" href="#/log">Журнал →</a></div></div>
          ${feed(d.activity)}
        </section>
      </div>`;
    bindRows(view);
  }

  function votesTable(items, { compact = false } = {}) {
    if (!items.length) return `<div class="empty">${icon('list')}Голосований не найдено</div>`;
    return `<div class="table-wrap"><table class="table responsive"><thead><tr>
      <th>№</th><th>Название</th>${compact ? '' : '<th>Тип</th>'}<th>Статус</th>${compact ? '' : '<th>Участники</th>'}<th>Результат</th></tr></thead><tbody>
      ${items.map((v) => {
        const p = v.invited ? Math.min(100, Math.round((v.voted / v.invited) * 100)) : 0;
        return `<tr class="row-link" data-href="${voteLink(v)}">
          <td class="num-col" data-l="№">${esc(v.number)}</td>
          <td class="cell-title"><a class="t-title" href="${voteLink(v)}" style="text-decoration:none;color:inherit">${esc(v.title)}</a>
            <div class="t-sub">${compact ? esc(v.type_label) + ' · до ' + S.fmtDate(v.ends_at) + ` · проголосовали ${v.voted}/${v.invited}` : `${S.fmtDate(v.starts_at)} — ${S.fmtDate(v.ends_at)}`}${v.secret ? ' · тайное' : ''}${v.relation === 'amendment' ? ' · поправка' : v.relation === 'revote' ? ' · повторное' : ''}</div></td>
          ${compact ? '' : `<td data-l="Тип">${esc(v.type_label)}</td>`}
          <td data-l="Статус">${S.statusPill(v.status)}</td>
          ${compact ? '' : `<td data-l="Участники"><div class="mini-progress"><div class="progress"><span style="width:${p}%"></span></div><span class="t">${v.voted}/${v.invited}</span></div></td>`}
          <td data-l="Результат">${v.status === 'cancelled' ? '<span class="muted">—</span>' : S.decisionMark(v.decision)}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }
  function bindRows(el) {
    $$('tr.row-link', el).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a,button')) location.hash = tr.dataset.href; }));
  }

  const ACTION_ICON = {
    'ballot.cast': ['check', 'g'], 'vote.created': ['plus', 'y'], 'vote.closed': ['seal', ''], 'vote.closed_early': ['stop', ''],
    'vote.cancelled': ['ban', 'r'], 'invite.revoked': ['ban', 'r'], 'invite.created': ['link', 'y'], 'protocol.created': ['doc', 'y'],
    'participant.identified': ['idcard', ''], 'ballot.annulled': ['x', 'r'], 'participant.removed': ['trash', 'r'],
    'vote.updated': ['edit', ''], 'vote.rescheduled': ['calendar', ''], 'auth.login': ['lock', ''],
  };
  function actor(a) {
    if (a.actor_type === 'system') return 'Система';
    if (a.actor_type === 'speaker') return 'Спикер Конгресса';
    return `Участник ${a.actor_id || ''}`;
  }
  function detailText(a) {
    const d = a.details || {};
    const parts = [];
    if (d.name) parts.push(d.name);
    if (d.position) parts.push(d.position);
    if (d.code) parts.push(`приглашение ${d.code}`);
    if (d.invite) parts.push(`по приглашению ${d.invite}`);
    if (d.receipt) parts.push(`#${d.receipt}`);
    if (d.choice) parts.push(S.CHOICE[d.choice]);
    if (d.secret) parts.push('тайное голосование — выбор не фиксируется');
    if (d.number && a.action === 'protocol.created') parts.push(`протокол ${d.number}`);
    if (d.reason) parts.push(`причина: ${d.reason}`);
    if (d.revision) parts.push(`редакция № ${d.revision}`);
    if (d.format) parts.push(`формат ${String(d.format).toUpperCase()}`);
    if (d.title && a.action.startsWith('attachment')) parts.push(d.title);
    if (d.decision) parts.push(d.decision === 'adopted' ? 'ПРИНЯТО' : 'НЕ ПРИНЯТО');
    return parts.join(' · ');
  }
  function feed(items) {
    if (!items.length) return `<div class="empty">Событий пока нет</div>`;
    return `<ul class="feed">${items.map((a) => {
      const [ic, cls] = ACTION_ICON[a.action] || ['info', ''];
      const dt = detailText(a);
      return `<li><span class="ic ${cls}">${icon(ic)}</span><div><div class="a">${esc(a.action_label)}${a.vote_number ? ` <a href="#/votes/${a.vote_id}" style="font-size:12px;white-space:nowrap">№&nbsp;<span class="mono">${esc(a.vote_number)}</span></a>` : ''}</div>
        ${dt ? `<div class="d">${esc(dt)}</div>` : ''}<time>${S.ago(a.at)} · ${esc(actor(a))}</time></div></li>`;
    }).join('')}</ul>`;
  }

  // ================= Список голосований =================
  async function viewVotes(view, q) {
    const status = q.status || '';
    view.innerHTML = `
      <div class="page-head"><div><div class="eyebrow">Реестр</div><h2>Голосования</h2><p>Архив законопроектов и иных вопросов, вынесенных на голосование.</p></div>
        <div class="actions"><a class="btn btn-primary" href="#/new">${icon('plus')} Создать голосование</a></div></div>
      <section class="card">
        <div class="tabs" id="st-tabs">${[['', 'Все'], ['active', 'Активные'], ['pending', 'Запланированные'], ['closed', 'Завершённые'], ['cancelled', 'Отменённые']]
          .map(([k, l]) => `<button type="button" data-s="${k}" class="${k === status ? 'on' : ''}">${l}</button>`).join('')}</div>
        <form class="toolbar" id="filters">
          <label class="search"><span class="sr-only">Поиск</span>${icon('search')}<input class="input" name="q" placeholder="Поиск по номеру, названию или тексту" value="${esc(q.q || '')}"></label>
          <select class="select" name="type" aria-label="Тип документа"><option value="">Все типы</option>${Object.entries(meta.vote_types).map(([k, l]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input class="input" type="date" name="from" value="${esc(q.from || '')}" aria-label="Дата с" title="Начало — с">
          <input class="input" type="date" name="to" value="${esc(q.to || '')}" aria-label="Дата по" title="Начало — по">
        </form>
        <div id="list"><div class="empty">Загрузка…</div></div>
      </section>`;
    const f = $('#filters');
    const load = async () => {
      const params = new URLSearchParams();
      const st = $('#st-tabs .on')?.dataset.s || '';
      if (st) params.set('status', st);
      if (f.q.value.trim()) params.set('q', f.q.value.trim());
      if (f.type.value) params.set('type', f.type.value);
      if (f.from.value) params.set('from', new Date(f.from.value + 'T00:00').toISOString());
      if (f.to.value) params.set('to', new Date(f.to.value + 'T23:59:59').toISOString());
      try {
        const { items } = await api('/admin/votes?' + params);
        $('#list').innerHTML = votesTable(items); bindRows($('#list'));
      } catch (e) { $('#list').innerHTML = `<div class="empty">${esc(e.title)}: ${esc(e.human)}</div>`; }
    };
    $$('#st-tabs button').forEach((b) => b.addEventListener('click', () => { $$('#st-tabs button').forEach((x) => x.classList.toggle('on', x === b)); load(); }));
    let t; f.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
    f.addEventListener('submit', (e) => { e.preventDefault(); load(); });
    load();
  }

  // ================= Форма голосования =================
  function describeRule(r) {
    const base = { cast: 'от числа проголосовавших', cast_no_abstain: 'от голосов «ЗА» и «ПРОТИВ»', invited: 'от числа приглашённых' }[r.base] || '';
    let t = {
      simple_majority: `Простое большинство — более половины голосов ${base}`,
      qualified_majority: `Квалифицированное большинство — не менее ${r.fraction_num || '?'}/${r.fraction_den || '?'} голосов ${base}`,
      unanimous: 'Единогласное решение — все голоса поданы «ЗА»',
      fixed_count: `Не менее ${r.required_for || '?'} голосов «ЗА»`,
      percent: `${r.strict ? 'Более' : 'Не менее'} ${r.percent || '?'} % голосов «ЗА» ${base}`,
      manual: 'Решение фиксируется Спикером Конгресса по итогам голосования',
    }[r.type] || '';
    if (r.quorum_type === 'count') t += `; кворум — не менее ${r.quorum_value || '?'} участников`;
    if (r.quorum_type === 'percent') t += `; кворум — не менее ${r.quorum_value || '?'} % приглашённых`;
    return t;
  }

  async function viewForm(view, { mode, id }) {
    let v = null, parent = null;
    if (mode === 'edit') v = (await api(`/admin/votes/${id}`)).vote;
    if (mode === 'amendment') parent = (await api(`/admin/votes/${id}`)).vote;
    const started = v && v.status === 'active';
    const lockSettings = !!started;
    const now = S.now();
    const d = v || {
      type: mode === 'amendment' ? 'amendment' : 'bill', title: '', hint: '', description: '', body: '', initiator: parent?.initiator || '',
      starts_at: new Date(Math.ceil((now + 5 * 60e3) / 300000) * 300000).toISOString(),
      ends_at: new Date(Math.ceil((now + 24 * 3600e3) / 300000) * 300000).toISOString(),
      rule: parent?.rule || { type: 'simple_majority', base: 'cast', quorum_type: 'none' },
      secret: false, allow_abstain: true, show_results: true, show_voter_list: false, allow_comments: false,
      expected_participants: parent?.expected_participants ?? '',
    };
    if (mode === 'amendment' && parent) {
      d.title = `Поправка к законопроекту № ${parent.number}: `;
      d.body = `## Поправка к ${typeLabel(parent.type).toLowerCase()}у № ${parent.number}\n\nВ статье … слова «…» заменить словами «…».\n`;
    }
    const r = d.rule;
    const title = mode === 'create' ? 'Создание голосования' : mode === 'edit' ? `Редактирование голосования № ${v.number}` : `Поправка к голосованию № ${parent.number}`;
    const dis = lockSettings ? 'disabled' : '';

    view.innerHTML = `
      <div class="crumbs"><a href="#/votes">Голосования</a>${v ? ` / <a href="#/votes/${v.id}">№ ${esc(v.number)}</a>` : parent ? ` / <a href="#/votes/${parent.id}">№ ${esc(parent.number)}</a>` : ''} / ${mode === 'create' ? 'Создание' : mode === 'edit' ? 'Редактирование' : 'Поправка'}</div>
      <div class="page-head"><div><h2>${esc(title)}</h2>
        <p>${mode === 'amendment' ? `Отдельное голосование по поправке к «${esc(parent.title)}».` : 'Заполните сведения о вопросе, сроки и правило принятия решения.'}</p></div></div>
      ${lockSettings ? `<div class="notice notice-gold" style="margin-bottom:20px">${icon('info')}<div><strong>Голосование уже идёт</strong>Можно изменить текст (будет создана новая редакция), продлить срок и настройки публикации. Тип, режим тайности и правило принятия заблокированы.</div></div>` : ''}
      <form class="card" id="vf" novalidate>
        <div class="form-section">
          <h3>Предмет голосования</h3><div class="d">Название и краткие сведения отображаются участнику на главном экране голосования.</div>
          <div class="grid-2">
            <div class="field"><label for="v-type">Тип<span class="req">*</span></label>
              <select class="select" id="v-type" name="type" ${dis || (mode === 'amendment' ? 'disabled' : '')}>${Object.entries(meta.vote_types).map(([k, l]) => `<option value="${k}" ${d.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="field"><label for="v-init">Инициатор</label><input class="input" id="v-init" name="initiator" maxlength="200" value="${esc(d.initiator)}" placeholder="Например: Комитет по государственному управлению"></div>
          </div>
          <div class="field"><label for="v-title">Название<span class="req">*</span></label><input class="input" id="v-title" name="title" maxlength="300" value="${esc(d.title)}" placeholder="О внесении изменений в Закон штата SWAG «…»"></div>
          <div class="field"><label for="v-hint">Краткая подсказка</label><input class="input" id="v-hint" name="hint" maxlength="600" value="${esc(d.hint)}" placeholder="Рассматривается вопрос об …">
            <div class="hint">Одно предложение под названием — суть вопроса.</div></div>
          <div class="field"><label for="v-desc">Описание</label><textarea class="textarea" id="v-desc" name="description" rows="3" maxlength="5000">${esc(d.description)}</textarea></div>
        </div>

        <div class="form-section">
          <h3>Полный текст законопроекта / вопроса</h3><div class="d">Поддерживаются заголовки, статьи, пункты, подпункты, списки, таблицы и выделение важных положений.</div>
          <div class="editor-tabs"><button type="button" class="on" data-ed="src">Редактор</button><button type="button" data-ed="prev">Предпросмотр</button></div>
          <textarea class="textarea code" id="v-body" name="body" spellcheck="true">${esc(d.body)}</textarea>
          <div class="editor-preview prose" id="v-prev" hidden></div>
          <div class="md-help"><span><code># Глава</code> <code>## Статья 1.</code> — заголовки</span><span><code>1.</code> пункт, <code>&nbsp;&nbsp;&nbsp;1)</code> подпункт</span><span><code>- </code> список</span><span><code>| A | B |</code> таблица</span><span><code>&gt; текст</code> — важное положение</span><span><code>==текст==</code> — выделение</span><span><code>**жирный**</code></span></div>
          ${mode === 'edit' ? `<div class="field" style="margin:16px 0 0"><label for="v-note">Комментарий к редакции</label><input class="input" id="v-note" name="revision_note" maxlength="300" placeholder="Например: учтены замечания Комитета"></div>` : ''}
        </div>

        <div class="form-section">
          <h3>Сроки и состав</h3><div class="d">Голосование автоматически откроется и завершится в указанное время; по завершении будет сформирован протокол.</div>
          <div class="grid-3">
            <div class="field"><label for="v-start">Дата начала<span class="req">*</span></label><input class="input" type="datetime-local" id="v-start" name="starts_at" value="${S.toLocalInput(d.starts_at)}" ${started ? 'disabled' : ''}></div>
            <div class="field"><label for="v-end">Дата окончания<span class="req">*</span></label><input class="input" type="datetime-local" id="v-end" name="ends_at" value="${S.toLocalInput(d.ends_at)}"></div>
            <div class="field"><label for="v-exp">Количество приглашённых</label><input class="input" type="number" min="1" id="v-exp" name="expected_participants" value="${esc(d.expected_participants ?? '')}" placeholder="например, 28" ${dis}>
              <div class="hint">Для расчёта явки и кворума</div></div>
          </div>
        </div>

        <div class="form-section">
          <h3>Правило принятия</h3><div class="d">Итоговое постановление формируется автоматически по заданному правилу.</div>
          <div class="grid-2">
            <div class="field"><label for="r-type">Правило</label><select class="select" id="r-type" name="r_type" ${dis}>${Object.entries(meta.rule_types).map(([k, l]) => `<option value="${k}" ${r.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div class="field" data-rf="base"><label for="r-base">База расчёта</label><select class="select" id="r-base" name="r_base" ${dis}>
              <option value="cast" ${r.base === 'cast' ? 'selected' : ''}>От числа проголосовавших</option>
              <option value="cast_no_abstain" ${r.base === 'cast_no_abstain' ? 'selected' : ''}>От голосов «ЗА» и «ПРОТИВ»</option>
              <option value="invited" ${r.base === 'invited' ? 'selected' : ''}>От числа приглашённых</option></select></div>
          </div>
          <div class="grid-3">
            <div class="field" data-rf="qualified_majority"><label>Доля голосов «ЗА»</label><div style="display:flex;gap:8px;align-items:center">
              <input class="input" type="number" min="1" name="r_num" value="${esc(r.fraction_num ?? 2)}" ${dis}><span>/</span><input class="input" type="number" min="1" name="r_den" value="${esc(r.fraction_den ?? 3)}" ${dis}></div></div>
            <div class="field" data-rf="fixed_count"><label>Необходимо голосов «ЗА»</label><input class="input" type="number" min="1" name="r_req" value="${esc(r.required_for ?? '')}" ${dis}></div>
            <div class="field" data-rf="percent"><label>Порог, %</label><input class="input" type="number" min="1" max="100" step="0.01" name="r_pct" value="${esc(r.percent ?? 60)}" ${dis}></div>
            <div class="field" data-rf="percent"><label class="check" style="margin-top:32px"><input type="checkbox" name="r_strict" ${r.strict ? 'checked' : ''} ${dis}><span>Строго больше порога</span></label></div>
          </div>
          <div class="grid-3">
            <div class="field"><label for="q-type">Кворум</label><select class="select" id="q-type" name="q_type" ${dis}>
              <option value="none" ${r.quorum_type === 'none' || !r.quorum_type ? 'selected' : ''}>Не требуется</option>
              <option value="count" ${r.quorum_type === 'count' ? 'selected' : ''}>Минимум участников</option>
              <option value="percent" ${r.quorum_type === 'percent' ? 'selected' : ''}>Процент от приглашённых</option></select></div>
            <div class="field" data-rf="quorum"><label>Значение кворума</label><input class="input" type="number" min="1" name="q_val" value="${esc(r.quorum_value ?? '')}" ${dis}></div>
          </div>
          <div class="field"><label for="r-desc">Пояснение к правилу</label><input class="input" id="r-desc" name="r_desc" maxlength="1000" value="${esc(r.description || '')}" placeholder="Необязательно. Печатается в протоколе." ${dis}></div>
          <div class="rule-preview" id="rule-prev"></div>
        </div>

        <div class="form-section">
          <h3>Режим и публикация</h3><div class="d">Эти параметры определяют, что увидят участники.</div>
          <div class="grid-2" style="margin-bottom:10px">
            <label class="check check-card"><input type="radio" name="secret" value="0" ${!d.secret ? 'checked' : ''} ${dis}><span><b>Открытое голосование</b><small>Результаты могут показываться с указанием участников</small></span></label>
            <label class="check check-card"><input type="radio" name="secret" value="1" ${d.secret ? 'checked' : ''} ${dis}><span><b>Тайное голосование</b><small>Факт участия хранится отдельно от выбора</small></span></label>
          </div>
          ${sw('allow_abstain', 'Разрешить «Воздержался»', 'Третий вариант решения в бюллетене', d.allow_abstain, dis)}
          ${sw('show_results', 'Показывать результаты участникам', 'Итоги и постановление станут доступны по ссылке после завершения', d.show_results)}
          ${sw('show_voter_list', 'Разрешить просмотр списка проголосовавших', 'Участники увидят список; в тайном голосовании — без выбранных вариантов', d.show_voter_list)}
          ${sw('allow_comments', 'Обсуждение перед голосованием', 'Участники могут оставлять комментарии к тексту до окончания голосования', d.allow_comments)}
        </div>

        ${mode !== 'edit' ? `<div class="form-section">
          <h3>Приглашение</h3><div class="d">После создания автоматически сформируется уникальная ссылка-приглашение.</div>
          <div class="grid-3">
            <div class="field"><label for="i-exp">Срок действия</label><input class="input" type="datetime-local" id="i-exp" name="i_exp" placeholder="">
              <div class="hint">По умолчанию — до окончания голосования</div></div>
            <div class="field"><label for="i-max">Разрешённое количество голосов</label><input class="input" type="number" min="1" id="i-max" name="i_max" placeholder="= числу приглашённых">
              <div class="hint">Сколько участников может пройти по ссылке</div></div>
            <div class="field"><label class="check" style="margin-top:32px"><input type="checkbox" name="i_one" checked><span>Одно устройство — один участник<small>Ограничить повторное использование ссылки</small></span></label></div>
          </div>
        </div>` : ''}

        <div class="notice notice-danger" id="vf-err" hidden style="margin:0 28px 20px"></div>
        <div class="form-foot">
          <a class="btn btn-ghost" href="${v ? `#/votes/${v.id}` : parent ? `#/votes/${parent.id}` : '#/votes'}">Отмена</a>
          <button class="btn btn-primary btn-lg" type="submit">${mode === 'edit' ? `${icon('check')} Сохранить изменения` : `${icon('gavel')} Создать голосование`}</button>
        </div>
      </form>`;

    const f = $('#vf');
    // Редактор / предпросмотр
    $$('.editor-tabs button', f).forEach((b) => b.addEventListener('click', async () => {
      $$('.editor-tabs button', f).forEach((x) => x.classList.toggle('on', x === b));
      const prev = b.dataset.ed === 'prev';
      $('#v-body').hidden = prev; $('#v-prev').hidden = !prev;
      if (prev) {
        $('#v-prev').innerHTML = '<span class="muted">Формирование…</span>';
        try { const r2 = await api('/admin/render', { method: 'POST', body: { body: $('#v-body').value } }); $('#v-prev').innerHTML = r2.html || '<p class="muted">Текст не введён.</p>'; }
        catch (e) { $('#v-prev').textContent = e.title; }
      }
    }));
    // Условные поля правила
    const ruleFromForm = () => ({
      type: f.r_type.value, base: f.r_base.value,
      fraction_num: f.r_num.value, fraction_den: f.r_den.value, required_for: f.r_req.value,
      percent: f.r_pct.value, strict: f.r_strict.checked,
      quorum_type: f.q_type.value, quorum_value: f.q_val.value, description: f.r_desc.value,
    });
    const syncRule = () => {
      const rr = ruleFromForm();
      $$('[data-rf]', f).forEach((el) => {
        const k = el.dataset.rf;
        el.hidden = k === 'base' ? ['fixed_count', 'manual'].includes(rr.type) || (rr.type === 'unanimous' && false)
          : k === 'quorum' ? rr.quorum_type === 'none' : k !== rr.type;
      });
      $('#rule-prev').innerHTML = `${icon('gavel').replace('<svg', '<svg style="display:inline;width:15px;height:15px;vertical-align:-3px;margin-right:6px"')}${esc(describeRule(rr))}`;
    };
    f.addEventListener('input', syncRule); f.addEventListener('change', syncRule); syncRule();

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#vf-err'); err.hidden = true;
      $$('.has-error', f).forEach((x) => x.classList.remove('has-error'));
      const body = {
        type: f.type.value, title: f.title.value, initiator: f.initiator.value, hint: f.hint.value,
        description: f.description.value, body: f.body.value,
        ends_at: S.fromLocalInput(f.ends_at.value),
        show_results: f.show_results.checked, show_voter_list: f.show_voter_list.checked, allow_comments: f.allow_comments.checked,
      };
      if (!started) {
        Object.assign(body, {
          starts_at: S.fromLocalInput(f.starts_at.value),
          expected_participants: f.expected_participants.value || null,
          rule: ruleFromForm(), secret: f.querySelector('[name=secret]:checked').value === '1', allow_abstain: f.allow_abstain.checked,
        });
      }
      if (mode === 'edit' && f.revision_note) body.revision_note = f.revision_note.value;
      if (mode !== 'edit') {
        body.invite = { one_per_device: f.i_one.checked };
        if (f.i_exp.value) body.invite.expires_at = S.fromLocalInput(f.i_exp.value);
        if (f.i_max.value) body.invite.max_uses = Number(f.i_max.value);
      }
      if (!body.title.trim()) { showErr({ title: 'Проверьте введённые данные', human: 'Заполните поле «Название».', field: 'title' }); return; }
      const btn = $('button[type=submit]', f); btn.disabled = true;
      try {
        if (mode === 'edit') {
          await api(`/admin/votes/${v.id}`, { method: 'PATCH', body });
          S.toast('Изменения сохранены', `Голосование № ${v.number}`, 'success');
          location.hash = `#/votes/${v.id}`;
        } else {
          const res = await api(mode === 'amendment' ? `/admin/votes/${parent.id}/amendment` : '/admin/votes', { method: 'POST', body });
          location.hash = `#/votes/${res.vote.id}/invites?created=1`;
        }
      } catch (ex) { showErr(ex); } finally { btn.disabled = false; }
    });
    function showErr(ex) {
      const err = $('#vf-err'); err.hidden = false;
      err.innerHTML = `${icon('alert')}<div><strong>${esc(ex.title)}</strong>${esc(ex.human)}</div>`;
      const map = { title: 'title', ends_at: 'ends_at', starts_at: 'starts_at', expected_participants: 'expected_participants', expires_at: 'i_exp', max_uses: 'i_max' };
      const name = map[ex.field] || (ex.field?.startsWith('rule.') ? { 'rule.required_for': 'r_req', 'rule.percent': 'r_pct', 'rule.quorum_value': 'q_val', 'rule.fraction_num': 'r_num' }[ex.field] : null);
      const input = name && f.elements[name];
      if (input) { input.closest('.field')?.classList.add('has-error'); input.focus(); } else err.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  function sw(name, t, desc, on, dis = '') {
    return `<div class="switch-row"><div><div class="t">${t}</div><div class="d">${desc}</div></div>
      <label class="switch"><span class="sr-only">${t}</span><input type="checkbox" name="${name}" ${on ? 'checked' : ''} ${dis}></label></div>`;
  }

  // ================= Карточка голосования =================
  async function viewVote(view, id, tab, q, soft) {
    const d = await api(`/admin/votes/${id}`);
    const v = d.vote;
    const TABS = [
      ['overview', 'Обзор'], ['invites', 'Приглашения', d.invites.length], ['participants', 'Участники', d.participants.length],
      ['document', 'Документ'], ...(v.allow_comments || d.comments.length ? [['discussion', 'Обсуждение', d.comments.length]] : []), ['log', 'Журнал', d.log.length],
    ];
    const scrollY = window.scrollY;
    view.innerHTML = `
      <div class="crumbs"><a href="#/votes">Голосования</a> / № ${esc(v.number)}</div>
      <div class="page-head" style="align-items:flex-start">
        <div style="min-width:0;flex:1">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
            <span class="vote-number">Голосование № <b>${esc(v.number)}</b></span>${S.statusPill(v.status, v.status_long)}
            <span class="tag tag-navy">${esc(v.type_label)}</span>${v.secret ? '<span class="tag tag-gold">Тайное</span>' : '<span class="tag">Открытое</span>'}
          </div>
          <h2 style="font-size:24px;line-height:1.3">${esc(v.title)}</h2>
          ${v.hint ? `<p>${esc(v.hint)}</p>` : ''}
          ${d.parent ? `<p style="margin-top:8px">${icon('branch').replace('<svg', '<svg style="display:inline;width:14px;height:14px;vertical-align:-2px"')} ${v.relation === 'amendment' ? 'Поправка к' : 'Повторное голосование по'} <a href="#/votes/${d.parent.id}">№ ${esc(d.parent.number)} «${esc(d.parent.title)}»</a></p>` : ''}
        </div>
      </div>
      <section class="card">
        <div class="tabs">${TABS.map(([k, l, c]) => `<a href="#/votes/${v.id}${k === 'overview' ? '' : '/' + k}" class="${k === tab ? 'on' : ''}">${l}${c != null ? `<span class="c">${c}</span>` : ''}</a>`).join('')}</div>
        <div id="tab"></div>
      </section>`;
    const el = $('#tab');
    ({ overview: tabOverview, invites: tabInvites, participants: tabParticipants, document: tabDocument, discussion: tabDiscussion, log: tabLog }[tab] || tabOverview)(el, d, q);
    if (soft) window.scrollTo(0, scrollY);
  }

  const reload = () => route({ soft: true });

  function tabOverview(el, d) {
    const v = d.vote, s = d.summary;
    const keys = v.allow_abstain ? ['for', 'against', 'abstain'] : ['for', 'against'];
    const turnoutPct = s.invited ? Math.min(100, Math.round((s.voted / s.invited) * 100)) : 0;
    const verdict = s.evaluation.decision && { adopted: ['ПРИНЯТО', 'c-for', 'check'], rejected: ['НЕ ПРИНЯТО', 'c-against', 'x'], pending: ['ОЖИДАЕТ РЕШЕНИЯ СПИКЕРА', 'c-abstain', 'clock'] }[s.evaluation.decision];
    const endMs = Date.parse(v.status === 'pending' ? v.starts_at : v.ends_at);
    el.innerHTML = `<div class="card-body"><div class="detail-grid">
      <div>
        ${v.status === 'cancelled' ? `<div class="notice notice-danger" style="margin-bottom:20px">${icon('ban')}<div><strong>Голосование отменено ${S.fmtDate(v.cancelled_at)}</strong>${esc(v.cancel_reason || 'Причина не указана')}</div></div>` : ''}
        ${['active', 'pending'].includes(v.status) ? `<div class="notice notice-info" style="margin-bottom:20px">${icon('clock')}<div><strong>${v.status === 'active' ? 'До окончания голосования' : 'До начала голосования'}: <span class="countdown mono" data-until="${endMs}"></span></strong>
          ${v.status === 'active' ? `Окончание ${S.fmtLong(v.ends_at)}` : `Начало ${S.fmtLong(v.starts_at)}`}</div></div>` : ''}
        <h3 style="font-size:17px;margin-bottom:14px">Участие</h3>
        <div class="stat-strip" style="margin-top:0">
          <div><div class="l">Приглашено</div><div class="v">${s.invited}</div></div>
          <div><div class="l">Проголосовали</div><div class="v">${s.voted}</div></div>
          <div><div class="l">Не проголосовали</div><div class="v">${s.not_voted}</div></div>
          <div><div class="l">Явка</div><div class="v">${S.pct(s.turnout)}</div></div>
        </div>
        <div class="progress" style="margin-top:12px"><span style="width:${turnoutPct}%"></span></div>
        <p class="muted" style="font-size:12.5px;margin-top:8px">Прошли идентификацию: ${s.identified}${s.invited_declared ? '' : ' · число приглашённых не задано — расчёт по прошедшим идентификацию'}</p>

        <h3 style="font-size:17px;margin:28px 0 14px">${v.status === 'closed' ? 'Результаты голосования' : 'Промежуточный подсчёт'}</h3>
        ${d.tally_hidden ? `<div class="notice notice-gold">${icon('lock')}<div><strong>Тайное голосование</strong>Распределение голосов скрыто до завершения, чтобы по времени голосования нельзя было установить выбор конкретного участника.</div></div>`
          : `<div class="results-grid">${S.donut(s.tally, keys)}<div>${S.tallyRows(s.tally, v.allow_abstain)}
            ${s.evaluation.required_for != null ? `<p class="muted" style="font-size:13px;margin-top:14px">Для принятия требуется «ЗА»: <b>${s.evaluation.required_for}</b>${s.evaluation.quorum_met ? '' : ' · <b class="c-against">кворум не достигнут</b>'}</p>` : ''}</div></div>`}

        ${v.status === 'closed' && s.resolution ? `<div class="resolution">
          <span class="eyebrow">Генеральная Ассамблея штата SWAG</span><h3>ПОСТАНОВЛЕНИЕ ПО РЕЗУЛЬТАТАМ ГОЛОСОВАНИЯ</h3>
          <p>${esc(s.resolution)}</p>
          ${verdict ? `<div class="verdict"><span class="verdict-badge ${verdict[1]}">${icon(verdict[2])} ${verdict[0]}</span></div>` : ''}
          ${s.evaluation.decision === 'pending' ? `<div class="btn-group" style="justify-content:center;margin-top:16px">
            <button class="btn btn-sm" data-dec="adopted">${icon('check')} Зафиксировать: ПРИНЯТО</button>
            <button class="btn btn-sm btn-danger" data-dec="rejected">${icon('x')} Зафиксировать: НЕ ПРИНЯТО</button></div>` : ''}
        </div>` : ''}

        ${d.protocol ? `<div class="invite-box" style="margin-top:20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <div class="feature-icon" style="margin:0">${icon('seal')}</div>
          <div style="flex:1;min-width:200px"><div class="eyebrow eyebrow-muted">Официальный протокол</div>
            <div style="font:700 18px var(--serif)">Протокол № ${esc(d.protocol.number)}</div>
            <div class="muted" style="font-size:12.5px">Сформирован ${S.fmtDate(d.protocol.created_at)}</div></div>
          <div class="btn-group"><a class="btn" href="/speaker/protocol/${v.id}" target="_blank">${icon('eye')} Открыть</a>
            <button class="btn btn-primary" data-pdf="${v.id}">${icon('download')} Скачать протокол PDF</button></div></div>` : ''}

        ${d.children.length ? `<h3 style="font-size:17px;margin:28px 0 12px">Связанные голосования</h3><ul class="attach-list">${d.children.map((c) => `<li><a href="#/votes/${c.id}">${icon(c.relation === 'amendment' ? 'branch' : 'repeat')}<span><b>№&nbsp;<span class="mono">${esc(c.number)}</span></b> · ${c.relation === 'amendment' ? 'поправка' : 'повторное'} · ${esc(c.title)}</span></a></li>`).join('')}</ul>` : ''}
      </div>

      <aside>
        <div class="card side-card"><div class="card-body">
          <dl class="kv">
            <dt>Тип</dt><dd>${esc(v.type_label)}</dd>
            <dt>Инициатор</dt><dd>${esc(v.initiator || '—')}</dd>
            <dt>Спикер</dt><dd>${esc(v.speaker_name)}</dd>
            <dt>Начало</dt><dd>${S.fmtDate(v.starts_at)}</dd>
            <dt>Окончание</dt><dd>${S.fmtDate(v.closed_at || v.ends_at)}${v.closed_early ? ' (досрочно)' : ''}</dd>
            <dt>Правило принятия</dt><dd>${esc(v.rule_text)}</dd>
            <dt>Режим</dt><dd>${v.secret ? 'Тайное' : 'Открытое'} · «Воздержался» ${v.allow_abstain ? 'разрешён' : 'не допускается'}</dd>
            <dt>Публикация</dt><dd>Результаты: ${v.show_results ? 'показываются' : 'скрыты'} · Список: ${v.show_voter_list ? 'открыт' : 'скрыт'}</dd>
          </dl>
        </div></div>
        <div class="card side-card" style="margin-top:16px"><div class="card-body">
          <div class="eyebrow eyebrow-muted" style="margin-bottom:12px">Действия</div>
          <div class="action-list">
            ${['active', 'pending'].includes(v.status) ? `
              <a class="btn" href="#/votes/${v.id}/edit">${icon('edit')} Редактировать</a>
              <button class="btn" data-a="reschedule">${icon('calendar')} Перенести / продлить</button>
              <a class="btn" href="#/votes/${v.id}/amendment">${icon('branch')} Вынести поправку</a>
              <button class="btn" data-a="close">${icon('stop')} Завершить досрочно</button>
              <button class="btn btn-danger" data-a="cancel">${icon('ban')} Отменить голосование</button>` : ''}
            ${['closed', 'cancelled'].includes(v.status) ? `<button class="btn" data-a="revote">${icon('repeat')} Повторное голосование</button>` : ''}
            ${v.status === 'closed' ? `<a class="btn" href="#/votes/${v.id}/amendment">${icon('branch')} Вынести поправку</a>` : ''}
            ${!(v.secret && v.status !== 'closed') ? `<a class="btn" href="/api/admin/votes/${v.id}/export.csv">${icon('download')} Экспорт CSV</a>
            <a class="btn" href="/api/admin/votes/${v.id}/export.json">${icon('download')} Экспорт JSON</a>` : ''}
          </div>
        </div></div>
      </aside>
    </div></div>`;

    // Таймер
    const cd = $('.countdown', el);
    if (cd) {
      const tick = () => { if (!document.body.contains(cd)) return clearInterval(h); const left = Number(cd.dataset.until) - S.now(); cd.textContent = S.duration(left); if (left <= 0) { clearInterval(h); setTimeout(reload, 1500); } };
      const h = setInterval(tick, 1000); tick();
    }
    const act = async (a) => {
      if (a === 'close') {
        if (!await S.confirmDialog({ title: 'Завершить досрочно?', text: `Приём голосов по голосованию № ${esc(v.number)} будет прекращён, итоги подведены и сформирован протокол. Действие необратимо.`, confirmLabel: 'Завершить голосование' })) return;
        await api(`/admin/votes/${v.id}/close`, { method: 'POST', body: {} }); S.toast('Голосование завершено', 'Протокол сформирован', 'success');
      }
      if (a === 'cancel') {
        const reason = await S.confirmDialog({ title: 'Отменить голосование?', text: 'Голоса больше не будут приниматься, решение не принимается. Действие необратимо.', confirmLabel: 'Отменить голосование', danger: true, input: { label: 'Причина отмены', placeholder: 'Будет показана участникам' } });
        if (reason === null) return;
        await api(`/admin/votes/${v.id}/cancel`, { method: 'POST', body: { reason } }); S.toast('Голосование отменено');
      }
      if (a === 'reschedule') return rescheduleModal(v);
      if (a === 'revote') return revoteModal(v);
      reload();
    };
    $$('[data-a]', el).forEach((b) => b.addEventListener('click', () => act(b.dataset.a).catch(S.toastError)));
    $$('[data-pdf]', el).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await SWAG_PDF.download(d.protocol); } catch (e) { S.toast('Не удалось сформировать PDF', e.message, 'error'); } finally { b.disabled = false; }
    }));
    $$('[data-dec]', el).forEach((b) => b.addEventListener('click', async () => {
      const dec = b.dataset.dec;
      if (!await S.confirmDialog({ title: 'Зафиксировать решение', text: `Решение «${dec === 'adopted' ? 'ПРИНЯТО' : 'НЕ ПРИНЯТО'}» будет внесено в протокол.`, confirmLabel: 'Зафиксировать' })) return;
      try { await api(`/admin/votes/${v.id}/decision`, { method: 'POST', body: { decision: dec } }); reload(); } catch (e) { S.toastError(e); }
    }));
  }

  function rescheduleModal(v) {
    S.modal({
      title: 'Перенос голосования',
      body: `<p style="margin:0 0 16px;color:var(--ink-2)">Участники получат уведомление об изменении сроков. Приглашения, срок которых совпадал с окончанием, будут продлены автоматически.</p>
        <div class="grid-2"><div class="field"><label>Дата начала</label><input class="input" type="datetime-local" id="rs-s" value="${S.toLocalInput(v.starts_at)}" ${v.status === 'active' ? 'disabled' : ''}></div>
        <div class="field"><label>Дата окончания</label><input class="input" type="datetime-local" id="rs-e" value="${S.toLocalInput(v.ends_at)}"></div></div>`,
      actions: [{ label: 'Отмена', class: 'btn-ghost' }, { label: 'Сохранить сроки', class: 'btn-primary', onClick: async ({ body }) => {
        const b = { ends_at: S.fromLocalInput($('#rs-e', body).value) };
        if (v.status !== 'active') b.starts_at = S.fromLocalInput($('#rs-s', body).value);
        await api(`/admin/votes/${v.id}`, { method: 'PATCH', body: b }); S.toast('Сроки изменены', '', 'success'); reload();
      } }],
    });
  }

  function revoteModal(v) {
    const st = new Date(Math.ceil((S.now() + 5 * 60e3) / 300000) * 300000).toISOString();
    const en = new Date(Date.parse(st) + 24 * 3600e3).toISOString();
    S.modal({
      title: 'Повторное голосование',
      body: `<p style="margin:0 0 16px;color:var(--ink-2)">Будет создано новое голосование с новым номером, теми же материалами и правилом принятия, а также новое приглашение.</p>
        <div class="grid-2"><div class="field"><label>Дата начала</label><input class="input" type="datetime-local" id="rv-s" value="${S.toLocalInput(st)}"></div>
        <div class="field"><label>Дата окончания</label><input class="input" type="datetime-local" id="rv-e" value="${S.toLocalInput(en)}"></div></div>`,
      actions: [{ label: 'Отмена', class: 'btn-ghost' }, { label: 'Назначить', class: 'btn-primary', onClick: async ({ body }) => {
        const r = await api(`/admin/votes/${v.id}/revote`, { method: 'POST', body: { starts_at: S.fromLocalInput($('#rv-s', body).value), ends_at: S.fromLocalInput($('#rv-e', body).value) } });
        location.hash = `#/votes/${r.vote.id}/invites?created=1`;
      } }],
    });
  }

  // ----- Приглашения -----
  function tabInvites(el, d, q) {
    const v = d.vote;
    const canCreate = !['closed', 'cancelled'].includes(v.status);
    const main = d.invites.find((i) => ['active', 'pending'].includes(i.status));
    el.innerHTML = `<div class="card-body">
      ${q.created && main ? `<div class="success-hero">
        <div class="state-icon ok">${icon('check')}</div>
        <div class="eyebrow">Голосование № ${esc(v.number)}</div>
        <h2 style="margin-top:6px">Голосование создано</h2>
        <p class="muted" style="margin-top:8px">Отправьте участникам уникальную ссылку-приглашение или QR-код.</p>
      </div>` : ''}
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
        <h3 style="font-size:17px">Приглашения</h3>
        ${canCreate ? `<button class="btn btn-sm" style="margin-left:auto" id="new-inv">${icon('plus')} Создать новую ссылку</button>` : ''}
      </div>
      ${d.invites.map((i) => inviteBox(i, v)).join('') || '<div class="empty">Приглашений нет</div>'}
    </div>`;
    $$('.invite-url input', el).forEach((i) => i.addEventListener('focus', () => i.select()));
    $$('[data-inv]', el).forEach((b) => b.addEventListener('click', () => inviteAction(b.dataset.inv, Number(b.dataset.id), d).catch(S.toastError)));
    const n = $('#new-inv'); if (n) n.addEventListener('click', () => newInviteModal(v));
  }

  function inviteBox(i, v) {
    const live = ['active', 'pending'].includes(i.status);
    const st = { active: 'active', pending: 'pending', revoked: 'cancelled', expired: 'closed', exhausted: 'closed', closed: 'closed', cancelled: 'cancelled' }[i.status];
    return `<div class="invite-box">
      <div class="invite-top"><b>${esc(i.label)}</b>${S.statusPill(st, i.status_label)}<span class="mono muted" style="margin-left:auto;font-size:13px">ID ${esc(i.code)}</span></div>
      <div class="invite-url"><input readonly value="${esc(i.url)}" aria-label="Ссылка-приглашение">
        <button class="btn" data-inv="copy" data-id="${i.id}">${icon('copy')} Копировать ссылку</button></div>
      <div class="invite-meta">
        <span>Создано: <b>${S.fmtDate(i.created_at)}</b></span>
        <span>Действует до: <b>${S.fmtDate(i.expires_at)}</b></span>
        <span>Использовано: <b>${i.uses}${i.max_uses ? ` из ${i.max_uses}` : ' (без ограничения)'}</b></span>
        <span>Повторное использование: <b>${i.one_per_device ? 'ограничено' : 'разрешено'}</b></span>
        ${i.revoked_at ? `<span>Отозвано: <b>${S.fmtDate(i.revoked_at)}</b></span>` : ''}
      </div>
      <div class="invite-actions">
        <button class="btn btn-sm" data-inv="qr" data-id="${i.id}">${icon('qr')} Создать QR-код</button>
        ${live || i.status === 'expired' || i.status === 'exhausted' ? `<button class="btn btn-sm" data-inv="extend" data-id="${i.id}">${icon('calendar')} Продлить срок действия</button>` : ''}
        ${!i.revoked_at && !['closed', 'cancelled'].includes(i.status) ? `<button class="btn btn-sm btn-danger" data-inv="revoke" data-id="${i.id}">${icon('ban')} Отозвать приглашение</button>` : ''}
      </div></div>`;
  }

  async function inviteAction(a, id, d) {
    const inv = d.invites.find((x) => x.id === id);
    if (a === 'copy') return S.copyText(inv.url);
    if (a === 'qr') {
      return S.modal({
        title: 'QR-код приглашения',
        body: `<div class="qr-box"><img src="/api/admin/invites/${id}/qr.svg" alt="QR-код приглашения ${esc(inv.code)}">
          <div class="code">${esc(inv.code)}</div><p class="muted" style="margin:0;text-align:center;font-size:13px">Голосование № ${esc(d.vote.number)} · ${esc(d.vote.title)}</p></div>`,
        actions: [{ label: 'Закрыть', class: 'btn-ghost' }, { html: `${icon('download')} Скачать PNG`, class: 'btn-primary', close: false, onClick: () => qrPng(id, inv.code) }],
      });
    }
    if (a === 'revoke') {
      if (!await S.confirmDialog({ title: 'Отозвать приглашение?', text: `Ссылка <span class="mono">${esc(inv.code)}</span> перестанет действовать для новых участников. Уже идентифицированные участники сохранят доступ.`, confirmLabel: 'Отозвать', danger: true })) return;
      await api(`/admin/invites/${id}/revoke`, { method: 'POST', body: {} }); S.toast('Приглашение отозвано'); return reload();
    }
    if (a === 'extend') {
      return S.modal({
        title: 'Продление приглашения',
        body: `<div class="grid-2"><div class="field"><label>Действует до</label><input class="input" type="datetime-local" id="ex-d" value="${S.toLocalInput(Math.max(Date.parse(inv.expires_at), Date.parse(d.vote.ends_at)) === Date.parse(inv.expires_at) ? inv.expires_at : d.vote.ends_at)}"></div>
          <div class="field"><label>Лимит голосов</label><input class="input" type="number" min="1" id="ex-m" value="${esc(inv.max_uses ?? '')}"></div></div>`,
        actions: [{ label: 'Отмена', class: 'btn-ghost' }, { label: 'Продлить', class: 'btn-primary', onClick: async ({ body }) => {
          const b = { expires_at: S.fromLocalInput($('#ex-d', body).value) };
          if ($('#ex-m', body).value) b.max_uses = Number($('#ex-m', body).value);
          await api(`/admin/invites/${id}/extend`, { method: 'POST', body: b }); S.toast('Срок действия продлён', '', 'success'); reload();
        } }],
      });
    }
  }

  /** PNG-версия QR-кода для печати и отправки — рисуется в браузере из SVG. */
  async function qrPng(id, code) {
    const svg = await (await fetch(`/api/admin/invites/${id}/qr.svg`, { credentials: 'same-origin' })).text();
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const size = 1024, cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, size, size); g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, size, size);
    URL.revokeObjectURL(url);
    const a = document.createElement('a');
    a.download = `SWAG-приглашение-${code}.png`;
    a.href = cv.toDataURL('image/png');
    a.click();
  }

  function newInviteModal(v) {
    S.modal({
      title: 'Новая ссылка-приглашение',
      body: `<div class="field"><label>Метка</label><input class="input" id="ni-l" maxlength="100" placeholder="Например: для членов Конгресса"></div>
        <div class="grid-2"><div class="field"><label>Действует до</label><input class="input" type="datetime-local" id="ni-d" value="${S.toLocalInput(v.ends_at)}"></div>
        <div class="field"><label>Разрешённое количество голосов</label><input class="input" type="number" min="1" id="ni-m" placeholder="без ограничения"></div></div>
        <label class="check"><input type="checkbox" id="ni-o" checked><span>Ограничить повторное использование ссылки (одно устройство — один участник)</span></label>`,
      actions: [{ label: 'Отмена', class: 'btn-ghost' }, { label: 'Создать ссылку', class: 'btn-primary', onClick: async ({ body }) => {
        const b = { label: $('#ni-l', body).value, expires_at: S.fromLocalInput($('#ni-d', body).value), one_per_device: $('#ni-o', body).checked };
        if ($('#ni-m', body).value) b.max_uses = Number($('#ni-m', body).value);
        await api(`/admin/votes/${v.id}/invites`, { method: 'POST', body: b }); S.toast('Приглашение создано', '', 'success'); reload();
      } }],
    });
  }

  // ----- Участники -----
  function tabParticipants(el, d) {
    const v = d.vote, s = d.summary;
    const waitingIdent = Math.max(0, (v.expected_participants || 0) - d.participants.length);
    el.innerHTML = `
      ${v.secret ? `<div class="card-body" style="padding-bottom:0"><div class="notice notice-gold">${icon('lock')}<div><strong>Тайное голосование</strong>Список показывает только факт участия. Выбор участников хранится отдельно и не может быть сопоставлен с ними.</div></div></div>` : ''}
      ${d.participants.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr>
        <th>ФИО</th><th>Должность</th><th>Организация</th>${v.secret ? '' : '<th>Голос</th>'}<th>Время</th><th>Статус</th><th></th></tr></thead><tbody>
        ${d.participants.map((p) => `<tr>
          <td class="cell-title"><span class="t-title">${esc(p.name)}</span>${p.receipt_no ? `<div class="t-sub mono">#${esc(p.receipt_no)}</div>` : ''}</td>
          <td data-l="Должность">${esc(p.position_title)}</td>
          <td data-l="Организация">${esc([p.organization, p.division].filter(Boolean).join(' — ') || '—')}</td>
          ${v.secret ? '' : `<td data-l="Голос">${p.choice ? `<b class="c-${p.choice}">${S.CHOICE[p.choice]}</b>` : '—'}</td>`}
          <td data-l="Время" class="nowrap">${S.fmtDate(p.voted_at || p.identified_at)}</td>
          <td data-l="Статус">${p.has_voted ? '<span class="c-for" style="font-weight:600">✓ проголосовал</span>' : '<span class="muted" style="font-weight:600">◷ ожидает голосования</span>'}</td>
          <td style="white-space:nowrap">${!['closed', 'cancelled'].includes(v.status) ? (p.has_voted
            ? `<button class="btn btn-sm btn-ghost" data-annul="${p.id}" title="Аннулировать голос">${icon('x')}</button>`
            : `<button class="btn btn-sm btn-ghost" data-reset="${p.id}" title="Сбросить идентификацию">${icon('refresh')}</button>`)
            + `<button class="btn btn-sm btn-ghost" data-remove="${p.id}" title="Удалить участника" style="color:var(--red)">${icon('trash')}</button>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>` : `<div class="empty">${icon('users')}Участники ещё не проходили идентификацию</div>`}
      <div class="card-body" style="border-top:1px solid var(--line-2);font-size:13px;color:var(--muted);display:flex;gap:20px;flex-wrap:wrap">
        <span>Проголосовали: <b style="color:var(--ink)">${s.voted}</b></span>
        <span>Ожидают голосования: <b style="color:var(--ink)">${d.participants.length - s.voted}</b></span>
        ${v.expected_participants ? `<span>Не прошли идентификацию: <b style="color:var(--ink)">${waitingIdent}</b></span>` : ''}
      </div>`;
    $$('[data-reset]', el).forEach((b) => b.addEventListener('click', async () => {
      if (!await S.confirmDialog({ title: 'Сбросить идентификацию?', text: 'Участник сможет заново пройти идентификацию по приглашению (например, если утратил доступ с устройства). Проголосовавших сбросить нельзя.', confirmLabel: 'Сбросить' })) return;
      try { await api(`/admin/participants/${b.dataset.reset}/reset`, { method: 'POST', body: {} }); reload(); } catch (e) { S.toastError(e); }
    }));
    $$('[data-annul]', el).forEach((b) => b.addEventListener('click', async () => {
      if (!await S.confirmDialog({ title: 'Аннулировать голос?', text: 'Голос участника будет аннулирован и удалён из подсчёта. Участник сможет проголосовать заново (в открытом голосовании) или будет удалён (в тайном).', confirmLabel: 'Аннулировать', danger: true })) return;
      try { await api(`/admin/participants/${b.dataset.annul}/annul`, { method: 'POST', body: {} }); reload(); } catch (e) { S.toastError(e); }
    }));
    $$('[data-remove]', el).forEach((b) => b.addEventListener('click', async () => {
      if (!await S.confirmDialog({ title: 'Удалить участника?', text: 'Участник и его голос (если есть) будут полностью удалены. Действие необратимо.', confirmLabel: 'Удалить', danger: true })) return;
      try { await api(`/admin/participants/${b.dataset.remove}/remove`, { method: 'POST', body: {} }); reload(); } catch (e) { S.toastError(e); }
    }));
  }

  // ----- Документ -----
  async function tabDocument(el, d) {
    const v = d.vote;
    const r = await api('/admin/render', { method: 'POST', body: { body: v.body } });
    el.innerHTML = `<div class="card-body"><div class="detail-grid">
      <div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
          ${!['closed', 'cancelled'].includes(v.status) ? `<a class="btn btn-sm" href="#/votes/${v.id}/edit">${icon('edit')} Редактировать текст</a>` : ''}
          <a class="btn btn-sm" href="/api/admin/votes/${v.id}/document.html">${icon('download')} Скачать документ</a>
        </div>
        <article class="paper" style="padding:40px 44px;border:1px solid var(--line)"><div class="prose">${r.html || '<p class="muted">Полный текст не приложен.</p>'}</div></article>
      </div>
      <aside>
        <div class="card side-card"><div class="card-head"><h3>${icon('history').replace('<svg', '<svg style="width:17px;height:17px;display:inline;vertical-align:-3px"')} История редакций</h3></div>
          <ul class="feed">${d.revisions.map((x) => `<li style="cursor:pointer" data-rev="${x.revision_no}"><span class="ic y">${x.revision_no}</span><div><div class="a">Редакция № ${x.revision_no}${x.revision_no === d.revisions[0].revision_no ? ' <span class="tag tag-gold">действующая</span>' : ''}</div>
            <div class="d">${esc(x.note || '—')}</div><time>${S.fmtDate(x.created_at)}</time></div></li>`).join('')}</ul></div>
        <div class="card side-card" style="margin-top:16px"><div class="card-head"><h3>Приложенные документы</h3></div><div class="card-body">
          ${d.attachments.length ? `<ul class="attach-list" style="margin:0 0 14px">${d.attachments.map((a) => `<li style="display:flex;gap:6px"><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" style="flex:1">${icon('paperclip')}<span>${esc(a.title)}</span></a>
            <button class="btn btn-ghost btn-icon btn-sm" data-del-att="${a.id}" aria-label="Удалить">${icon('trash')}</button></li>`).join('')}</ul>` : '<p class="muted" style="font-size:13.5px">Документы не прикреплены.</p>'}
          <form id="att-f"><div class="field" style="margin-bottom:8px"><input class="input" name="title" placeholder="Название документа" maxlength="200"></div>
            <div class="field" style="margin-bottom:10px"><input class="input" name="url" placeholder="https://…" maxlength="1000"></div>
            <button class="btn btn-sm" type="submit">${icon('paperclip')} Прикрепить</button></form>
        </div></div>
      </aside></div></div>`;
    $$('[data-rev]', el).forEach((li) => li.addEventListener('click', async () => {
      try {
        const rv = await api(`/admin/votes/${v.id}/revisions/${li.dataset.rev}`);
        S.modal({ wide: true, title: `Редакция № ${rv.revision_no}`, body: `<p class="muted" style="margin-top:0">${esc(rv.note || '')} · ${S.fmtDate(rv.created_at)}</p><h3 style="margin-bottom:12px">${esc(rv.title)}</h3><div class="prose">${rv.html || '<p class="muted">Текст отсутствует.</p>'}</div>`, actions: [{ label: 'Закрыть', class: 'btn-primary' }] });
      } catch (e) { S.toastError(e); }
    }));
    $('#att-f', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(`/admin/votes/${v.id}/attachments`, { method: 'POST', body: { title: e.target.title.value, url: e.target.url.value } }); reload(); } catch (x) { S.toastError(x); }
    });
    $$('[data-del-att]', el).forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/admin/attachments/${b.dataset.delAtt}`, { method: 'DELETE', body: {} }); reload(); } catch (x) { S.toastError(x); }
    }));
  }

  // ----- Обсуждение -----
  function tabDiscussion(el, d) {
    el.innerHTML = `<div class="card-body">${d.comments.length ? `<div class="comments">${d.comments.map((c) => `<div class="comment ${c.hidden ? 'hidden-c' : ''}">
      <div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1"><div class="a">${esc(c.author_label)}</div><time>${S.fmtDate(c.created_at)}${c.hidden ? ' · скрыт' : ''}</time></div>
      ${c.hidden ? '' : `<button class="btn btn-sm btn-ghost" data-hide="${c.id}">${icon('eye')} Скрыть</button>`}</div>
      <div class="b">${esc(c.body)}</div></div>`).join('')}</div>` : `<div class="empty">${icon('message')}Комментариев нет</div>`}</div>`;
    $$('[data-hide]', el).forEach((b) => b.addEventListener('click', async () => {
      try { await api(`/admin/comments/${b.dataset.hide}/hide`, { method: 'POST', body: {} }); reload(); } catch (e) { S.toastError(e); }
    }));
  }

  // ----- Журнал голосования -----
  function tabLog(el, d) { el.innerHTML = logTable(d.log, false); }

  function logTable(items, withVote = true) {
    if (!items.length) return '<div class="empty">Событий нет</div>';
    return `<div class="table-wrap"><table class="table responsive log-table"><thead><tr><th>Дата</th><th>Время</th><th>Действие</th>${withVote ? '<th>Голосование</th>' : ''}<th>Идентификатор</th><th>Подробности</th></tr></thead><tbody>
      ${items.map((a) => `<tr>
        <td data-l="Дата" class="nowrap">${S.fmtDate(a.at, { time: false })}</td>
        <td data-l="Время" class="mono nowrap">${new Date(a.at).toLocaleTimeString('ru-RU')}</td>
        <td class="cell-title"><b>${esc(a.action_label)}</b></td>
        ${withVote ? `<td data-l="Голосование">${a.vote_id ? `<a href="#/votes/${a.vote_id}" class="nowrap">№&nbsp;<span class="mono">${esc(a.vote_number)}</span></a>` : '—'}</td>` : ''}
        <td data-l="Идентификатор" class="who">${esc(a.actor_type === 'speaker' ? `speaker:${a.actor_id}` : a.actor_type === 'system' ? `system:${a.actor_id || ''}` : a.actor_id)}</td>
        <td data-l="Подробности" style="max-width:360px">${esc(detailText(a) || '—')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  // ================= Журнал событий =================
  async function viewLog(view) {
    let items = (await api('/admin/log?limit=150')).items;
    view.innerHTML = `<div class="page-head"><div><div class="eyebrow">Аудит</div><h2>Журнал событий</h2><p>Все действия в системе с датой, временем и идентификатором пользователя или системы.</p></div></div>
      <section class="card"><div id="log-t">${logTable(items)}</div>
      <div class="card-body" style="text-align:center;border-top:1px solid var(--line-2)"><button class="btn btn-sm" id="more" ${items.length < 150 ? 'hidden' : ''}>Загрузить ещё</button></div></section>`;
    $('#more').addEventListener('click', async () => {
      const more = (await api(`/admin/log?limit=150&before=${items[items.length - 1].id}`)).items;
      items = items.concat(more); $('#log-t').innerHTML = logTable(items);
      if (more.length < 150) $('#more').hidden = true;
    });
  }

  // ================= Статистика участников =================
  async function viewMembers(view) {
    const m = await api('/admin/members');
    view.innerHTML = `<div class="page-head"><div><div class="eyebrow">Аналитика</div><h2>Статистика активности членов Ассамблеи</h2>
      <p>Участие в голосованиях по данным идентификации. Завершённых голосований: ${m.total_closed_votes}.</p></div></div>
      <section class="card">${m.members.length ? `<div class="table-wrap"><table class="table responsive"><thead><tr><th>Участник</th><th>Должность</th><th>Проголосовал</th><th>Активность</th><th>Последний голос</th></tr></thead><tbody>
        ${m.members.map((x) => { const p = m.total_closed_votes ? Math.min(100, Math.round((x.voted / Math.max(m.total_closed_votes, x.voted)) * 100)) : 0;
          return `<tr><td class="cell-title"><span class="t-title">${esc(x.name)}</span></td><td data-l="Должность">${esc(x.position || '—')}</td>
          <td data-l="Проголосовал" class="num">${x.voted} ${S.plural(x.voted, 'раз', 'раза', 'раз')}</td>
          <td data-l="Активность"><div class="mini-progress"><div class="progress"><span style="width:${p}%"></span></div><span class="t">${p}%</span></div></td>
          <td data-l="Последний голос" class="nowrap">${x.last_voted_at ? S.fmtDate(x.last_voted_at) : '—'}</td></tr>`; }).join('')}
      </tbody></table></div>` : `<div class="empty">${icon('users')}Данных пока нет</div>`}</section>`;
  }

  boot();
})();
