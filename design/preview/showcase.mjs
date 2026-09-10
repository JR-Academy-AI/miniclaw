// Palette sheet + a mock working screen, both built only from tokens.json.
import { tokens, paint, gradientAt, paintGradient, displayWidth, padDisplayEnd, glyph } from './ansi.mjs';
import { renderBox } from './box.mjs';
import { profileBadge } from './sample-data.mjs';

const MODULE_LABELS = { chat: 'Chat', tasks: 'Tasks', schedules: 'Schedules', skills: 'Skills', models: 'Models', logs: 'Logs' };

const heading = (context, text) => paintGradient(context, text, { bold: true });
const muted = (context, text) => paint(context, text, { foreground: 'muted' });
const subtle = (context, text) => paint(context, text, { foreground: 'subtle' });

// Readable text on a filled badge: dark ink on bright hues, white ink on the deep light-theme hues.
const badgeInk = (context) => (context.theme === 'dark' ? 'eyeBlack' : 'eyeWhite');

function usagesOf(hueName) {
  const groups = { semantic: tokens.semantic, module: tokens.module, profile: tokens.profile };
  return Object.entries(groups).flatMap(([group, mapping]) =>
    Object.entries(mapping).filter(([, value]) => value === hueName).map(([key]) => `${group}.${key}`));
}

function renderSwatchRow(context, name, entry) {
  const swatch = paint(context, '██████', { foreground: name });
  const hex = paint(context, entry[context.theme], { foreground: name, bold: true });
  const usage = [...(name === 'coral' ? ['logo crab'] : []), ...usagesOf(name)].join('  ');
  return `${swatch}  ${name.padEnd(10)} ${padDisplayEnd(entry.zh ?? '', 5)} ${hex}   ${subtle(context, usage)}`;
}

function renderGradientBar(context, width) {
  return Array.from({ length: width }, (_, index) =>
    paint(context, '█', { foreground: gradientAt(context, index / (width - 1)) })).join('');
}

function renderTextStyles(context) {
  return [
    paint(context, 'Heading', { bold: true, foreground: 'lagoon' }) + '   ' + paint(context, 'Body text'),
    muted(context, 'Secondary') + '   ' + subtle(context, 'meta · 20:41 · 1.2k tok'),
    paint(context, 'Thinking…', { italic: true, foreground: 'muted' }) + '   '
      + paint(context, '~/.miniclaw/tasks', { underline: true, foreground: 'tide' }) + '   '
      + paint(context, ' ⌃K ', { background: 'surfaceStrong', bold: true }) + muted(context, ' key'),
  ];
}

function renderStatusLegend(context) {
  return Object.entries(tokens.semantic).map(([name, hue]) => {
    const glyphName = name === 'info' ? 'sparkle' : name;
    return paint(context, glyph(context, glyphName), { foreground: hue, bold: true }) + ' ' + name;
  }).join('   ');
}

export function renderPalette(context) {
  const barWidth = Math.min(context.width - 4, 72);
  const section = (title) => ['', heading(context, title)];
  return [
    ...section('REEF palette · 8 hues'),
    ...Object.entries(tokens.palette).map(([name, entry]) => renderSwatchRow(context, name, entry)),
    ...section('reef gradient (brand moments only: logo / welcome / thinking)'),
    renderGradientBar(context, barWidth),
    ...section('Neutrals'),
    ...['muted', 'subtle', 'border', 'surface', 'surfaceStrong'].map((name) =>
      `${paint(context, '██████', { foreground: name })}  ${name.padEnd(14)} ${subtle(context, tokens.neutral[name][context.theme])}`),
    ...section('Status'),
    renderStatusLegend(context),
    ...section('Module colors (tab underline / focused border)'),
    Object.entries(tokens.module).map(([name, hue]) => paint(context, `▎${MODULE_LABELS[name]}`, { foreground: hue, bold: true })).join('   '),
    ...section('Profile'),
    ['thinker', 'coder', 'operator', 'cheap'].map((name) => profileBadge(context, name, { isDefault: name === 'thinker' })).join('    '),
    ...section('Text styles'),
    ...renderTextStyles(context),
    '',
  ].map((line) => (line ? `  ${line}` : line));
}

function renderTabBar(context, { width, active }) {
  const wordmark = paint(context, '(\\/)', { foreground: 'coral', bold: true }) + ' ' + paintGradient(context, 'miniclaw', { bold: true });
  const tabs = Object.entries(MODULE_LABELS).map(([name, label]) => {
    if (name === active) return paint(context, label, { foreground: tokens.module[name], bold: true });
    return muted(context, label);
  });
  const liveBadge = paint(context, ` ${glyph(context, 'permission')} Computer use `, { background: tokens.semantic.permission, foreground: badgeInk(context), bold: true });
  const left = `${wordmark}   ${tabs.join('   ')}`;
  const gap = ' '.repeat(Math.max(width - displayWidth(left) - displayWidth(liveBadge), 2));
  const activeStart = displayWidth(`(\\/) miniclaw   `);
  const activeWidth = displayWidth(MODULE_LABELS[active]);
  const rule = subtle(context, '─'.repeat(activeStart))
    + paint(context, '━'.repeat(activeWidth), { foreground: tokens.module[active] })
    + paint(context, '─'.repeat(Math.max(width - activeStart - activeWidth, 0)), { foreground: 'border' });
  return [left + gap + liveBadge, rule];
}

function toolRow(context, { thread, name, detail, result }) {
  const chevron = subtle(context, glyph(context, 'collapsed'));
  return `${thread} ${chevron} ${paint(context, name.padEnd(6), { bold: true })} ${muted(context, detail)}  ${result}`;
}

function renderConversation(context) {
  const thread = paint(context, glyph(context, 'thread'), { foreground: tokens.profile.thinker });
  const ok = (text) => paint(context, glyph(context, 'success'), { foreground: 'kelp', bold: true }) + subtle(context, ` ${text}`);
  const caret = paint(context, glyph(context, 'prompt'), { foreground: gradientAt(context, 0), bold: true });
  return [
    `${caret} ${paint(context, 'Every weekday at 8am, brief me on my calendar and GitHub notifications', { bold: true })}`,
    '',
    `${profileBadge(context, 'thinker')} ${subtle(context, '· claude-code · 20:41:07')}`,
    `${thread} ${paint(context, '⠹ ', { foreground: 'lagoon' })}${paintGradient(context, 'Thinking…', { start: 0.3, end: 0.9 })}`,
    `${thread} ${paint(context, 'Checking available skills first, then writing the schedule config.', { italic: true, foreground: 'muted' })}`,
    toolRow(context, { thread, name: 'skill', detail: 'github-digest, calendar', result: ok('loaded') }),
    toolRow(context, { thread, name: 'Bash', detail: 'gh api notifications', result: ok('0.8s') }),
    toolRow(context, { thread, name: 'Write', detail: '~/.miniclaw/tasks/daily-brief.toml', result: ok('14 lines') }),
    `${thread}`,
    `${thread} ${paint(context, glyph(context, 'success'), { foreground: 'kelp', bold: true })} Created schedule ${paint(context, 'daily-brief', { bold: true })}`,
    `${thread}   ${subtle(context, 'cron 0 8 * * 1-5 · next run tomorrow 08:00')}`,
  ];
}

const RUNS = [
  { status: 'running', id: '#43', task: 'organize-downloads', profile: 'cheap', note: 'running 0:42', progress: 0.55 },
  { status: 'success', id: '#42', task: 'daily-brief', profile: 'thinker', note: '2 min ago · 1.2k tok · $0.03' },
  { status: 'error', id: '#41', task: 'ci-patrol', profile: 'coder', note: 'timed out (limit 10 min)' },
  { status: 'scheduled', id: '', task: 'weekly-report', profile: 'thinker', note: 'Fri 17:00' },
  { status: 'paused', id: '', task: 'scrape-prices', profile: 'operator', note: 'paused' },
];

function renderProgressBar(context, progress, cells = 8) {
  const filled = Math.round(progress * cells);
  return paint(context, glyph(context, 'progressFilled').repeat(filled), { foreground: tokens.semantic.running })
    + paint(context, glyph(context, 'progressEmpty').repeat(cells - filled), { foreground: 'border' });
}

function renderRunRow(context, run) {
  const hue = run.status === 'paused' ? 'muted' : tokens.semantic[run.status];
  const statusGlyph = paint(context, glyph(context, run.status), { foreground: hue, bold: true });
  const progress = run.progress === undefined ? '' : ` ${renderProgressBar(context, run.progress)}`;
  const noteStyle = run.status === 'error' ? { foreground: 'coral' } : { foreground: 'muted' };
  return `${statusGlyph} ${subtle(context, run.id.padEnd(4))} ${padDisplayEnd(run.task, 20)}${padDisplayEnd(profileBadge(context, run.profile), 12)}`
    + `${paint(context, run.note, noteStyle)}${progress}`;
}

function renderPermissionDialog(context, width) {
  const hue = tokens.semantic.permission;
  const key = (letter, label) => paint(context, ` ${letter} `, { background: hue, foreground: badgeInk(context), bold: true }) + ' ' + label;
  const rows = [
    `${profileBadge(context, 'operator')} ${paint(context, 'wants to control your computer', { bold: true })}`,
    muted(context, 'Open Numbers → import ~/Desktop/sales.csv → export PDF'),
    '',
    [key('y', 'allow once'), key('s', 'this session'), key('n', 'deny'), key('d', 'details')].join('   '),
  ];
  const title = paint(context, `${glyph(context, 'permission')} Approval needed`, { foreground: hue, bold: true });
  return renderBox(context, { width, rows, weight: 'heavy', title, borderColorAt: () => hue });
}

function renderInput(context, width) {
  const caret = paint(context, glyph(context, 'prompt'), { foreground: tokens.module.chat, bold: true });
  const cursor = paint(context, ' ', { background: tokens.module.chat });
  const rows = [`${caret} Sort my Downloads folder by file type${cursor}`];
  return renderBox(context, { width, rows, borderColorAt: () => tokens.module.chat });
}

function renderStatusBar(context, width) {
  const divider = subtle(context, ' │ ');
  const running = paint(context, `${glyph(context, 'running')} 1 running`, { foreground: 'lagoon' });
  const next = paint(context, glyph(context, 'scheduled'), { foreground: 'orchid' }) + ' daily-brief 08:00';
  const left = ` ${profileBadge(context, 'thinker', { isDefault: true })}${divider}${running}${divider}${next}`;
  const right = subtle(context, '⏎ send  ⌃K panel  ? help ');
  const gap = ' '.repeat(Math.max(width - displayWidth(left) - displayWidth(right), 1));
  return paint(context, left + gap, { background: 'surface' }) + paint(context, right, { background: 'surface' });
}

export function renderScreen(context) {
  const width = Math.min(context.width - 4, 96);
  const section = (title, hue) => ['', paint(context, title, { foreground: hue, bold: true })];
  return [
    '',
    ...renderTabBar(context, { width, active: 'chat' }),
    '',
    ...renderConversation(context),
    ...section('Tasks', tokens.module.tasks),
    ...RUNS.map((run) => renderRunRow(context, run)),
    '',
    ...renderPermissionDialog(context, Math.min(width, 64)),
    '',
    ...renderInput(context, width),
    renderStatusBar(context, width),
    '',
  ].map((line) => (line ? `  ${line}` : line));
}
