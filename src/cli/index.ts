import { ApiClient } from './api-client.js';
import { startRepl } from './repl.js';

export async function runCli(): Promise<void> {
  const serverUrl = process.env.OPENCHAT_SERVER_URL || 'http://127.0.0.1:3000';
  const client = new ApiClient(serverUrl);

  try {
    await client.init();
    startRepl(client);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31m[Error] ${message}\x1b[0m`);
    console.error(`\x1b[33mTip: Start the Open Chat daemon first with:\x1b[0m`);
    console.error(`     \x1b[1mnpm run daemon\x1b[0m\n`);
    process.exit(1);
  }
}

// Auto-run if executed directly
runCli();
