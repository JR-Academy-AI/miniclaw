// Placeholder content for the preview. In the real TUI these come from miniclaw core
// (runtime adapters, profile store, skill registry, scheduler, permission checks).
import { tokens, paint, glyph } from './ansi.mjs';

const separator = (context) => paint(context, ' · ', { foreground: 'subtle' });

function statusGlyph(context, semanticName, glyphName = semanticName) {
  return paint(context, glyph(context, glyphName), { foreground: tokens.semantic[semanticName], bold: true });
}

export function profileBadge(context, profileName, { isDefault = false } = {}) {
  const dot = paint(context, glyph(context, 'running'), { foreground: tokens.profile[profileName] });
  const star = isDefault ? paint(context, ` ${glyph(context, 'default')}`, { foreground: 'sun' }) : '';
  return `${dot} ${paint(context, profileName, { bold: isDefault })}${star}`;
}

const CHECKS = [
  {
    label: 'runtime',
    render: (context) => ['claude-code', 'codex']
      .map((name) => `${statusGlyph(context, 'success')} ${name}`).join('   '),
  },
  {
    label: 'profiles',
    render: (context) => [
      profileBadge(context, 'thinker', { isDefault: true }),
      profileBadge(context, 'coder'),
      profileBadge(context, 'operator'),
      profileBadge(context, 'cheap'),
    ].join('  '),
  },
  {
    label: 'skills',
    render: (context) => `${statusGlyph(context, 'success')} ${paint(context, '12', { bold: true })} loaded`
      + separator(context) + paint(context, '2 disabled', { foreground: 'muted' }),
  },
  {
    label: 'schedule',
    render: (context) => `${statusGlyph(context, 'scheduled')} ${paint(context, 'daily-brief', { bold: true })} tomorrow 08:00`
      + separator(context) + paint(context, '3 total', { foreground: 'muted' }),
  },
  {
    label: 'computer',
    render: (context) => `${statusGlyph(context, 'permission')} `
      + paint(context, 'grant Accessibility', { foreground: tokens.semantic.permission })
      + paint(context, ' → run ', { foreground: 'muted' })
      + paint(context, '/doctor', { foreground: 'lagoon', bold: true }),
  },
];

export const SAMPLE_STATUS = {
  version: 'v0.1.0-dev',
  tagline: 'a lightweight OpenClaw for your terminal',
  placeholder: 'Try "brief me every weekday at 8am"',
  keyHints: [['⏎', 'send'], ['/', 'cmd'], ['⌃K', 'panel'], ['?', 'help'], ['⌃C', 'quit']],
  checks: CHECKS,
};
