'use strict';

const c = require('./colors');
const { t } = require('../i18n');
const { GALAXY_ART } = require('./galaxy');

const ART = [
  '   _  _  ____   ',
  '  | || ||___ \\  ',
  '  | || |_ __) | ',
  '  |__   _/ __/  ',
  '     |_||_____| ',
];

function pad(s, n) {
  return s + ' '.repeat(Math.max(0, n - s.length));
}

function banner() {
  const cols = process.stdout.columns || 80;
  const gW = Math.max(...GALAXY_ART.map((l) => l.length));
  const aW = Math.max(...ART.map((l) => l.length));

  let header;
  if (cols >= gW + 3 + aW) {
    // Wide terminal: galaxy on the left, the 42 wordmark vertically centered
    // beside it.
    const top = Math.floor((GALAXY_ART.length - ART.length) / 2);
    header = GALAXY_ART.map((line, i) => {
      const left = c.magenta(pad(line, gW));
      const ai = i - top;
      const right = ai >= 0 && ai < ART.length ? c.cyan(ART[ai]) : '';
      return `${left}   ${right}`;
    }).join('\n');
  } else {
    // Narrow terminal: stack them so nothing wraps.
    const galaxy = GALAXY_ART.map((l) => c.magenta(l)).join('\n');
    const art = ART.map((l) => c.cyan(l)).join('\n');
    header = `${galaxy}\n\n${art}`;
  }

  return `\n${header}\n\n  ${c.bold(t('banner.description'))}\n  ${c.dim(t('banner.credits'))}\n\n`;
}

module.exports = { banner };
