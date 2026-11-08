import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createServer, type ServerInstance } from '../server/server.js';
import { ApiClient } from '../cli/api-client.js';
import { type ServerEvent, type VfsChangeEvent } from '../server/events.js';

async function runPhase2Verification() {
  console.log('--- Starting Phase 2 Automated Verification ---');

  const tempDbPath = path.join(os.tmpdir(), `openchat_p2_${Date.now()}.db`);
  const testPort = 3456;
  const serverUrl = `http://127.0.0.1:${testPort}`;

  let serverInstance: ServerInstance | null = null;
  let clientA: ApiClient | null = null;
  let clientB: ApiClient | null = null;

  try {
    // 1. Start Server Daemon
    console.log(`1. Launching Fastify daemon on port ${testPort}...`);
    serverInstance = await createServer({ dbPath: tempDbPath, logger: false });
    const address = await serverInstance.start('127.0.0.1', testPort);
    console.log(`   ✓ Daemon listening at ${address}`);

    // 2. Connect Client A
    console.log('2. Connecting Client A via ApiClient...');
    clientA = new ApiClient(serverUrl);
    await clientA.init();
    const health = await clientA.healthCheck();

    if (!health.ok) {
      throw new Error('Client A health check failed');
    }

    console.log('   ✓ Client A connected (HTTP + WS)');

    // 3. Connect Client B
    console.log('3. Connecting Client B via ApiClient...');
    clientB = new ApiClient(serverUrl);
    await clientB.init();
    console.log('   ✓ Client B connected (HTTP + WS)');

    // 4. Set up Client B to listen for WebSocket live events
    console.log('4. Registering live event listener on Client B...');
    const receivedEvents: ServerEvent[] = [];
    clientB.onEvent((event) => {
      receivedEvents.push(event);
    });

    // 5. Client A creates a directory
    console.log('5. Client A creates directory /Work/RemoteTeam via HTTP POST...');
    const createdPath = await clientA.mkdir('/Work/RemoteTeam');

    if (createdPath !== '/Work/RemoteTeam') {
      throw new Error(`Unexpected created path: ${createdPath}`);
    }

    // Wait 100ms for WebSocket event propagation
    await new Promise((res) => setTimeout(res, 100));

    // Verify Client B received the event over WebSocket
    const vfsEvent = receivedEvents.find((e): e is VfsChangeEvent => e.type === 'vfs:change' && e.action === 'mkdir');

    if (!vfsEvent || vfsEvent.path !== '/Work/RemoteTeam') {
      throw new Error(`Client B did not receive expected vfs:change event. Got: ${JSON.stringify(receivedEvents)}`);
    }

    console.log('   ✓ Client B received real-time vfs:change WebSocket event from Client A action');

    // 6. Client B reads directory over HTTP
    console.log('6. Client B lists /Work over HTTP...');
    const workEntries = await clientB.ls('/Work');
    const workNames = workEntries.map((e) => e.name);
    console.log('   /Work entries seen by Client B:', workNames);

    if (!workNames.includes('RemoteTeam/')) {
      throw new Error('Client B cannot see directory created by Client A');
    }

    console.log('   ✓ Directory correctly synchronized across independent clients');

    // 7. Client A creates link, Client B reads chat
    console.log('7. Client A creates pointer in /Personal...');
    const ptrName = await clientA.ln('/welcome.dm', '/Personal');

    if (ptrName !== 'welcome.dm') {
      throw new Error(`Expected link name 'welcome.dm', got ${ptrName}`);
    }

    const catResult = await clientB.cat('/Personal/welcome.dm');

    if (catResult.messages.length !== 3) {
      throw new Error(`Expected 3 messages, got ${catResult.messages.length}`);
    }

    console.log('   ✓ Client B read chat history via HTTP cat endpoint');

    console.log('\n=== ALL PHASE 2 VERIFICATIONS PASSED ===\n');
  } finally {
    if (clientA) {
      clientA.close();
    }

    if (clientB) {
      clientB.close();
    }

    if (serverInstance) {
      await serverInstance.stop();
    }

    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }

    const wal = `${tempDbPath}-wal`;
    const shm = `${tempDbPath}-shm`;

    if (fs.existsSync(wal)) {
      fs.unlinkSync(wal);
    }

    if (fs.existsSync(shm)) {
      fs.unlinkSync(shm);
    }
  }
}

runPhase2Verification();
