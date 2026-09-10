#!/usr/bin/env node
// miniclaw design preview — zero-dependency, renders the design system in your real terminal.
//
//   node design/preview/index.mjs [welcome|palette|screen] [--static] [--light|--dark]
//                                 [--depth truecolor|256|16|none] [--width N] [--ascii]
//
// This is a design prototype, not the TUI implementation; it does not pick a TUI framework.
import { tokens, createContext } from './ansi.mjs';
import { composeWelcomeFrame } from './welcome.mjs';
import { renderPalette, renderScreen } from './showcase.mjs';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_TO_LINE_END = '\x1b[K';
const CONTROL_C = '\u0003';

function parseArguments(argv) {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const overrides = {};
  if (argv.includes('--light')) overrides.theme = 'light';
  if (argv.includes('--dark')) overrides.theme = 'dark';
  if (argv.includes('--ascii')) overrides.ascii = true;
  if (valueAfter('--depth')) overrides.depth = valueAfter('--depth');
  if (valueAfter('--width')) overrides.width = Number(valueAfter('--width'));
  const flagValues = new Set([valueAfter('--depth'), valueAfter('--width')]);
  const mode = argv.find((argument) => !argument.startsWith('--') && !flagValues.has(argument)) ?? 'welcome';
  return { mode, overrides, isStatic: argv.includes('--static') };
}

// Honors the spec's motion rules: no animation when piped, in CI, or with reduced motion.
function shouldAnimate(isStatic) {
  if (isStatic || !process.stdout.isTTY) return false;
  return !process.env.CI && process.env.MINICLAW_REDUCED_MOTION !== '1';
}

// Any key skips straight to the final frame — the welcome must never block input.
function listenForSkip() {
  const state = { pressed: false, stop: () => {} };
  if (!process.stdin.isTTY) return state;
  const onData = (key) => {
    if (key.toString() === CONTROL_C) {
      process.stdout.write(SHOW_CURSOR);
      process.exit(130);
    }
    state.pressed = true;
  };
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', onData);
  state.stop = () => {
    process.stdin.off('data', onData);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  };
  return state;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function playAnimation(context, composeFrame) {
  const totalMs = tokens.motion.welcome.maxTotalMs;
  const skip = listenForSkip();
  const startedAt = Date.now();
  let previousHeight = 0;
  process.stdout.write(HIDE_CURSOR);
  while (true) {
    const elapsed = skip.pressed ? Infinity : Date.now() - startedAt;
    const lines = composeFrame(context, elapsed);
    if (previousHeight > 0) process.stdout.write(`\x1b[${previousHeight}F`);
    process.stdout.write(lines.map((line) => line + CLEAR_TO_LINE_END).join('\n') + '\n');
    previousHeight = lines.length;
    if (elapsed >= totalMs) break;
    await sleep(tokens.motion.frameIntervalMs);
  }
  skip.stop();
  process.stdout.write(SHOW_CURSOR);
}

async function main() {
  const { mode, overrides, isStatic } = parseArguments(process.argv.slice(2));
  const context = createContext(overrides);
  if (mode === 'palette') return console.log(renderPalette(context).join('\n'));
  if (mode === 'screen') return console.log(renderScreen(context).join('\n'));
  if (mode !== 'welcome') throw new Error(`Unknown mode "${mode}". Use welcome, palette or screen.`);
  if (shouldAnimate(isStatic)) return playAnimation(context, composeWelcomeFrame);
  console.log(composeWelcomeFrame(context, Infinity).join('\n'));
}

main();
