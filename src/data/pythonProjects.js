'use strict';

// The Python data-engineering modules (the "Python piscine"). Each entry maps
// a subject PDF to its tester spec under resources/py-tester/specs/. `mypy`
// lists the files the subject requires type-checking on (true = the whole
// project is graded on type hints); flake8 applies to every module.
const PROJECTS = [
  {
    id: 'growing_code',
    title: 'Growing Code',
    subtitle: 'Python fundamentals',
    spec: 'growing_code.json',
    mypy: ['ex7/ft_seed_inventory.py'],
  },
  {
    id: 'garden_guardian',
    title: 'Garden Guardian',
    subtitle: 'exceptions & error handling',
    spec: 'garden_guardian.json',
  },
  {
    id: 'data_quest',
    title: 'Data Quest',
    subtitle: 'Python collections',
    spec: 'data_quest.json',
  },
  {
    id: 'code_cultivation',
    title: 'Code Cultivation',
    subtitle: 'object-oriented garden systems',
    spec: 'code_cultivation.json',
    mypy: true,
  },
  {
    id: 'code_nexus',
    title: 'Code Nexus',
    subtitle: 'polymorphism & abstract classes',
    spec: 'code_nexus.json',
    mypy: true,
  },
  {
    id: 'the_codex',
    title: 'The Codex',
    subtitle: "Python's import system",
    spec: 'the_codex.json',
  },
  {
    id: 'data_archivist',
    title: 'Data Archivist',
    subtitle: 'file operations & streams',
    spec: 'data_archivist.json',
  },
  {
    id: 'cosmic_data',
    title: 'Cosmic Data',
    subtitle: 'Pydantic models & validation',
    spec: 'cosmic_data.json',
    mypy: true,
  },
];

function byId(id) {
  return PROJECTS.find((p) => p.id === id) || null;
}

module.exports = { PROJECTS, byId };
