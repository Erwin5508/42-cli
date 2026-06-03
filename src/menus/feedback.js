'use strict';

const { select } = require('../ui/select');
const { input } = require('../ui/input');
const c = require('../ui/colors');
const { t } = require('../i18n');
const feedback = require('../utils/feedback');
const config = require('../utils/config');
const stats = require('../utils/stats');
const ach = require('../utils/achievements');

const CATEGORIES = [
  { value: 'bug', key: 'feedback.catBug' },
  { value: 'falsepass', key: 'feedback.catFalsePass' },
  { value: 'suggestion', key: 'feedback.catSuggestion' },
  { value: 'other', key: 'feedback.catOther' },
];

function reasonForCategory(category) {
  if (category === 'bug' || category === 'falsepass') {
    return {
      reason_en: 'reported a bug / false pass through in-CLI feedback',
      reason_fr: 'a signalé un bug / faux positif via le retour intégré',
    };
  }
  return {
    reason_en: 'shared feedback to improve the CLI',
    reason_fr: 'a partagé un retour pour améliorer le CLI',
  };
}

// On a successful send: count it, credit the user locally, fire achievements.
function onSent({ name, login, category }) {
  stats.recordFeedback();
  const reason = reasonForCategory(category);
  config.addLocalContributor({ name, login: login || '', ...reason, local: true });
  const newly = ach.evaluate({ event: 'feedback', category, now: new Date() });
  ach.announceNew(newly);
}

// When the endpoint isn't configured or the network failed, don't lose the
// message — show it plainly with the maintainer's address so the user can
// copy/paste it into their own mail client.
function printManualFallback(fields) {
  console.log('');
  console.log(`  ${c.yellow(t('feedback.sendFailed'))}`);
  console.log(`  ${c.dim(t('feedback.manualHint', { email: 'bruno.gomez@learner.42.tech' }))}`);
  console.log('');
  console.log(c.dim('  ──────── feedback ────────'));
  console.log(`  ${c.dim('from:')} ${fields.name}${fields.login ? ` (${fields.login})` : ''}`);
  console.log(`  ${c.dim('type:')} ${fields.category}`);
  console.log(`  ${c.dim('message:')} ${fields.message}`);
  console.log(c.dim('  ──────────────────────────'));
  console.log('');
}

async function collectAndSend() {
  const category = await select({
    message: t('feedback.pickCategory'),
    choices: [
      ...CATEGORIES.map((cat) => ({ label: t(cat.key), value: cat.value })),
      { label: t('common.back'), value: 'back' },
    ],
  });
  if (category === 'back') return false;

  const cfg = config.read();
  const name = await input({ message: t('feedback.namePrompt'), defaultValue: cfg.name || '' });
  if (!name) {
    console.log(c.yellow(`  ${t('feedback.nameRequired')}`));
    return false;
  }
  const login = await input({ message: t('feedback.loginPrompt') });
  const email = await input({ message: t('feedback.emailPrompt') });
  const message = await input({ message: t('feedback.messagePrompt') });
  if (!message) {
    console.log(c.dim(`  ${t('feedback.cancelled')}`));
    return false;
  }

  const fields = { name, login, email, category, message };

  const confirm = await select({
    message: t('feedback.confirm'),
    choices: [
      { label: t('feedback.send'), value: 'send' },
      { label: t('common.back'), value: 'cancel' },
    ],
  });
  if (confirm !== 'send') {
    console.log(c.dim(`  ${t('feedback.cancelled')}`));
    return false;
  }

  console.log('');
  console.log(c.dim(`  ${t('feedback.sending')}`));
  const res = await feedback.send(fields);

  if (res.ok) {
    onSent(fields);
    console.log('');
    console.log(`  ${c.green('✓')} ${t('feedback.thanks')}`);
    console.log(`  ${c.dim(t('feedback.creditedLocal'))}`);
    console.log('');
  } else {
    printManualFallback(fields);
  }
  return true;
}

async function feedbackMenu() {
  console.log('');
  console.log(`  ${c.cyan(c.bold(t('feedback.title')))}`);
  console.log(`  ${c.dim(t('feedback.intro'))}`);
  console.log('');

  while (true) {
    const action = await select({
      message: t('feedback.action'),
      choices: [
        { label: t('feedback.start'), value: 'start' },
        { label: t('common.back'), value: 'back' },
      ],
    });
    if (action === 'back') return;
    if (action === 'start') await collectAndSend();
  }
}

module.exports = { feedbackMenu };
