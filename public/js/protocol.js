/* Официальный протокол электронного голосования (HTML-версия для просмотра и печати). */
'use strict';
(async () => {
  const S = SWAG;
  const { $, esc, icon } = S;
  const id = location.pathname.split('/').pop();
  const doc = $('#doc');
  $('#bar').innerHTML = `<a class="btn btn-sm" href="/speaker#/votes/${encodeURIComponent(id)}">${icon('back')} К голосованию</a><span class="spacer"></span>
    <button class="btn btn-sm" id="print">${icon('print')} Печать</button>
    <button class="btn btn-sm btn-primary" id="pdf" disabled>${icon('download')} Скачать протокол PDF</button>`;
  $('#print').addEventListener('click', () => window.print());

  let p;
  try { p = await S.api(`/admin/votes/${encodeURIComponent(id)}/protocol`); }
  catch (e) {
    doc.innerHTML = `<div class="notice notice-danger">${icon('alert')}<div><strong>${esc(e.title)}</strong>${esc(e.human || '')}
      ${e.status === 401 ? ' <a href="/speaker">Войти в панель Спикера</a>' : ''}</div></div>`;
    return;
  }
  $('#pdf').disabled = false;
  $('#pdf').addEventListener('click', async () => {
    $('#pdf').disabled = true;
    try { await SWAG_PDF.download(p); } catch (e) { S.toast('Не удалось сформировать PDF', e.message, 'error'); } finally { $('#pdf').disabled = false; }
  });
  const d = p.data, r = d.results, v = d.vote;
  document.title = `Протокол № ${d.number} — Генеральная Ассамблея штата SWAG`;
  const DEC = { adopted: 'ПРИНЯТО', rejected: 'НЕ ПРИНЯТО', pending: 'ОЖИДАЕТ ФИКСАЦИИ СПИКЕРОМ' };
  doc.innerHTML = `
    <div class="head"><img src="/img/emblem.svg" alt="">
      <span class="eyebrow">Генеральная Ассамблея штата SWAG</span>
      <h1>ПРОТОКОЛ ЭЛЕКТРОННОГО ГОЛОСОВАНИЯ</h1>
      <div class="n">Протокол № ${esc(d.number)} · Голосование № ${esc(v.number)}</div></div>
    <hr>
    <dl class="rows">
      <dt>Предмет голосования</dt><dd><b>${esc(v.type_label)}: «${esc(v.title)}»</b></dd>
      ${v.initiator ? `<dt>Инициатор</dt><dd>${esc(v.initiator)}</dd>` : ''}
      <dt>Форма голосования</dt><dd>${v.secret ? 'Тайное' : 'Открытое'} электронное голосование</dd>
      <dt>Дата начала</dt><dd>${S.fmtLong(v.starts_at)}</dd>
      <dt>Дата окончания</dt><dd>${S.fmtLong(v.closed_at || v.ends_at)}${v.closed_early ? ' (досрочно)' : ''}</dd>
      <dt>Правило принятия</dt><dd>${esc(r.rule_text)}</dd>
    </dl>
    <div class="res">
      <div><span>Всего приглашённых</span><b>${r.invited}</b></div><div><span>Приняли участие</span><b>${r.voted}</b></div>
      <div><span>ЗА</span><b>${r.tally.for}</b></div><div><span>ПРОТИВ</span><b>${r.tally.against}</b></div>
      ${v.allow_abstain ? `<div><span>ВОЗДЕРЖАЛИСЬ</span><b>${r.tally.abstain}</b></div>` : ''}<div><span>Явка</span><b>${S.pct(r.turnout)}</b></div>
    </div>
    <div class="verdict">РЕШЕНИЕ: ${DEC[r.decision]}${r.quorum_met ? '' : ' — КВОРУМ НЕ ДОСТИГНУТ'}</div>
    <h3 style="font-size:14px;letter-spacing:.1em;margin:26px 0 8px">ПОСТАНОВЛЕНИЕ ПО РЕЗУЛЬТАТАМ ГОЛОСОВАНИЯ</h3>
    <p>${esc(d.resolution)}</p>
    ${d.participants.length ? `<h3 style="font-size:14px;letter-spacing:.1em;margin:26px 0 4px">${v.secret ? 'УЧАСТНИКИ ГОЛОСОВАНИЯ (ВЫБОР НЕ РАСКРЫВАЕТСЯ)' : 'ПОИМЁННЫЕ РЕЗУЛЬТАТЫ'}</h3>
      <table class="plist">${d.participants.map((x, i) => `<tr><td>${i + 1}</td><td><b>${esc(x.name)}</b><div class="muted" style="font-size:12.5px">${esc(x.position)}</div></td><td>${v.secret ? '' : S.CHOICE[x.choice]}</td></tr>`).join('')}</table>` : ''}
    <div class="sign"><span>Спикер Конгресса штата SWAG</span><span class="line"></span><span>${esc(v.speaker_name)}</span></div>
    <div class="foot">Дата формирования протокола: ${S.fmtLong(d.created_at)}<br>Контрольная сумма документа: <span class="mono">${esc(d.checksum)}</span></div>`;
})();
