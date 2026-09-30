/* Главная страница: вход по приглашению. */
'use strict';
(() => {
  const { $, $$, icon, modal, esc } = SWAG;

  $$('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  $('#join-btn').innerHTML = `${icon('lock')} Войти по приглашению`;
  $('#join-note').innerHTML = `${icon('info')} Регистрация не требуется — доступ только по персональной ссылке-приглашению`;

  /** Извлечь код приглашения из ссылки или ввода вида XXXX-XXXX-XXXX. */
  function parseCode(v) {
    const s = String(v || '').trim().toUpperCase();
    const m = s.match(/([A-Z0-9]{4})-?([A-Z0-9]{4})-?([A-Z0-9]{4})\s*\/?$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  function openJoin() {
    const m = modal({
      title: 'Вход по приглашению',
      body: `<p style="margin:0 0 16px;color:var(--ink-2)">Вставьте персональную ссылку-приглашение, полученную от Спикера Конгресса, или введите код приглашения.</p>
        <div class="field" style="margin:0">
          <label for="inv">Ссылка или код приглашения</label>
          <input class="input mono" id="inv" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="https://…/vote/8FJ2-KD91-XP72">
          <div class="hint">Код состоит из трёх групп по четыре символа, например: <span class="mono">8FJ2-KD91-XP72</span></div>
          <div class="field-error" id="inv-err" hidden></div>
        </div>`,
      actions: [
        { label: 'Отмена', class: 'btn-ghost' },
        { html: `Перейти к голосованию`, class: 'btn-primary', onClick: ({ body }) => {
          const code = parseCode($('#inv', body).value);
          if (!code) {
            const err = $('#inv-err', body); err.hidden = false;
            err.textContent = 'Не удалось распознать приглашение. Проверьте ссылку или код.';
            $('#inv', body).closest('.field').classList.add('has-error');
            return false;
          }
          location.href = `/vote/${encodeURIComponent(code)}`;
        } },
      ],
    });
    $('#inv', m.body).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.modal-foot .btn-primary', m.el).click(); });
  }

  $('#join-btn').addEventListener('click', openJoin);
  if (location.pathname === '/join' || location.hash === '#join') openJoin();
  void esc;
})();
