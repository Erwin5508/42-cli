'use strict';

// The 42 cursus, reorganised into modules. Each module groups several
// submodules (the individual projects/exercises). `available: false` marks a
// module that is shown locked in the tab bar but cannot be entered yet.
//
// `exam` (when present) describes the per-module Exam Practice: `lang` is the
// language the exam is graded in ('c' or 'python') and `bank` is the folder
// under resources/exam/<bank>/ holding that module's exercise pool.
//
// Submodules are pure descriptors — the dispatch from a submodule id to the
// menu that runs it lives in menus/modulesScreen.js, mirroring how
// commonCore.js dispatches on a returned value rather than storing callbacks.

const { PROJECTS } = require('./pythonProjects');

const MODULES = [
  {
    id: 'fundamentals',
    title: 'Programming Fundamentals',
    descKey: 'mod.fundamentals.desc',
    available: true,
    exam: { lang: 'c', bank: 'fundamentals' },
    submodules: [
      { id: 'libft', title: 'Libft' },
      { id: 'printf', title: 'ft_printf' },
      { id: 'gnl', title: 'get_next_line' },
      { id: 'push_swap', title: 'push_swap' },
      { id: 'exam', exam: true },
    ],
  },
  {
    id: 'oop',
    title: 'Object Oriented Programming',
    descKey: 'mod.oop.desc',
    available: true,
    exam: { lang: 'python', bank: 'oop' },
    submodules: [
      ...PROJECTS.map((p) => ({
        id: p.id,
        title: p.title,
        subtitle: p.subtitle,
        python: true,
      })),
      { id: 'exam', exam: true },
    ],
  },
  {
    id: 'sysadmin',
    title: 'Systems And Networks Administration',
    descKey: 'mod.sysadmin.desc',
    available: false,
  },
  {
    id: 'algorithmics',
    title: 'Algorithmics',
    descKey: 'mod.algorithmics.desc',
    available: false,
  },
  {
    id: 'ai',
    title: 'Artificial Intelligence',
    descKey: 'mod.ai.desc',
    available: false,
  },
  {
    id: 'sysnet',
    title: 'System and Network Programming',
    descKey: 'mod.sysnet.desc',
    available: false,
  },
  {
    id: 'web',
    title: 'Web Programming',
    descKey: 'mod.web.desc',
    available: false,
  },
];

function byId(id) {
  return MODULES.find((m) => m.id === id) || null;
}

module.exports = { MODULES, byId };
