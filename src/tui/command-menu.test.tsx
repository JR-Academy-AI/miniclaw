import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandMenu, matchingCommands } from './command-menu.js';
import { createTheme, ThemeProvider } from './theme/index.js';

afterEach(cleanup);

describe('slash command menu', () => {
  it('opens for slash and filters as the command is typed', () => {
    expect(matchingCommands('/').map((command) => command.name)).toEqual(['/help', '/clear', '/exit']);
    expect(matchingCommands('/c').map((command) => command.name)).toEqual(['/clear']);
    expect(matchingCommands('hello')).toEqual([]);
  });

  it('renders a selected command with keyboard help', () => {
    const theme = createTheme({ env: { NO_COLOR: '1', MINICLAW_ASCII: '1' }, isTTY: false });
    const screen = render(<ThemeProvider theme={theme}>
      <CommandMenu commands={matchingCommands('/')} selected={1} />
    </ThemeProvider>);
    expect(screen.lastFrame()).toContain('> /clear');
    expect(screen.lastFrame()).toContain('enter run');
  });
});
