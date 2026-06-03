'use strict';

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const c = require('../ui/colors');
const { detectPython } = require('./pyTester');

const HARNESS = path.join(__dirname, '..', '..', 'resources', 'pushswap-tester', 'run_pushswap.py');

// A push_swap project: a Makefile plus at least one C source at the root.
function isPushSwapDir(dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  if (!fs.existsSync(path.join(dir, 'Makefile'))) return false;
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return false; }
  return entries.some((f) => /\.c$/.test(f));
}

function spawnAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, opts);
    } catch (err) {
      return resolve({ exitCode: 1, stdout, stderr, error: err });
    }
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (opts && opts.streamStdout !== false) process.stdout.write(chunk);
      });
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (opts && opts.streamStderr !== false) process.stderr.write(chunk);
      });
    }
    child.on('error', (err) => resolve({ exitCode: 1, stdout, stderr, error: err }));
    child.on('close', (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}

// Build with the project's Makefile and return the path to the produced binary.
async function build(dir) {
  const make = await spawnAsync('make', ['-C', dir], {
    stdio: ['ignore', 'pipe', 'pipe'],
    streamStdout: false,
  });
  if (make.error && make.error.code === 'ENOENT') {
    return { ok: false, stage: 'setup', error: 'make was not found on your PATH.' };
  }
  if (make.exitCode !== 0) {
    const tail = (make.stderr || make.stdout || '').trim().split('\n').slice(-12).join('\n');
    return { ok: false, stage: 'build', error: tail || 'make failed' };
  }
  const binary = path.join(dir, 'push_swap');
  if (!fs.existsSync(binary)) {
    return { ok: false, stage: 'build', error: 'make succeeded but no `push_swap` binary was produced.' };
  }
  return { ok: true, binary };
}

async function runTester(dir) {
  const python = detectPython();
  if (!python) {
    return { exitCode: 1, stage: 'setup', error: 'python3 was not found on your PATH (the checker needs it).' };
  }
  if (!fs.existsSync(HARNESS)) {
    return { exitCode: 1, stage: 'setup', error: `checker harness missing at ${HARNESS}` };
  }

  const built = await build(dir);
  if (!built.ok) {
    return { exitCode: 1, stage: built.stage, error: built.error };
  }

  const run = await spawnAsync(python, [HARNESS, '--bin', built.binary, '--color'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { exitCode: run.exitCode, stage: 'run', stdout: run.stdout, stderr: run.stderr, error: run.error };
}

function summarize(result) {
  const lines = [];
  if (result.stage === 'setup') {
    lines.push('', `${c.bold('Result:')} ${c.red('FAIL — setup')}`);
    lines.push(`  ${c.red(result.error || 'tester unavailable')}`);
    if (/python3/i.test(result.error || '')) {
      lines.push(`  ${c.yellow('hint:')} install Python 3.10+ and make sure ${c.bold('python3')} is on your PATH.`);
    }
    return lines.join('\n');
  }
  if (result.stage === 'build') {
    lines.push('', `${c.bold('Result:')} ${c.red('FAIL — build')}`);
    for (const l of (result.error || '').split('\n')) lines.push(`  ${c.red(l)}`);
    lines.push(`  ${c.yellow('hint:')} your project must compile with ${c.bold('make')} (cc -Wall -Wextra -Werror).`);
    return lines.join('\n');
  }
  // stage 'run' — the harness printed its own coloured per-test summary.
  return '';
}

function passed(result) {
  return result && result.stage === 'run' && result.exitCode === 0;
}

module.exports = { isPushSwapDir, build, runTester, summarize, passed, HARNESS };
