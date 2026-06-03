'use strict';

const { select } = require('../ui/select');
const { input } = require('../ui/input');
const c = require('../ui/colors');
const { resolveLibftPath } = require('../utils/projectDetect');
const tester = require('../runners/pushSwapTester');
const norm = require('../runners/norminette');
const { t } = require('../i18n');
const stats = require('../utils/stats');
const ach = require('../utils/achievements');

async function section(title, fn) {
  const dashes = '─'.repeat(Math.max(2, 56 - title.length));
  console.log('');
  console.log(`${c.dim('──')} ${c.cyan(title)} ${c.dim(dashes)}`);
  console.log('');
  await fn();
  console.log('');
}

function recordTesterResult(result) {
  const passed = tester.passed(result);
  // targets: [] keeps the generic test counters moving without polluting the
  // per-libft-function stats that drive the libft achievements.
  stats.recordTestRun({ targets: [], passed });
  ach.announceNew(ach.evaluate({ event: 'test', targets: [], passed, allFailed: false, now: new Date() }));
}

function recordNormResult(result) {
  const clean = result && result.exitCode === 0;
  stats.recordNorminetteRun({ clean });
  ach.announceNew(ach.evaluate({ event: 'norminette', clean, now: new Date() }));
}

async function promptForCustomPath() {
  while (true) {
    const raw = await input({ message: t('ps.pathPrompt') });
    if (!raw) return null;
    const abs = resolveLibftPath(raw);
    if (!tester.isPushSwapDir(abs)) {
      console.log(c.red(`  ✗ ${abs}`));
      console.log(c.yellow(`     ${t('ps.notProject')}`));
      continue;
    }
    return abs;
  }
}

async function pickPath() {
  const cwd = process.cwd();
  const here = await select({
    message: t('ps.areYouHere', { cwd }),
    choices: [
      { label: t('ps.useThisDir'), value: 'yes' },
      { label: t('ps.enterPath'), value: 'no' },
      { label: t('common.back'), value: 'back' },
    ],
  });
  if (here === 'back') return null;
  if (here === 'yes') {
    if (tester.isPushSwapDir(cwd)) return cwd;
    console.log(c.red(`  ✗ ${cwd}`));
    console.log(c.yellow(`     ${t('ps.notProject')}`));
    console.log(c.dim(`     ${t('ps.fallbackToPathEntry')}`));
  }
  return promptForCustomPath();
}

async function run() {
  const dir = await pickPath();
  if (!dir) return 'back';
  console.log(`  ${c.dim(t('ps.pathLabel'))} ${dir}`);

  while (true) {
    const action = await select({
      message: t('ps.action'),
      choices: [
        { label: t('ps.runTests'), value: 'tests' },
        { label: t('ps.runNorm'), value: 'norm' },
        { label: t('ps.runNormAndTests'), value: 'both' },
        { label: t('ps.changePath'), value: 'path' },
        { label: t('common.back'), value: 'back' },
        { label: t('common.quit'), value: 'quit' },
      ],
    });

    if (action === 'tests') {
      await section(t('ps.sectionTests'), async () => {
        const r = await tester.runTester(dir);
        const s = tester.summarize(r);
        if (s) console.log(s);
        recordTesterResult(r);
      });
    } else if (action === 'norm') {
      await section(t('sections.norminette'), async () => {
        const r = await norm.runNorminetteRecursive(dir);
        console.log(norm.summarize(r));
        recordNormResult(r);
      });
    } else if (action === 'both') {
      await section(t('sections.norminette'), async () => {
        const r = await norm.runNorminetteRecursive(dir);
        console.log(norm.summarize(r));
        recordNormResult(r);
      });
      await section(t('ps.sectionTests'), async () => {
        const r = await tester.runTester(dir);
        const s = tester.summarize(r);
        if (s) console.log(s);
        recordTesterResult(r);
      });
    } else if (action === 'path') {
      return run();
    } else if (action === 'back') {
      return 'back';
    } else if (action === 'quit') {
      return 'quit';
    }
  }
}

module.exports = { run };
