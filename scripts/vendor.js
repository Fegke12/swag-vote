// Копирует pdfmake (генерация PDF-протоколов в браузере) в public/vendor. Запуск: npm run build:vendor
import fs from 'node:fs';
for (const f of ['pdfmake.min.js', 'vfs_fonts.js']) fs.copyFileSync(`node_modules/pdfmake/build/${f}`, `public/vendor/${f}`);
console.log('pdfmake скопирован в public/vendor');
