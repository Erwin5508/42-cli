'use strict';

// A two-axis navigator: a horizontal tab bar of modules (← / → to switch) and,
// below it, a vertical list of the active module's submodules (↑ / ↓ + Enter).
//
// It reuses the raw-mode discipline of select.js — cursor hide, the additive
// `\x1b[<n>A` redraw scheme, the cleanup/Ctrl-C handling — but renders its own
// fixed-height block so the up-count never desyncs as the active tab changes.

const readline = require('readline');
const c = require('./colors');
const { t } = require('../i18n');

// rows reserved for the wrapped module description (padded/truncated to this)
const DESC_ROWS = 4;

function visibleLen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function termWidth() {
  return process.stdout.columns && process.stdout.columns > 20
    ? process.stdout.columns
    : 80;
}

// Wrap plain text to `width`, return exactly `rows` lines (truncate / pad).
function wrapToRows(text, width, rows) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur.length + 1 + w.length) > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  while (lines.length < rows) lines.push('');
  if (lines.length > rows) {
    const kept = lines.slice(0, rows);
    let last = kept[rows - 1];
    if (last.length > width - 1) last = last.slice(0, width - 2) + '…';
    else last = last + ' …';
    kept[rows - 1] = last;
    return kept;
  }
  return lines;
}

// Build the tab bar, windowed around the active module so it never wraps.
function buildTabBar(modules, activeIdx, width) {
  const sep = '   ';
  const plain = modules.map((m, i) =>
    i === activeIdx ? `[ ${m.title} ]` : ` ${m.title} `);
  const colored = modules.map((m, i) => {
    const label = plain[i];
    if (i === activeIdx) return c.cyan(c.bold(label));
    return m.available ? c.dim(label) : c.gray(label);
  });

  const budget = width - 4; // leave room for the ‹ / › markers
  let lo = activeIdx;
  let hi = activeIdx;
  let used = plain[activeIdx].length;
  let grew = true;
  while (grew) {
    grew = false;
    if (hi + 1 < modules.length && used + sep.length + plain[hi + 1].length <= budget) {
      hi += 1;
      used += sep.length + plain[hi].length;
      grew = true;
    }
    if (lo - 1 >= 0 && used + sep.length + plain[lo - 1].length <= budget) {
      lo -= 1;
      used += sep.length + plain[lo].length;
      grew = true;
    }
  }
  const body = colored.slice(lo, hi + 1).join(sep);
  const left = lo > 0 ? c.dim('‹ ') : '  ';
  const right = hi < modules.length - 1 ? c.dim(' ›') : '  ';
  return left + body + right;
}

// Submodule indices that can actually be entered (skip disabled ones).
function selectableIndices(module) {
  if (!module.available || !module.submodules) return [];
  return module.submodules
    .map((sm, i) => (sm.disabled ? -1 : i))
    .filter((i) => i >= 0);
}

function submoduleLabel(sm) {
  if (sm.exam) return t('exam.menuLabel');
  if (sm.subtitle) return `${sm.title} ${c.dim('— ' + sm.subtitle)}`;
  return sm.title;
}

function moduleNav({ modules }) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    // longest submodule list across modules — the body is padded to it so the
    // total rendered height is constant on every redraw and every tab.
    const listRows = modules.reduce(
      (max, m) => Math.max(max, m.submodules ? m.submodules.length : 1),
      1
    );
    const totalLines =
      1 /* tab bar */ +
      1 /* blank */ +
      DESC_ROWS +
      1 /* blank */ +
      listRows +
      1 /* blank */ +
      1; /* hint */

    let activeIdx = modules.findIndex((m) => m.available);
    if (activeIdx < 0) activeIdx = 0;
    let subIdx = (selectableIndices(modules[activeIdx])[0]) ?? 0;

    readline.emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);

    let firstRender = true;

    function render() {
      if (!firstRender) stdout.write(`\x1b[${totalLines}A`);
      firstRender = false;
      stdout.write('\x1b[?25l');

      const width = termWidth();
      const mod = modules[activeIdx];

      stdout.write(buildTabBar(modules, activeIdx, width) + '\x1b[K\n');
      stdout.write('\x1b[K\n');

      const desc = wrapToRows(t(mod.descKey), Math.min(width - 2, 76), DESC_ROWS);
      for (const line of desc) stdout.write(`  ${c.dim(line)}\x1b[K\n`);
      stdout.write('\x1b[K\n');

      let bodyRows = 0;
      if (!mod.available) {
        stdout.write(`  ${c.yellow(t('common.comingSoon'))}\x1b[K\n`);
        bodyRows = 1;
      } else {
        mod.submodules.forEach((sm, i) => {
          const isSel = i === subIdx;
          const arrow = isSel && !sm.disabled ? c.cyan('❯') : ' ';
          let label = submoduleLabel(sm);
          if (sm.disabled) {
            const tag = sm.disabled === true ? 'disabled' : sm.disabled;
            label = `${c.gray(label)} ${c.yellow(`(${tag})`)}`;
          } else if (isSel) {
            label = c.cyan(label);
          }
          stdout.write(`  ${arrow} ${label}\x1b[K\n`);
        });
        bodyRows = mod.submodules.length;
      }
      for (let k = bodyRows; k < listRows; k++) stdout.write('\x1b[K\n');

      stdout.write('\x1b[K\n');
      stdout.write(`${c.dim(t('mod.hint'))}\x1b[K\n`);
    }

    function moveTab(step) {
      activeIdx = (activeIdx + step + modules.length) % modules.length;
      const sel = selectableIndices(modules[activeIdx]);
      subIdx = sel.length ? sel[0] : 0;
    }

    function moveSub(step) {
      const sel = selectableIndices(modules[activeIdx]);
      if (!sel.length) return;
      let pos = sel.indexOf(subIdx);
      if (pos < 0) pos = 0;
      pos = (pos + step + sel.length) % sel.length;
      subIdx = sel[pos];
    }

    function cleanup() {
      stdout.write('\x1b[?25h');
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.removeListener('keypress', onKey);
      stdin.pause();
    }

    function finish(value) {
      cleanup();
      // erase the whole block so the next prompt starts on a clean slate
      stdout.write(`\x1b[${totalLines}A`);
      for (let k = 0; k < totalLines; k++) stdout.write('\x1b[K\n');
      stdout.write(`\x1b[${totalLines}A`);
      resolve(value);
    }

    function onKey(str, key) {
      if (!key) return;
      if (key.ctrl && key.name === 'c') {
        cleanup();
        stdout.write('\n');
        process.exit(0);
      }
      if (key.name === 'left' || key.name === 'h') {
        moveTab(-1);
        render();
      } else if (key.name === 'right' || key.name === 'l') {
        moveTab(1);
        render();
      } else if (key.name === 'up' || key.name === 'k') {
        moveSub(-1);
        render();
      } else if (key.name === 'down' || key.name === 'j') {
        moveSub(1);
        render();
      } else if (key.name === 'return') {
        const mod = modules[activeIdx];
        if (!mod.available) return;
        const sm = mod.submodules[subIdx];
        if (!sm || sm.disabled) return;
        finish({ module: mod, submodule: sm });
      } else if (key.name === 'escape' || str === '0' || str === 'q') {
        finish({ action: 'back' });
      }
    }

    stdin.on('keypress', onKey);
    stdin.resume();
    render();
  });
}

module.exports = { moduleNav };
