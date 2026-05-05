'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const c = require('../ui/colors');

const TESTER_DIR = path.join(__dirname, '..', '..', 'resources', 'tester');
const TESTER_BIN = path.join(TESTER_DIR, '42_tester');
// Working directory for the standalone (Makefile-less) build path. We write
// per-function .o files and a fallback libft.h here, then link from the same
// place. Kept inside TESTER_DIR so cleanup is local and the user's project
// is never touched.
const STANDALONE_DIR = path.join(TESTER_DIR, '.standalone');

const STANDALONE_CFLAGS = ['-Wall', '-Wextra', '-Werror', '-O0', '-g', '-Wno-unused-function'];
const ASAN_FLAGS = ['-fsanitize=address', '-fno-omit-frame-pointer'];

// Fallback libft.h used only when the student hasn't written one yet. Has
// every prototype the tester touches, including t_list. The user's libft.h
// (if present) wins because `#include "libft.h"` resolves the source file's
// own directory before any -I path.
const STANDALONE_HEADER = `#ifndef LIBFT_H
# define LIBFT_H
# include <stddef.h>

typedef struct s_list {
	void			*content;
	struct s_list	*next;
}	t_list;

int		ft_isalpha(int);
int		ft_isdigit(int);
int		ft_isalnum(int);
int		ft_isascii(int);
int		ft_isprint(int);
int		ft_toupper(int);
int		ft_tolower(int);

size_t	ft_strlen(const char *);
char	*ft_strchr(const char *, int);
char	*ft_strrchr(const char *, int);
int		ft_strncmp(const char *, const char *, size_t);
char	*ft_strnstr(const char *, const char *, size_t);
char	*ft_strdup(const char *);

void	*ft_memset(void *, int, size_t);
void	ft_bzero(void *, size_t);
void	*ft_memcpy(void *, const void *, size_t);
void	*ft_memmove(void *, const void *, size_t);
void	*ft_memchr(const void *, int, size_t);
int		ft_memcmp(const void *, const void *, size_t);

size_t	ft_strlcpy(char *, const char *, size_t);
size_t	ft_strlcat(char *, const char *, size_t);

int		ft_atoi(const char *);
void	*ft_calloc(size_t, size_t);
char	*ft_itoa(int);

char	*ft_substr(char const *, unsigned int, size_t);
char	*ft_strjoin(char const *, char const *);
char	*ft_strtrim(char const *, char const *);
char	**ft_split(char const *, char);
char	*ft_strmapi(char const *, char (*)(unsigned int, char));
void	ft_striteri(char *, void (*)(unsigned int, char *));

void	ft_putchar_fd(char, int);
void	ft_putstr_fd(char *, int);
void	ft_putendl_fd(char *, int);
void	ft_putnbr_fd(int, int);

t_list	*ft_lstnew(void *);
void	ft_lstadd_front(t_list **, t_list *);
int		ft_lstsize(t_list *);
t_list	*ft_lstlast(t_list *);
void	ft_lstadd_back(t_list **, t_list *);
void	ft_lstdelone(t_list *, void (*)(void *));
void	ft_lstclear(t_list **, void (*)(void *));
void	ft_lstiter(t_list *, void (*)(void *));
t_list	*ft_lstmap(t_list *, void *(*)(void *), void (*)(void *));

#endif
`;

const FUNCTIONS = [
  'isalpha', 'isdigit', 'isalnum', 'isascii', 'isprint',
  'toupper', 'tolower',
  'strlen', 'strchr', 'strrchr', 'strncmp', 'strnstr', 'strdup',
  'memset', 'bzero', 'memcpy', 'memmove', 'memchr', 'memcmp',
  'strlcpy', 'strlcat',
  'atoi', 'calloc', 'itoa',
  'substr', 'strjoin', 'strtrim', 'split', 'strmapi', 'striteri',
  'putchar_fd', 'putstr_fd', 'putendl_fd', 'putnbr_fd',
  'lstnew', 'lstadd_front', 'lstsize', 'lstlast', 'lstadd_back',
  'lstdelone', 'lstclear', 'lstiter', 'lstmap',
];

// Bonus list tests build their fixtures with ft_lstnew (via build3 in tester.c
// or directly). When picked in isolation, HAVE_FT_lstnew isn't defined, the
// build3 fallback returns NULL, and assertions on a non-empty list fail with
// no obvious cause. Warn the user up front so the failure isn't a mystery.
const NEEDS_LSTNEW = [
  'lstadd_front', 'lstsize', 'lstlast', 'lstadd_back',
  'lstdelone', 'lstclear', 'lstiter', 'lstmap',
];

function spawnAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(cmd, args, opts);
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
    child.on('error', (err) => {
      resolve({ exitCode: 1, stdout, stderr, error: err });
    });
    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

function stripCComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function detectImplemented(libftPath) {
  let header = '';
  try { header = stripCComments(fs.readFileSync(path.join(libftPath, 'libft.h'), 'utf8')); }
  catch { return { present: [], missing: [...FUNCTIONS] }; }
  const present = [];
  const missing = [];
  for (const fn of FUNCTIONS) {
    const hasFile = fs.existsSync(path.join(libftPath, `ft_${fn}.c`));
    const hasProto = new RegExp(`\\bft_${fn}\\s*\\(`).test(header);
    if (hasFile && hasProto) present.push(fn);
    else missing.push(fn);
  }
  return { present, missing };
}

async function build(libftPath) {
  const opts = {
    stdio: ['ignore', 'pipe', 'pipe'],
    streamStdout: false,
    streamStderr: false,
  };
  const { present } = detectImplemented(libftPath);
  const defines = present.map((fn) => `-DHAVE_FT_${fn}`).join(' ');
  // Always fclean the student's libft before building. Stale .o files from a
  // previous `make` (different CFLAGS, header has since changed, ASan flipped)
  // can link silently and produce wrong test results — passes that should fail
  // or fails that should pass. This guarantees we're testing the latest source.
  await spawnAsync('make', ['-C', libftPath, 'fclean'], opts);
  await spawnAsync('make', ['-C', TESTER_DIR, 'clean'], opts);
  const args = ['-C', TESTER_DIR, `LIBFT_PATH=${libftPath}`];
  if (defines) args.push(`EXTRA_CFLAGS=${defines}`);
  args.push('build');
  return spawnAsync('make', args, opts);
}

function findMainOffenders(libftPath) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(libftPath); } catch { return out; }
  for (const f of entries) {
    if (!/^ft_.*\.c$/.test(f)) continue;
    let text;
    try { text = fs.readFileSync(path.join(libftPath, f), 'utf8'); } catch { continue; }
    if (/^\s*(int|void)\s+main\s*\(/m.test(text)) out.push(f);
  }
  return out;
}

async function runTester(libftPath, targets) {
  if (!fs.existsSync(path.join(TESTER_DIR, 'tester.c'))) {
    return {
      exitCode: 1,
      stage: 'setup',
      error: `Bundled tester source not found at ${TESTER_DIR}`,
    };
  }

  process.stdout.write(c.dim('  building libft + tester…\n'));
  const built = await build(libftPath);
  if (built.exitCode !== 0) {
    const log = (built.stderr || '') + (built.stdout || '');
    const dupMain = /duplicate symbol .*_main/i.test(log);
    return {
      exitCode: built.exitCode,
      stage: 'build',
      stdout: built.stdout,
      stderr: built.stderr,
      error: built.error,
      mainOffenders: dupMain ? findMainOffenders(libftPath) : [],
    };
  }

  process.stdout.write('\n');
  const targetArgs = Array.isArray(targets) ? targets : (targets ? [targets] : []);
  const args = ['--color', ...targetArgs];
  // ASan defaults differ between Linux (_exit on error) and macOS (abort()).
  // Pin them so the tester behaves the same everywhere, and silence leak
  // detection (we don't always free in the tests and don't want false noise).
  const asanOpts = [
    'abort_on_error=0',
    'halt_on_error=1',
    'detect_leaks=0',
    'print_stacktrace=1',
    'symbolize=1',
    'color=always',
  ].join(':');
  const run = await spawnAsync(TESTER_BIN, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: TESTER_DIR,
    env: {
      ...process.env,
      ASAN_OPTIONS: asanOpts,
      UBSAN_OPTIONS: 'print_stacktrace=1',
    },
  });
  return {
    exitCode: run.exitCode,
    stage: 'run',
    stdout: run.stdout,
    stderr: run.stderr,
    error: run.error,
  };
}

function listAvailableSources(libftPath) {
  const present = [];
  const missing = [];
  for (const fn of FUNCTIONS) {
    if (fs.existsSync(path.join(libftPath, `ft_${fn}.c`))) present.push(fn);
    else missing.push(fn);
  }
  return { present, missing };
}

function resetStandaloneDir() {
  try { fs.rmSync(STANDALONE_DIR, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(STANDALONE_DIR, { recursive: true });
}

async function buildStandalone(libftPath, targets) {
  const opts = {
    stdio: ['ignore', 'pipe', 'pipe'],
    streamStdout: false,
    streamStderr: false,
  };

  resetStandaloneDir();
  // Drop the fallback header — only used when the student's libft.h is
  // missing (the source file's own directory is searched first by
  // `#include "libft.h"`).
  fs.writeFileSync(path.join(STANDALONE_DIR, 'libft.h'), STANDALONE_HEADER);

  const { present } = listAvailableSources(libftPath);
  const missingTargets = targets.filter((fn) => !present.includes(fn));
  if (missingTargets.length > 0) {
    return {
      exitCode: 1,
      stage: 'build',
      stderr: `missing source file(s): ${missingTargets.map((fn) => `ft_${fn}.c`).join(', ')}\n`,
      stdout: '',
      missingSources: missingTargets,
    };
  }

  // Compile every available ft_*.c, not just the targeted ones — student's
  // ft_split may call ft_strlen from a sibling file. Drop sources that fail
  // to build silently *unless* one of the targeted functions is the offender,
  // in which case we surface the error.
  const includeFlags = ['-I', libftPath, '-I', STANDALONE_DIR];
  const compileFlags = [...STANDALONE_CFLAGS, ...ASAN_FLAGS, ...includeFlags];
  const objs = [];
  const compiled = [];
  for (const fn of present) {
    const src = path.join(libftPath, `ft_${fn}.c`);
    const obj = path.join(STANDALONE_DIR, `ft_${fn}.o`);
    const r = await spawnAsync('cc', ['-c', src, '-o', obj, ...compileFlags], opts);
    if (r.exitCode !== 0) {
      if (targets.includes(fn)) {
        return {
          exitCode: r.exitCode,
          stage: 'build',
          stdout: r.stdout,
          stderr: r.stderr,
          failedSource: `ft_${fn}.c`,
        };
      }
      continue;
    }
    objs.push(obj);
    compiled.push(fn);
  }

  // Only activate test bodies for the functions the user asked for. Other
  // ft_*.c files are still linked (cross-file helpers — e.g. ft_strjoin
  // calling ft_strlen — must resolve), but their test bodies stay gated out.
  // If we defined HAVE_FT_<fn> for every compiled source, a broken prototype
  // in the student's libft.h (e.g. `char ft_strmapi(...)` instead of
  // `char *ft_strmapi(...)`) would block testing an unrelated function like
  // ft_itoa, since test_strmapi's body would activate and fail to typecheck.
  const defines = compiled
    .filter((fn) => targets.includes(fn))
    .map((fn) => `-DHAVE_FT_${fn}`);
  const testerObj = path.join(STANDALONE_DIR, 'tester.o');
  const compileTester = await spawnAsync('cc', [
    '-c', path.join(TESTER_DIR, 'tester.c'),
    '-o', testerObj,
    ...STANDALONE_CFLAGS,
    ...ASAN_FLAGS,
    ...defines,
    ...includeFlags,
  ], opts);
  if (compileTester.exitCode !== 0) {
    return {
      exitCode: compileTester.exitCode,
      stage: 'build',
      stdout: compileTester.stdout,
      stderr: compileTester.stderr,
    };
  }

  const link = await spawnAsync('cc', [
    testerObj, ...objs,
    '-o', TESTER_BIN,
    ...ASAN_FLAGS,
  ], opts);
  if (link.exitCode !== 0) {
    return {
      exitCode: link.exitCode,
      stage: 'build',
      stdout: link.stdout,
      stderr: link.stderr,
    };
  }
  return { exitCode: 0, stage: 'build', stdout: '', stderr: '' };
}

async function runTesterStandalone(libftPath, targets) {
  const requested = Array.isArray(targets) ? targets : (targets ? [targets] : []);
  if (requested.length === 0) {
    return {
      exitCode: 1,
      stage: 'setup',
      error: 'standalone mode requires at least one target function',
    };
  }
  if (!fs.existsSync(path.join(TESTER_DIR, 'tester.c'))) {
    return {
      exitCode: 1,
      stage: 'setup',
      error: `Bundled tester source not found at ${TESTER_DIR}`,
    };
  }

  const needsLstnew = requested.filter((fn) => NEEDS_LSTNEW.includes(fn));
  if (needsLstnew.length > 0 && !requested.includes('lstnew')) {
    const list = needsLstnew.map((fn) => `ft_${fn}`).join(', ');
    process.stdout.write(c.yellow(`  ⚠  ${list} build their test fixtures with ft_lstnew.\n`));
    process.stdout.write(c.yellow('     Add ft_lstnew to the list or these tests will fail on empty fixtures.\n'));
  }

  process.stdout.write(c.dim('  building (standalone — no Makefile required)…\n'));
  const built = await buildStandalone(libftPath, requested);
  if (built.exitCode !== 0) {
    return {
      exitCode: built.exitCode,
      stage: built.stage || 'build',
      stdout: built.stdout,
      stderr: built.stderr,
      missingSources: built.missingSources,
      failedSource: built.failedSource,
      standalone: true,
    };
  }

  process.stdout.write('\n');
  const args = ['--color', ...requested];
  const asanOpts = [
    'abort_on_error=0',
    'halt_on_error=1',
    'detect_leaks=0',
    'print_stacktrace=1',
    'symbolize=1',
    'color=always',
  ].join(':');
  const run = await spawnAsync(TESTER_BIN, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    cwd: TESTER_DIR,
    env: {
      ...process.env,
      ASAN_OPTIONS: asanOpts,
      UBSAN_OPTIONS: 'print_stacktrace=1',
    },
  });
  return {
    exitCode: run.exitCode,
    stage: 'run',
    stdout: run.stdout,
    stderr: run.stderr,
    error: run.error,
    standalone: true,
  };
}

function summarize(result) {
  const lines = [];
  if (result.stage === 'setup') {
    lines.push('', `${c.bold('Result:')} ${c.red('FAIL')}`);
    lines.push(`  ${c.red(result.error || 'tester missing')}`);
    return lines.join('\n');
  }
  if (result.stage === 'build') {
    lines.push('', `${c.bold('Result:')} ${c.red('FAIL — build error')}`);
    if (result.missingSources && result.missingSources.length > 0) {
      const files = result.missingSources.map((fn) => `ft_${fn}.c`).join(', ');
      lines.push(`  ${c.yellow('cause:')} source file(s) not found: ${c.bold(files)}`);
      lines.push(
        `  ${c.dim('drop the implementation file in the libft directory and try again.')}`
      );
      return lines.join('\n');
    }
    if (result.failedSource) {
      lines.push(
        `  ${c.yellow('cause:')} ${c.bold(result.failedSource)} failed to compile`
      );
      const buildOut = (result.stderr && result.stderr.trim()) || (result.stdout && result.stdout.trim());
      if (buildOut) {
        lines.push(c.yellow('  compiler output (last 12 lines):'));
        buildOut.split('\n').slice(-12).forEach((l) => lines.push(`    ${c.dim(l)}`));
      }
      return lines.join('\n');
    }
    if (result.mainOffenders && result.mainOffenders.length > 0) {
      lines.push(
        `  ${c.yellow('cause:')} found ${c.bold('main()')} in ${c.bold(result.mainOffenders.join(', '))}`
      );
      lines.push(
        `  ${c.yellow('why:')}   libft.a must be a library only — the linker sees two main()s ` +
          '(yours + the tester) and refuses.'
      );
      lines.push(
        `  ${c.dim('see "Subject compliance check" in the menu for the same finding.')}`
      );
      return lines.join('\n');
    }
    const buildOut = (result.stderr && result.stderr.trim()) || (result.stdout && result.stdout.trim());
    if (buildOut) {
      lines.push(c.yellow('  build output (last 12 lines):'));
      buildOut.split('\n').slice(-12).forEach((l) => lines.push(`    ${c.dim(l)}`));
    }
    if (result.standalone) {
      const out = (result.stderr || '') + (result.stdout || '');
      const looksLikeLink = /undefined reference|undefined symbol|ld: symbol/i.test(out);
      const looksLikeProto = /tester\.c:\s*\d+:.*error|implicit declaration|incompatible pointer types|makes pointer from integer/i.test(out);
      if (looksLikeProto && !looksLikeLink) {
        lines.push(
          c.yellow('  hint:') +
            ' the targeted source compiled, but the tester won\'t — your libft.h ' +
            'declares one of the targeted functions with the wrong signature ' +
            '(check the return type and parameter list against the subject).'
        );
      } else if (looksLikeLink) {
        lines.push(
          c.yellow('  hint:') +
            ' the targeted source compiled, but linking failed — usually a missing helper ' +
            'in another ft_*.c file the targeted function calls.'
        );
      } else {
        lines.push(
          c.yellow('  hint:') +
            ' targeted source compiled cleanly. The tester or link step failed — ' +
            'check the message above for the offending file:line.'
        );
      }
    } else {
      lines.push(
        c.yellow('  hint:') +
          ' make sure all 42 ft_* functions are implemented and the Makefile builds libft.a, ' +
          'or use "Test specific functions" to skip the Makefile entirely.'
      );
    }
    return lines.join('\n');
  }
  // run stage — the C tester already printed its own pretty summary,
  // including informative messages on exit 2 (no match / nothing ready).
  // If ASan / UBSan tripped, surface a clear banner so users don't wonder
  // why the run stopped early — the diagnostic is already on stderr above.
  const stderr = result.stderr || '';
  const asanMatch = stderr.match(/AddressSanitizer:\s*([\w-]+)[\s\S]*?in\s+(\S+)\s+(\S+:\d+)/);
  const ubsanMatch = stderr.match(/runtime error:\s*([^\n]+)/);
  if (asanMatch) {
    lines.push('');
    lines.push(`${c.bold('Result:')} ${c.red('FAIL — memory error')}`);
    lines.push(
      `  ${c.yellow('AddressSanitizer:')} ${c.bold(asanMatch[1])} in ` +
        `${c.bold(asanMatch[2])} (${asanMatch[3]})`
    );
    lines.push(
      `  ${c.dim('full stack trace and shadow map are above. fix this first — ' +
        'memory bugs can mask or fake later assertion results.')}`
    );
    return lines.join('\n');
  }
  if (ubsanMatch) {
    lines.push('');
    lines.push(`${c.bold('Result:')} ${c.red('FAIL — undefined behavior')}`);
    lines.push(`  ${c.yellow('UBSan:')} ${ubsanMatch[1]}`);
    return lines.join('\n');
  }
  return '';
}

module.exports = {
  runTester,
  runTesterStandalone,
  summarize,
  FUNCTIONS,
  TESTER_DIR,
  detectImplemented,
  listAvailableSources,
};
