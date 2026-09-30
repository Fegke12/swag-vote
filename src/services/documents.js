'use strict';
/** Официальная печатная/скачиваемая версия документа (самодостаточный HTML). */
const markdown = require('./markdown');
const { fmt } = require('./protocols');
const { VOTE_TYPES } = require('./catalog');

const esc = markdown.esc;

function standalone(v, revisionNo) {
  const { html } = markdown.render(v.body);
  const T = VOTE_TYPES[v.type] || VOTE_TYPES.other;
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(T.label)} № ${esc(v.number)} — ${esc(v.title)}</title>
<style>
  body{margin:0;background:#eef0f4;color:#14203a;font:16px/1.65 "PT Serif",Georgia,"Times New Roman",serif}
  .page{max-width:820px;margin:32px auto;background:#fff;padding:64px 72px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .crest{text-align:center;font:600 11px/1 system-ui,sans-serif;letter-spacing:.2em;color:#9a7a36;text-transform:uppercase}
  h1{font-size:24px;line-height:1.3;text-align:center;margin:18px 0 6px}
  .meta{text-align:center;color:#5b6474;font:13px/1.5 system-ui,sans-serif;margin-bottom:28px}
  hr{border:0;border-top:1px solid #d9b56a;margin:24px 0}
  h2,h3,h4{line-height:1.35;margin:1.6em 0 .5em}
  .doc-h1{text-align:center;font-size:20px}.doc-h2{font-size:17px}.doc-h3{font-size:16px}
  table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #c9ced8;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f3f4f7}
  .doc-table{overflow-x:auto}
  .doc-important{border-left:3px solid #b8913f;background:#faf6ec;padding:10px 16px;margin:16px 0}
  .doc-important-label{display:block;font:600 10px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#9a7a36;margin-bottom:6px}
  .doc-important p{margin:.3em 0}
  mark{background:#f6e7bf;padding:0 2px}
  .foot{margin-top:40px;color:#5b6474;font:12px/1.5 system-ui,sans-serif;border-top:1px solid #e3e6ec;padding-top:12px}
  @media (max-width:700px){.page{margin:0;padding:28px 20px}}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;padding:0}}
</style></head><body><div class="page">
<div class="crest">Генеральная Ассамблея штата SWAG · Конгресс штата SWAG</div>
<h1>${esc(v.title)}</h1>
<div class="meta">${esc(T.label)} № ${esc(v.number)} · редакция № ${revisionNo}${v.initiator ? ` · инициатор: ${esc(v.initiator)}` : ''}</div>
${v.hint ? `<p><em>${esc(v.hint)}</em></p>` : ''}
<hr>
${html || '<p>Полный текст не приложен.</p>'}
<div class="foot">Документ выгружен из электронной системы голосования Генеральной Ассамблеи штата SWAG ${esc(fmt(new Date().toISOString()))}.</div>
</div></body></html>`;
}

module.exports = { standalone };
