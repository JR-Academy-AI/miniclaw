import { expect, it } from 'vitest';
import { parseArguments } from './arguments.js';

it('parses explicit engine and workspace options without shell expansion', () => {
  expect(parseArguments(['--engine', 'claude', '--demo', '--model', 'test', '--claude-path', '/a b/claude', '/tmp/work']))
    .toEqual({ engine: 'claude', demo: true, doctor: false, help: false, model: 'test', executablePath: '/a b/claude', directory: '/tmp/work' });
});
it('defaults to Codex and preserves an authentication-free demo option', () => {
  expect(parseArguments([]).engine).toBe('codex');
  expect(parseArguments(['--demo'])).toMatchObject({ engine: 'codex', demo: true });
  expect(parseArguments(['--codex-path', '/a b/codex']).executablePath).toBe('/a b/codex');
});
it('rejects unsupported engines and mismatched executable flags', () => {
  expect(() => parseArguments(['--engine', 'other'])).toThrow('codex or claude');
  expect(() => parseArguments(['--engine'])).toThrow('requires a value');
  expect(() => parseArguments(['--claude-path', '/bin/claude'])).toThrow('does not match');
  expect(() => parseArguments(['--engine', 'claude', '--codex-path', '/bin/codex'])).toThrow('does not match');
});
it('rejects ambiguous and missing arguments', () => {
  expect(() => parseArguments(['--model'])).toThrow('requires a value');
  expect(() => parseArguments(['one', 'two'])).toThrow('only one');
  expect(() => parseArguments(['--wat'])).toThrow('Unknown');
  expect(parseArguments(['--', '-folder']).directory).toBe('-folder');
});
