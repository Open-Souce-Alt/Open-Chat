import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createServer, type ServerInstance } from '../server/server.js';
import { ApiClient } from '../ui/cli/api-client.js';
import {
  type ServerEvent,
  type AuthChallengeEvent,
  type AuthStatusEvent,
  type SyncCompleteEvent,
} from '../server/events.js';

async function runInstagramVerification() {
  console.log('--- Starting Instagram Integration Verification ---');

  const tempDbPath = path.join(os.tmpdir(), `openchat_ig_${Date.now()}.db`);
  const testPort = 3459;
  const serverUrl = `http://127.0.0.1:${testPort}`;

  let serverInstance: ServerInstance | null = null;
  let client: ApiClient | null = null;

  try {
    // 1. Launch daemon
    console.log(`1. Launching Fastify daemon on port ${testPort}...`);
    serverInstance = await createServer({ dbPath: tempDbPath, logger: false });
    await serverInstance.start('127.0.0.1', testPort);
    console.log(`   ✓ Daemon listening at ${serverUrl}`);

    // 2. Connect Client
    console.log('2. Connecting ApiClient...');
    client = new ApiClient(serverUrl);
    await client.init();
    console.log('   ✓ Client connected (HTTP + WS)');

    // 3. Track events
    const receivedEvents: ServerEvent[] = [];
    client.onEvent((event) => {
      receivedEvents.push(event);
    });

    // 4. Initiate Instagram connection with mock adapter
    console.log('3. Initiating connectAuth for instagram (personal) with mock adapter...');
    const connectRes = await client.connectAuth('instagram', 'personal', true);

    if (connectRes.accountId !== 'acc_instagram_personal') {
      throw new Error(`Unexpected accountId: ${connectRes.accountId}`);
    }

    // Wait 1.5 seconds for challenge, auth transition, and discovery sync events
    console.log('4. Awaiting OTP challenge, authentication, and discovery sync events...');
    await new Promise((res) => setTimeout(res, 1500));

    // Verify OTP challenge received
    const otpEvent = receivedEvents.find((e): e is AuthChallengeEvent => e.type === 'auth:challenge');

    if (!otpEvent || otpEvent.challenge.challengeType !== 'otp_input') {
      throw new Error('Did not receive otp_input challenge event for Instagram');
    }

    console.log('   ✓ Received auth:challenge event (type: otp_input)');

    // Verify auth status authenticated
    const authEvent = receivedEvents.find((e): e is AuthStatusEvent => e.type === 'auth:status' && e.status === 'authenticated');

    if (!authEvent) {
      throw new Error('Did not receive auth:status authenticated event for Instagram');
    }

    console.log('   ✓ Received auth:status authenticated event for Instagram');

    // Verify sync complete event
    const syncEvent = receivedEvents.find((e): e is SyncCompleteEvent => e.type === 'sync:complete' && e.accountId === 'acc_instagram_personal');

    if (!syncEvent || syncEvent.chatCount !== 4) {
      throw new Error(`Expected sync:complete with 4 Instagram chats, got: ${JSON.stringify(syncEvent)}`);
    }

    console.log(`   ✓ Discovery sync completed (${syncEvent.chatCount} chats, ${syncEvent.messageCount} messages)`);

    // 5. Verify Virtual Filesystem representation
    console.log('5. Verifying Instagram system archive directory in VFS...');
    const rootVisible = await client.ls('/');
    const rootVisibleNames = rootVisible.map((e) => e.name);

    if (rootVisibleNames.includes('.instagram-personal/')) {
      throw new Error('.instagram-personal/ should be hidden from default ls');
    }

    console.log('   ✓ System root .instagram-personal/ is properly hidden from default ls');

    const rootAll = await client.ls('/', { all: true });
    const rootAllNames = rootAll.map((e) => e.name);

    if (!rootAllNames.includes('.instagram-personal/')) {
      throw new Error('.instagram-personal/ missing from ls -a');
    }

    console.log('   ✓ ls -a reveals .instagram-personal/ [system archive]');

    // 6. Inspect chats inside /.instagram-personal
    console.log('6. Inspecting chats inside /.instagram-personal...');
    const archiveEntries = await client.ls('/.instagram-personal');
    const archiveNames = archiveEntries.map((e) => e.name);
    console.log('   Archive entries:', archiveNames);

    if (
      !archiveNames.includes('elena-rostova.dm') ||
      !archiveNames.includes('marcus-vance.dm') ||
      !archiveNames.includes('street-photography-collective.group') ||
      !archiveNames.includes('design-critique-hub.group')
    ) {
      throw new Error('Missing expected chats in /.instagram-personal');
    }

    const elenaEntry = archiveEntries.find((e) => e.name === 'elena-rostova.dm');

    if (!elenaEntry || elenaEntry.platform !== 'instagram') {
      throw new Error(`Expected elena-rostova.dm platform to be 'instagram', got: ${elenaEntry?.platform}`);
    }

    console.log("   ✓ All chats discovered with proper extensions and platform ('instagram')");

    // 7. Verify cat reads synced Instagram message history
    console.log('7. Reading message history for elena-rostova.dm...');
    const catResult = await client.cat('/.instagram-personal/elena-rostova.dm');

    if (catResult.messages.length !== 3) {
      throw new Error(`Expected 3 messages for Elena Rostova, got ${catResult.messages.length}`);
    }

    console.log(`   ✓ Read ${catResult.messages.length} messages from Elena Rostova:`);

    for (const msg of catResult.messages) {
      console.log(`     [${msg.senderName}]: ${msg.text}`);
    }

    // 8. Test heterogeneous cross-platform workspace mixing
    console.log('8. Testing cross-platform folder mixing (linking Instagram chat into /Work)...');
    const linked = await client.ln('/.instagram-personal/elena-rostova.dm', '/Work');

    if (linked !== 'elena-rostova.dm') {
      throw new Error(`Expected linked name elena-rostova.dm, got ${linked}`);
    }

    const workEntries = await client.ls('/Work');
    const linkedElena = workEntries.find((e) => e.name === 'elena-rostova.dm');

    if (!linkedElena || linkedElena.platform !== 'instagram') {
      throw new Error('Failed to find linked Instagram chat in /Work with correct platform badge');
    }

    console.log('   ✓ Heterogeneous workspace verified: Instagram chat successfully linked alongside other workspaces');

    console.log('\n=== ALL INSTAGRAM VERIFICATIONS PASSED ===\n');
  } finally {
    if (client) {
      client.close();
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

runInstagramVerification();
