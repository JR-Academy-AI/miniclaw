#!/usr/bin/env node
import { parseArguments, CLI_HELP } from './arguments.js';

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) { process.stdout.write(CLI_HELP); return; }
  if (options.doctor) {
    const { selectEngine } = await import('./engines.js');
    const engine = selectEngine(options);
    const report = await engine.detect({ executablePath: engine.executablePath });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ready) process.exitCode = 1;
    return;
  }
  const { startInteractive } = await import('./bootstrap.js');
  await startInteractive(options);
}

main().catch(error => {
  process.stderr.write(`miniclaw: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
