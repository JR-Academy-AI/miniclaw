import { Box, Text } from 'ink';
import { COPY } from './copy.js';
import { useTheme } from './theme/index.js';

export interface SlashCommand {
  readonly name: string;
  readonly description: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = COPY.help.lines.map(([name, description]) => ({ name, description }));

export function matchingCommands(text: string): readonly SlashCommand[] {
  if (!text.startsWith('/') || text.includes(' ')) return [];
  const query = text.toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(query));
}

export function CommandMenu({ commands, selected }: {
  readonly commands: readonly SlashCommand[];
  readonly selected: number;
}) {
  const theme = useTheme();
  if (commands.length === 0) return null;
  return <Box flexDirection="column" borderStyle={theme.border('rounded')} borderColor={theme.module('chat')} paddingX={1}>
    {commands.map((command, index) => <Text key={command.name}
      color={index === selected ? theme.module('chat') : undefined}
      bold={index === selected && theme.depth !== 'none'}>
      {index === selected ? theme.glyph('prompt') : ' '} {command.name.padEnd(8)} <Text color={theme.color('muted')}>{command.description}</Text>
    </Text>)}
    <Text color={theme.color('subtle')}>↑/↓ select · enter run · esc close</Text>
  </Box>;
}
