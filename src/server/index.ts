import { createServer } from './server.js';

async function main() {
  const host = process.env.OPENCHAT_HOST || '127.0.0.1';
  const port = parseInt(process.env.OPENCHAT_PORT || '3000', 10);

  const server = await createServer({ logger: false });

  try {
    const address = await server.start(host, port);
    console.log(`\n======================================================`);
    console.log(`       Open Chat Core Engine Daemon (Phase 2)`);
    console.log(`======================================================`);
    console.log(`  HTTP REST API:       ${address}`);
    console.log(`  WebSocket Gateway:   ws://${host}:${port}/ws`);
    console.log(`  Database:            ~/.openchat/openchat.db`);
    console.log(`======================================================`);
    console.log(`[Daemon] Ready for incoming client connections.`);
    console.log(`[Daemon] Press Ctrl+C to terminate.\n`);

    const shutdown = async () => {
      console.log('\n[Daemon] Shutting down gracefully...');
      await server.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Daemon] Failed to start server:`, message);
    process.exit(1);
  }
}

main();
