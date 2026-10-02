/* Страница участника голосования: идентификация → изучение документа → решение → подтверждение. */
'use strict';
(() => {
  const S = SWAG;
  const { $, $$, esc, icon, api } = S;
  const app = $('#app');
  const code = decodeURIComponent(location.pathname.split('/')[2] || '');
  const base = `/v/${encodeURIComponent(code)}`;

  let state = null;
  let timer = null;
  let busy = false;           // пользователь в процессе выбора — не перерисовываем при фоновом опросе
  let lastReceipt = null;

  $('#loading-icon').innerHTML = icon('clock');

  // ---------- загрузка ----------
  async function load({ quiet = false } = {}) {
    try {
      const s = await api(base);
      S.syncClock(s.server_time);
      const changed = !state || JSON.stringify(sig(s)) !== JSON.stringify(sig(state));
      state = s;
      if (!quiet || (changed && !busy)) render();
      if (s.participant?.identified) startNotifications();
    } catch (e) {
      if (!quiet) renderError({ title: e.title, message: e.human, code: e.code }, null);
    }
  }
  const sig = (s) => [s.ok, s.error?.code, s.vote?.status, s.participant?.identified, s.participant?.has_voted, s.participant?.admission, s.vote?.revision, s.vote?.ends_at];

  // ---------- общие блоки ----------
  function voteHeader(v) {
    const tStart = Date.parse(v.starts_at), tEnd = Date.parse(v.ends_at);
    let remaining;
    if (v.status === 'active') remaining = `<span class="countdown" data-until="${tEnd}"></span>`;
    else if (v.status === 'pending') remaining = `до начала <span class="countdown" data-until="${tStart}"></span>`;
    else remaining = '—';
    return `<section class="card vote-head">
      <div class="vote-head-top">
        <div class="vote-number">Голосование № <b>${esc(v.number)}</b></div>
        ${S.statusPill(v.status, v.status_long, true)}
      </div>
      <dl class="meta-grid">
        <div><dt>Инициатор</dt><dd>${esc(v.initiator || '—')}</dd></div>
        <div><dt>Спикер Конгресса</dt><dd>${esc(v.speaker_name || '—')}</dd></div>
        <div><dt>Дата начала</dt><dd>${S.fmtDate(v.starts_at)}</dd></div>
        <div><dt>Дата окончания</dt><dd>${S.fmtDate(v.closed_at || v.ends_at)}${v.closed_early ? ' <span class="tag">досрочно</span>' : ''}</dd></div>
        <div><dt>Осталось</dt><dd>${remaining}</dd></div>
      </dl>
    </section>`;
  }

  function whoami(p) {
    if (!p?.identified) return '';
    const initials = p.name.split(' ').map((w) => w[0]).join('').slice(0, 2);
    return `<div class="whoami">
      <div class="avatar">${esc(initials)}</div>
      <div><div class="n">${esc(p.name)}</div><div class="p">${esc(p.position)}</div></div>
      <span class="tag">${p.has_voted ? 'Голос зарегистрирован' : p.admission === 'pending' ? 'Ожидает допуска' : p.admission === 'rejected' ? 'Не допущен' : 'Участник голосования'}</span>
    </div>`;
  }

  function docCard(v) {
    const parent = v.parent ? `<div class="notice notice-info" style="margin-top:18px">${icon('branch')}<div>
        <strong>${v.relation === 'amendment' ? 'Поправка к голосованию' : 'Повторное голосование по вопросу'} № ${esc(v.parent.number)}</strong>
        ${esc(v.parent.title)}</div></div>` : '';
    const att = v.attachments?.length ? `<div style="margin-top:22px"><div class="eyebrow eyebrow-muted">Приложенные материалы</div>
      <ul class="attach-list">${v.attachments.map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${icon('paperclip')}<span>${esc(a.title)}</span></a></li>`).join('')}</ul></div>` : '';
    return `<section class="card doc-card">
      <div class="doc-type"><span class="tag tag-navy">${esc(v.type_label)}</span>
        ${v.secret ? `<span class="tag tag-gold">${icon('lock').replace('<svg', '<svg width="13" height="13"')} Тайное голосование</span>` : '<span class="tag">Открытое голосование</span>'}
      </div>
      <h1 class="doc-title">${esc(v.title)}</h1>
      ${v.hint ? `<div class="doc-hint">${esc(v.hint)}</div>` : ''}
      ${v.description ? `<p class="doc-desc">${esc(v.description)}</p>` : ''}
      ${parent}
      <div class="doc-actions">
        ${v.has_body ? `<button class="btn btn-primary" type="button" data-act="read">${icon('doc')} Открыть полный текст ${docGenitive(v.type)}</button>
        <a class="btn" href="/api${base}/document/download">${icon('download')} Скачать ${docShort(v.type)}</a>` : ''}
      </div>
      ${att}
      <div class="doc-foot">
        <span>Редакция: <b>№ ${v.revision}</b></span>
        <span>Правило принятия: <b>${esc(v.rule_text)}</b></span>
      </div>
    </section>`;
  }
  const docGenitive = (t) => ({ bill: 'законопроекта', amendment: 'поправки', resolution: 'постановления', initiative: 'инициативы', proposal: 'предложения' }[t] || 'документа');
  const docShort = (t) => ({ bill: 'законопроект', amendment: 'поправку', resolution: 'постановление', initiative: 'инициативу', proposal: 'предложение' }[t] || 'документ');

  function commentsCard(v, canWrite) {
    if (!v.allow_comments) return '';
    return `<section class="card" style="margin-top:20px" id="discussion">
      <div class="card-head"><h3>Обсуждение</h3><span class="muted" style="font-size:13px">до окончания голосования</span></div>
      <div class="card-body">
        <div class="comments" id="comments"><div class="muted">Загрузка…</div></div>
        ${canWrite ? `<form id="c-form" style="margin-top:16px">
          <div class="field" style="margin-bottom:10px"><label for="c-body" class="sr-only">Комментарий</label>
          <textarea class="textarea" id="c-body" rows="3" maxlength="2000" placeholder="Замечание или предложение к тексту…"></textarea></div>
          <button class="btn" type="submit">${icon('message')} Отправить</button></form>` : ''}
      </div></section>`;
  }

  async function loadComments() {
    const box = $('#comments'); if (!box) return;
    try {
      const { items } = await api(`${base}/comments`);
      box.innerHTML = items.length ? items.map((c) => `<div class="comment"><div class="a">${esc(c.author_label)}</div>
        <time>${S.fmtDate(c.created_at)}</time><div class="b">${esc(c.body)}</div></div>`).join('')
        : '<div class="muted">Комментариев пока нет.</div>';
    } catch { box.innerHTML = '<div class="muted">Не удалось загрузить обсуждение.</div>'; }
  }

  function bindCommon() {
    $$('[data-act="read"]').forEach((b) => b.addEventListener('click', openReader));
    const f = $('#c-form');
    if (f) f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = $('#c-body');
      if (!t.value.trim()) return;
      try { await api(`${base}/comments`, { method: 'POST', body: { body: t.value } }); t.value = ''; loadComments(); S.toast('Комментарий опубликован'); }
      catch (err) { S.toastError(err); }
    });
    loadComments();
    startCountdown();
  }

  // ---------- экраны ----------
  function render() {
    busy = false;
    const s = state;
    document.title = s.vote ? `Голосование № ${s.vote.number} — Генеральная Ассамблея штата SWAG` : 'Голосование — Генеральная Ассамблея штата SWAG';
    if (!s.ok) {
      if (s.closed && s.vote) return renderClosed(s);
      return renderError(s.error, s.vote);
    }
    if (!s.participant.identified) return renderIdentify(s);
    if (s.participant.has_voted) return renderVoted(s);
    if (s.participant.admission !== 'approved') return renderAdmission(s);
    return renderBallot(s);
  }

  function renderError(err, v) {
    const map = {
      INVITE_INVALID: ['bad', 'x'], INVITE_REVOKED: ['bad', 'ban'], INVITE_EXPIRED: ['gold', 'clock'],
      INVITE_EXHAUSTED: ['gold', 'users'], VOTE_CANCELLED: ['bad', 'ban'], VOTE_CLOSED: ['info', 'seal'],
      ALREADY_VOTED: ['ok', 'check'], NETWORK: ['gold', 'alert'],
    };
    const [cls, ic] = map[err?.code] || ['bad', 'alert'];
    const extra = err?.code === 'VOTE_CANCELLED' && v?.cancel_reason ? `<div class="notice notice-danger" style="margin-top:20px;text-align:left">${icon('info')}<div><strong>Причина отмены</strong>${esc(v.cancel_reason)}</div></div>` : '';
    app.innerHTML = `
      ${v ? `<div class="vote-ref card" style="margin-bottom:16px"><span class="vnum">№&nbsp;<b class="mono">${esc(v.number)}</b></span><span class="ttl">${esc(v.title)}</span>${S.statusPill(v.status)}</div>` : ''}
      <section class="card state-screen">
        <div class="state-icon ${cls}">${icon(ic)}</div>
        <h1>${esc(err?.title || 'Приглашение недействительно')}</h1>
        <p class="msg">${esc(err?.message || '')}</p>
        ${extra}
        <div class="btn-group">
          <a class="btn" href="/">${icon('home')} На главную</a>
          ${err?.code === 'NETWORK' ? `<button class="btn btn-primary" type="button" id="retry">${icon('refresh')} Повторить</button>` : ''}
        </div>
      </section>`;
    const r = $('#retry'); if (r) r.addEventListener('click', () => load());
  }

  // ----- Допуск Спикером: заявка на рассмотрении или отклонена -----
  let admissionTimer = null;
  function renderAdmission(s) {
    const v = s.vote, p = s.participant;
    const rejected = p.admission === 'rejected';
    app.innerHTML = `
      ${voteHeader(v)}
      <section class="card state-screen" style="margin-top:20px;max-width:none">
        <div class="state-icon ${rejected ? 'bad' : 'gold'}">${icon(rejected ? 'ban' : 'clock')}</div>
        <h1>${rejected ? 'Заявка отклонена' : 'Заявка на рассмотрении'}</h1>
        <p class="msg">${rejected
          ? 'Спикер Конгресса не допустил вас к этому голосованию. Если это ошибка — свяжитесь со Спикером Конгресса.'
          : 'Спикер Конгресса проверяет ваши сведения. Как только вас допустят, на этой странице появится бюллетень — обновлять её не нужно. Пока можно ознакомиться с материалами.'}</p>
      </section>
      ${whoami(p)}
      ${docCard(v)}`;
    bindCommon();
    // пока заявка ждёт решения, проверяем чаще обычного
    if (!rejected && !admissionTimer) {
      admissionTimer = setInterval(() => {
        if (state?.participant?.admission !== 'pending') { clearInterval(admissionTimer); admissionTimer = null; return; }
        load({ quiet: true });
      }, 7000);
    }
  }

  // ----- Идентификация -----
  function renderIdentify(s) {
    const v = s.vote;
    if (s.person) return renderPersonal(s);
    app.innerHTML = `<div class="identify">
      <section class="card"><div class="card-pad">
        <div class="identify-head">
          <img src="/img/emblem.svg" alt="">
          <div><div class="eyebrow">Шаг 1 из 2</div><h1>Идентификация участника голосования</h1>
          <p>Укажите сведения о себе. Они будут отражены в журнале голосования${v.secret ? ' — при этом в тайном голосовании ваш выбор не связывается с вашей личностью' : ' и в поимённых результатах'}.</p></div>
        </div>
        <div class="vote-ref"><span class="vnum">№&nbsp;<b class="mono">${esc(v.number)}</b></span><span class="ttl">${esc(v.title)}</span>${S.statusPill(v.status)}</div>
        ${v.status === 'pending' ? `<div class="notice notice-gold" style="margin-bottom:22px">${icon('clock')}<div><strong>Голосование ещё не началось</strong>Приём голосов откроется ${S.fmtLong(v.starts_at)}. Вы можете пройти идентификацию и заранее ознакомиться с материалами.</div></div>` : ''}
        ${v.approval ? `<div class="notice notice-info" style="margin-bottom:22px">${icon('idcard')}<div><strong>Допуск по решению Спикера</strong>После идентификации ваши сведения проверит Спикер Конгресса. Голосовать можно будет после его одобрения.</div></div>` : ''}
        <form id="id-form" novalidate>
          <div class="grid-2">
            <div class="field"><label for="f-first">Имя<span class="req">*</span></label><input class="input" id="f-first" name="first_name" autocomplete="given-name" maxlength="60" required></div>
            <div class="field"><label for="f-last">Фамилия<span class="req">*</span></label><input class="input" id="f-last" name="last_name" autocomplete="family-name" maxlength="60" required></div>
          </div>
          <div class="field" data-f="position_kind"><span class="label" id="pos-l">Должность<span class="req">*</span></span>
            <div class="segmented" role="radiogroup" aria-labelledby="pos-l">
              <label><input type="radio" name="position_kind" value="leader"><strong>Лидер</strong><span>Руководитель департамента</span></label>
              <label><input type="radio" name="position_kind" value="deputy"><strong>Заместитель</strong><span>Заместитель руководителя</span></label>
              <label><input type="radio" name="position_kind" value="custom"><strong>Иная должность</strong><span>Указать вручную</span></label>
            </div>
          </div>
          <div id="pos-extra" hidden>
            <div class="field" id="f-title-wrap" hidden><label for="f-title">Наименование должности<span class="req">*</span></label>
              <input class="input" id="f-title" name="position_title" maxlength="120" placeholder="Например: Секретарь Конгресса"></div>
            <div class="grid-2">
              <div class="field"><label for="f-org">Департамент / организация<span class="req" id="org-req">*</span></label>
                <input class="input" id="f-org" name="organization" list="orgs" maxlength="120" placeholder="Los Santos Police Department"></div>
              <div class="field"><label for="f-div">Подразделение / отдел<span class="req" id="div-req">*</span></label>
                <input class="input" id="f-div" name="division" maxlength="120" placeholder="Patrol Division"></div>
            </div>
            <div class="position-preview" id="pos-preview"></div>
          </div>
          <div class="confirm-box field" data-f="confirm" style="margin-bottom:0">
            <label class="check"><input type="checkbox" name="confirm" id="f-confirm"><span>Подтверждаю достоверность указанных мной сведений.</span></label>
          </div>
          <div class="notice notice-danger" id="id-error" style="margin-top:18px" hidden></div>
          <div style="display:flex;justify-content:flex-end;margin-top:22px">
            <button class="btn btn-primary btn-lg" type="submit" id="id-submit">Продолжить ${icon('back').replace('<svg', '<svg style="transform:scaleX(-1)"')}</button>
          </div>
        </form>
      </div></section>
      <p class="muted" style="font-size:12.5px;text-align:center;margin-top:16px">${icon('lock').replace('<svg', '<svg style="display:inline;width:13px;height:13px;vertical-align:-2px"')} Одно приглашение — один участник. Повторная идентификация под тем же именем невозможна.</p>
    </div>`;

    const form = $('#id-form');
    const extra = $('#pos-extra');
    const update = () => {
      const kind = form.position_kind.value;
      extra.hidden = !kind;
      $('#f-title-wrap').hidden = kind !== 'custom';
      $('#org-req').hidden = kind === 'custom';
      $('#div-req').hidden = kind === 'custom';
      const title = kind === 'leader' ? 'Лидер' : kind === 'deputy' ? 'Заместитель' : form.position_title.value.trim() || 'Должность';
      const line = [title, form.organization.value.trim(), form.division.value.trim()].filter(Boolean).join(' — ');
      $('#pos-preview').innerHTML = `Будет указано: <b>${esc(line)}</b>`;
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      $$('.has-error', form).forEach((x) => x.classList.remove('has-error'));
      $$('.field-error', form).forEach((x) => x.remove());
      const errBox = $('#id-error'); errBox.hidden = true;
      const data = Object.fromEntries(new FormData(form));
      data.confirm = $('#f-confirm').checked;
      // Проверка на клиенте — только для удобства; сервер проверяет всё повторно
      const errs = [];
      if (!data.first_name?.trim()) errs.push(['first_name', 'Укажите имя.']);
      if (!data.last_name?.trim()) errs.push(['last_name', 'Укажите фамилию.']);
      if (!data.position_kind) errs.push(['position_kind', 'Выберите должность.']);
      if (data.position_kind === 'custom' && !data.position_title?.trim()) errs.push(['position_title', 'Укажите наименование должности.']);
      if (['leader', 'deputy'].includes(data.position_kind)) {
        if (!data.organization?.trim()) errs.push(['organization', 'Укажите департамент или организацию.']);
        if (!data.division?.trim()) errs.push(['division', 'Укажите подразделение или отдел.']);
      }
      if (!data.confirm) errs.push(['confirm', 'Необходимо подтвердить достоверность сведений.']);
      if (errs.length) { errs.forEach(([f, m]) => markError(form, f, m)); return; }

      const btn = $('#id-submit'); btn.disabled = true;
      try {
        await api(`${base}/identify`, { method: 'POST', body: data });
        await load();
        window.scrollTo({ top: 0 });
      } catch (err) {
        if (err.field) markError(form, err.field, err.human);
        errBox.hidden = false;
        errBox.innerHTML = `${icon('alert')}<div><strong>${esc(err.title)}</strong>${esc(err.human)}</div>`;
        if (['VOTE_CLOSED', 'VOTE_CANCELLED', 'INVITE_EXPIRED', 'INVITE_REVOKED', 'INVITE_EXHAUSTED', 'ALREADY_VOTED'].includes(err.code)) setTimeout(() => load(), 2500);
      } finally { btn.disabled = false; }
    });
    setTimeout(() => $('#f-first')?.focus(), 50);
  }

  // ----- Именное приглашение: данные участника задал Спикер, их нужно только подтвердить -----
  function renderPersonal(s) {
    const v = s.vote, who = s.person;
    app.innerHTML = `<div class="identify">
      <section class="card"><div class="card-pad">
        <div class="identify-head">
          <img src="/img/emblem.svg" alt="">
          <div><div class="eyebrow">Шаг 1 из 2</div><h1>Именное приглашение</h1>
          <p>Эта ссылка выдана Спикером Конгресса лично вам. Вводить сведения не нужно — проверьте их и подтвердите.</p></div>
        </div>
        <div class="vote-ref"><span class="vnum">№&nbsp;<b class="mono">${esc(v.number)}</b></span><span class="ttl">${esc(v.title)}</span>${S.statusPill(v.status)}</div>
        ${v.status === 'pending' ? `<div class="notice notice-gold" style="margin-bottom:22px">${icon('clock')}<div><strong>Голосование ещё не началось</strong>Приём голосов откроется ${S.fmtLong(v.starts_at)}.</div></div>` : ''}
        <div class="position-preview" style="margin-bottom:20px"><div style="font-size:18px;font-weight:700;color:var(--ink)">${esc(who.name)}</div><div style="margin-top:4px">${esc(who.position)}</div></div>
        <form id="id-form" novalidate>
          <div class="confirm-box field" data-f="confirm" style="margin-bottom:0">
            <label class="check"><input type="checkbox" name="confirm" id="f-confirm"><span>Подтверждаю, что это я и приглашение выдано мне.</span></label>
          </div>
          <div class="notice notice-danger" id="id-error" style="margin-top:18px" hidden></div>
          <div style="display:flex;justify-content:flex-end;margin-top:22px">
            <button class="btn btn-primary btn-lg" type="submit" id="id-submit">Продолжить</button>
          </div>
        </form>
      </div></section>
      <p class="muted" style="font-size:12.5px;text-align:center;margin-top:16px">Ссылка одноразовая: после подтверждения она закрепляется за этим устройством. Не передавайте её другим.</p>
    </div>`;
    const form = $('#id-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      $$('.has-error', form).forEach((x) => x.classList.remove('has-error'));
      $$('.field-error', form).forEach((x) => x.remove());
      const errBox = $('#id-error'); errBox.hidden = true;
      if (!$('#f-confirm').checked) return markError(form, 'confirm', 'Подтвердите, что приглашение выдано вам.');
      const btn = $('#id-submit'); btn.disabled = true;
      try {
        await api(`${base}/identify`, { method: 'POST', body: { confirm: true } });
        await load();
        window.scrollTo({ top: 0 });
      } catch (err) {
        errBox.hidden = false;
        errBox.innerHTML = `${icon('alert')}<div><strong>${esc(err.title)}</strong>${esc(err.human)}</div>`;
        if (['VOTE_CLOSED', 'VOTE_CANCELLED', 'INVITE_EXPIRED', 'INVITE_REVOKED', 'INVITE_EXHAUSTED', 'ALREADY_VOTED'].includes(err.code)) setTimeout(() => load(), 2500);
      } finally { btn.disabled = false; }
    });
  }

  function markError(form, field, msg) {
    const input = form.querySelector(`[name="${field}"]`);
    const wrap = input?.closest('.field') || form.querySelector(`[data-f="${field}"]`);
    if (!wrap) return;
    wrap.classList.add('has-error');
    const d = document.createElement('div'); d.className = 'field-error'; d.textContent = msg; wrap.appendChild(d);
    if (input && input.focus && !document.querySelector('.has-error input:focus')) input.focus();
  }

  // ----- Бюллетень -----
  function renderBallot(s) {
    const v = s.vote;
    const pending = v.status === 'pending';
    const opts = [
      ['for', 'check', 'Поддерживаю'],
      ['against', 'x', 'Не поддерживаю'],
      ...(v.allow_abstain ? [['abstain', 'minus', 'Воздерживаюсь']] : []),
    ];
    app.innerHTML = `
      ${voteHeader(v)}
      ${whoami(s.participant)}
      ${docCard(v)}
      ${commentsCard(v, true)}
      <section class="card decision-card" id="decision">
        <div class="eyebrow" style="text-align:center;display:block">Шаг 2 из 2</div>
        <h2 style="margin-top:6px">ВАШЕ РЕШЕНИЕ</h2>
        <p class="sub">${pending ? `Приём голосов начнётся ${S.fmtLong(v.starts_at)}` : 'Ознакомьтесь с документом и выберите один из вариантов'}</p>
        ${pending ? `<div class="notice notice-gold" style="margin-bottom:18px">${icon('clock')}<div><strong>Голосование ещё не началось</strong>Кнопки станут доступны автоматически в момент начала голосования.</div></div>` : ''}
        <div class="choices${opts.length === 2 ? ' two' : ''}" id="choices" role="group" aria-label="Варианты решения">
          ${opts.map(([k, ic, sub]) => `<button type="button" class="choice choice-${k}" data-choice="${k}" aria-pressed="false" ${pending ? 'disabled' : ''}>
            <span class="dot">${icon(ic)}</span><span>${S.CHOICE[k]}</span><small>${sub}</small></button>`).join('')}
        </div>
        <div id="confirm-slot"></div>
      </section>`;
    bindCommon();

    let choice = null;
    $$('#choices .choice').forEach((b) => b.addEventListener('click', () => {
      if ($('#choices').classList.contains('locked')) return;
      choice = b.dataset.choice;
      busy = true;
      $$('#choices .choice').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      showConfirmBar();
    }));

    function showConfirmBar() {
      $('#choices').classList.add('locked');
      $('#confirm-slot').innerHTML = `<div class="confirm-bar">
        <div><div class="sel">Вы выбрали: <b class="c-${choice}">${S.CHOICE[choice]}</b></div>
        <p>После подтверждения изменить свой голос будет невозможно.</p></div>
        <div class="btn-group">
          <button class="btn" type="button" id="change">Изменить решение</button>
          <button class="btn btn-primary" type="button" id="confirm">${icon('check')} Подтвердить голос</button>
        </div></div>`;
      $('#change').addEventListener('click', () => {
        choice = null; busy = false;
        $('#choices').classList.remove('locked');
        $$('#choices .choice').forEach((x) => x.setAttribute('aria-pressed', 'false'));
        $('#confirm-slot').innerHTML = '';
      });
      $('#confirm').addEventListener('click', openConfirmModal);
      $('#confirm-slot').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function openConfirmModal() {
      const p = state.participant;
      S.modal({
        title: 'ПОДТВЕРЖДЕНИЕ ГОЛОСА',
        body: `<div class="vote-summary">
            <div><dt>Голосование</dt><dd>№ ${esc(v.number)} · ${esc(v.title)}</dd></div>
            <div><dt>ФИО</dt><dd>${esc(p.name)}</dd></div>
            <div><dt>Должность</dt><dd>${esc(p.position)}</dd></div>
            <div><dt>Ваш голос</dt><dd class="big c-${choice}">${S.CHOICE[choice]}</dd></div>
          </div>
          <div class="notice notice-gold" style="margin-top:16px">${icon('alert')}<div>Проверьте указанные сведения. После подтверждения голос будет зарегистрирован и изменение решения станет недоступно.</div></div>`,
        actions: [
          { label: 'Вернуться', class: 'btn-ghost' },
          { html: `${icon('check')} Зарегистрировать голос`, class: 'btn-primary', onClick: async ({ close }) => {
            try {
              const r = await api(`${base}/ballot`, { method: 'POST', body: { choice } });
              lastReceipt = { ...r, choice };
              close();
              renderReceipt(v);
              load({ quiet: true });
            } catch (err) {
              close();
              S.modal({
                title: esc(err.title), body: `<p style="margin:0">${esc(err.human)}</p>`,
                actions: [{ label: 'Понятно', class: 'btn-primary', onClick: () => load() }],
              });
            }
            return false;
          } },
        ],
      });
    }
  }

  // ----- Голос зарегистрирован -----
  function renderReceipt(v) {
    busy = true; // не заменять экран подтверждения фоновым обновлением
    const r = lastReceipt;
    app.innerHTML = `<section class="card state-screen">
      <div class="state-icon ok">${icon('check')}</div>
      <div class="eyebrow">Голосование № ${esc(v.number)}</div>
      <h1 style="margin-top:8px">ГОЛОС ЗАРЕГИСТРИРОВАН</h1>
      <p class="msg">Спасибо. Ваш голос принят системой.</p>
      <div class="receipt">
        <div class="l">Идентификатор голоса</div>
        <div class="v">#${esc(r.receipt_no)}</div>
        <div class="s">Зарегистрирован ${S.fmtDate(r.voted_at)}${v.secret ? ' · тайное голосование: выбор не связан с вашей личностью' : ''}</div>
      </div>
      ${v.secret ? `<p class="muted" style="font-size:12.5px;margin-top:14px">Сохраните номер — в тайном голосовании он показывается только один раз.</p>` : ''}
      <div class="btn-group">
        <button class="btn" type="button" id="back-docs">${icon('doc')} Вернуться к материалам</button>
      </div>
    </section>`;
    $('#back-docs').addEventListener('click', () => { lastReceipt = null; load(); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderVoted(s) {
    const v = s.vote, p = s.participant;
    app.innerHTML = `
      ${voteHeader(v)}
      <section class="card state-screen" style="margin-top:20px;max-width:none">
        <div class="state-icon ok">${icon('check')}</div>
        <h1>Ваш голос уже зарегистрирован</h1>
        <p class="msg">Повторное голосование по этому вопросу невозможно. ${v.show_results ? 'Результаты будут опубликованы после завершения голосования.' : 'Результаты доводятся Спикером Конгресса.'}</p>
        ${p.receipt_no ? `<div class="receipt"><div class="l">Идентификатор голоса</div><div class="v">#${esc(p.receipt_no)}</div><div class="s">Зарегистрирован ${S.fmtDate(p.voted_at)}</div></div>`
          : `<div class="receipt"><div class="l">Время регистрации</div><div class="v" style="font-size:20px">${S.fmtDate(p.voted_at)}</div><div class="s">Тайное голосование — выбор участника не раскрывается</div></div>`}
      </section>
      ${whoami(p)}
      ${docCard(v)}
      ${commentsCard(v, true)}`;
    bindCommon();
  }

  // ----- Итоги -----
  function renderClosed(s) {
    const v = s.vote, r = s.results, p = s.participant;
    const verdict = r ? { adopted: ['ПРИНЯТО', 'c-for', 'check'], rejected: ['НЕ ПРИНЯТО', 'c-against', 'x'], pending: ['ОЖИДАЕТ РЕШЕНИЯ СПИКЕРА', 'c-abstain', 'clock'] }[r.decision] : null;
    app.innerHTML = `
      ${voteHeader(v)}
      ${p?.identified ? `<div class="notice ${p.has_voted ? 'notice-success' : 'notice-info'}" style="margin-top:20px">${icon(p.has_voted ? 'check' : 'info')}<div>
        <strong>${p.has_voted ? 'Ваш голос был учтён' : 'Голосование завершено'}</strong>
        ${p.has_voted ? (p.receipt_no ? `Идентификатор вашего голоса: <span class="mono">#${esc(p.receipt_no)}</span>` : 'Тайное голосование — выбор не раскрывается.') : 'Вы не приняли участие в этом голосовании.'}</div></div>`
        : `<div class="notice notice-info" style="margin-top:20px">${icon('seal')}<div><strong>Голосование завершено</strong>Приём голосов прекращён. Новые голоса не принимаются.</div></div>`}
      ${r ? `<section class="card results">
        <div class="card-head"><h2>РЕЗУЛЬТАТЫ ГОЛОСОВАНИЯ</h2>
          <div class="actions">${r.protocol ? `<button class="btn btn-sm" type="button" id="pdf">${icon('download')} Протокол PDF</button>` : ''}</div></div>
        <div class="card-body">
          <div class="results-grid">
            ${S.donut(r.tally, v.allow_abstain ? ['for', 'against', 'abstain'] : ['for', 'against'])}
            <div>${S.tallyRows(r.tally, v.allow_abstain)}
              <div class="stat-strip">
                <div><div class="l">Приглашено</div><div class="v">${r.invited}</div></div>
                <div><div class="l">Проголосовали</div><div class="v">${r.voted}</div></div>
                <div><div class="l">Не проголосовали</div><div class="v">${r.not_voted}</div></div>
                <div><div class="l">Явка</div><div class="v">${S.pct(r.turnout)}</div></div>
              </div>
            </div>
          </div>
          <dl class="meta-grid meta-4">
            <div><dt>Тип</dt><dd>${esc(v.type_label)}</dd></div>
            <div><dt>Статус</dt><dd>${esc(v.status_label)}</dd></div>
            <div><dt>Начало</dt><dd>${S.fmtDate(v.starts_at)}</dd></div>
            <div><dt>Окончание</dt><dd>${S.fmtDate(v.closed_at || v.ends_at)}</dd></div>
          </dl>
          <div class="resolution">
            <span class="eyebrow">Генеральная Ассамблея штата SWAG</span>
            <h3>ПОСТАНОВЛЕНИЕ ПО РЕЗУЛЬТАТАМ ГОЛОСОВАНИЯ</h3>
            <p>${esc(r.resolution)}</p>
            <div class="verdict"><span class="verdict-badge ${verdict[1]}">${icon(verdict[2])} ${verdict[0]}</span></div>
          </div>
          ${r.voters ? votersList(r.voters, v.secret) : ''}
        </div>
      </section>` : `<section class="card state-screen" style="margin-top:20px;max-width:none">
        <div class="state-icon info">${icon('seal')}</div><h1>Результаты не публикуются</h1>
        <p class="msg">Итоги голосования доводятся Спикером Конгресса в официальном порядке.</p></section>`}
      ${docCard(v)}`;
    bindCommon();
    const pdfBtn = $('#pdf');
    if (pdfBtn) pdfBtn.addEventListener('click', async () => {
      pdfBtn.disabled = true;
      try { await SWAG_PDF.download(await api(`${base}/protocol`)); }
      catch (e) { S.toast(e.title || 'Не удалось сформировать PDF', e.human || e.message, 'error'); }
      finally { pdfBtn.disabled = false; }
    });
  }

  function votersList(list, secret) {
    return `<div style="margin-top:24px"><div class="eyebrow eyebrow-muted" style="margin-bottom:10px">${secret ? 'Участники голосования (выбор не раскрывается)' : 'Поимённые результаты'}</div>
      <div class="table-wrap" style="border:1px solid var(--line);border-radius:var(--r)"><table class="table responsive"><thead><tr><th>ФИО</th><th>Должность</th>${secret ? '' : '<th>Голос</th>'}</tr></thead><tbody>
      ${list.map((x) => `<tr><td class="cell-title"><span class="t-title">${esc(x.name)}</span></td><td data-l="Должность">${esc(x.position)}</td>${secret ? '' : `<td data-l="Голос"><b class="c-${x.choice}">${S.CHOICE[x.choice]}</b></td>`}</tr>`).join('')}
      </tbody></table></div></div>`;
  }

  // ---------- таймер ----------
  function startCountdown() {
    clearInterval(timer);
    const tick = () => {
      $$('.countdown[data-until]').forEach((el) => {
        const left = Number(el.dataset.until) - S.now();
        el.textContent = S.duration(left);
        el.classList.toggle('warn', left < 30 * 60e3);
        if (left <= 0 && !el.dataset.fired) { el.dataset.fired = '1'; setTimeout(() => load({ quiet: true }), 1500); }
      });
    };
    tick(); timer = setInterval(tick, 1000);
  }

  // ---------- просмотр документа ----------
  async function openReader() {
    let doc;
    try { doc = await api(`${base}/document`); } catch (e) { return S.toastError(e); }
    const v = state.vote;
    const el = document.createElement('div');
    el.className = 'reader'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Полный текст документа');
    el.innerHTML = `<div class="reader-bar">
        <button class="btn btn-outline-light btn-icon" type="button" data-close aria-label="Закрыть">${icon('back')}</button>
        <div class="t"><b>${esc(doc.title)}</b><span>${esc(doc.type_label)} № ${esc(doc.number)} · редакция № ${doc.revision}</span></div>
        <a class="btn btn-outline-light btn-sm" href="/api${base}/document/download">${icon('download')}<span class="hide-sm">Скачать</span></a>
      </div>
      <div class="reader-body">
        ${doc.toc.length > 1 ? `<nav class="reader-toc" aria-label="Содержание"><span class="eyebrow eyebrow-muted">Содержание</span>
          ${doc.toc.map((t) => `<a href="#${t.id}" class="d${t.depth}">${esc(t.text)}</a>`).join('')}</nav>` : ''}
        <article class="paper">
          <div class="paper-head"><img src="/img/emblem.svg" alt="">
            <span class="eyebrow">Генеральная Ассамблея штата SWAG</span>
            <h1>${esc(doc.title)}</h1>
            <div class="m">${esc(doc.type_label)} № ${esc(doc.number)}${v.initiator ? ` · Инициатор: ${esc(v.initiator)}` : ''}</div>
          </div>
          <div class="prose">${doc.html || '<p class="muted">Полный текст не приложен.</p>'}</div>
        </article>
      </div>`;
    const close = () => { el.remove(); document.body.classList.remove('no-scroll'); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    $('[data-close]', el).addEventListener('click', close);
    $$('.reader-toc a', el).forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault(); $(a.getAttribute('href'), el)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el); document.body.classList.add('no-scroll');
    $('[data-close]', el).focus();
  }

  // ---------- уведомления ----------
  let notifStarted = false, lastNotif = 0, notifs = [];
  function startNotifications() {
    if (notifStarted) return;
    notifStarted = true;
    $('#bell').hidden = false;
    $('#bell-btn').innerHTML = icon('bell');
    $('#bell-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      $('#bell-panel').hidden = !$('#bell-panel').hidden;
      $('#bell-badge').hidden = true;
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#bell')) $('#bell-panel').hidden = true; });
    poll(true);
    setInterval(() => poll(false), 20000);
    setInterval(() => load({ quiet: true }), 30000);
  }
  async function poll(first) {
    try {
      const { items } = await api(`${base}/notifications?since=${lastNotif}`);
      if (!items.length) return;
      lastNotif = Math.max(lastNotif, ...items.map((i) => i.id));
      notifs = [...items, ...notifs].slice(0, 30);
      $('#bell-list').innerHTML = notifs.map((n) => `<div class="bell-item"><div class="t">${esc(n.title)}</div>${n.body ? `<div class="d">${esc(n.body)}</div>` : ''}<time>${S.fmtDate(n.at)}</time></div>`).join('');
      if (!first) {
        items.slice().reverse().forEach((n) => S.toast(n.title, n.body));
        $('#bell-badge').hidden = false; $('#bell-badge').textContent = items.length;
        if (items.some((n) => ['closed', 'started', 'cancelled', 'text_changed', 'rescheduled', 'admission'].includes(n.kind))) load({ quiet: true });
      }
    } catch { /* сеть недоступна — повторим позже */ }
  }

  load();
})();
