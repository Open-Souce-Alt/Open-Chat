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

async function runPhase3Verification() {
  console.log('--- Starting Phase 3 Automated Verification ---');

  const tempDbPath = path.join(os.tmpdir(), `openchat_p3_${Date.now()}.db`);
  const testPort = 3457;
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

    // 4. Initiate WhatsApp connection with mock mode
    console.log('3. Initiating connectAuth for whatsapp (personal) with mock adapter...');
    const connectRes = await client.connectAuth('whatsapp', 'personal', true);

    if (connectRes.accountId !== 'acc_whatsapp_personal') {
      throw new Error(`Unexpected accountId: ${connectRes.accountId}`);
    }

    // Wait 2 seconds for mock QR, auth transition, and discovery sync to complete
    console.log('4. Awaiting QR challenge, authentication, and discovery sync events...');
    await new Promise((res) => setTimeout(res, 2000));

    // Verify QR challenge received
    const qrEvent = receivedEvents.find((e): e is AuthChallengeEvent => e.type === 'auth:challenge');

    if (!qrEvent || qrEvent.challenge.challengeType !== 'qr_code') {
      throw new Error('Did not receive qr_code challenge event');
    }

    console.log('   ✓ Received auth:challenge event (QR code data present)');

    // Verify auth status authenticated
    const authEvent = receivedEvents.find((e): e is AuthStatusEvent => e.type === 'auth:status' && e.status === 'authenticated');

    if (!authEvent) {
      throw new Error('Did not receive auth:status authenticated event');
    }

    console.log('   ✓ Received auth:status authenticated event');

    // Verify sync complete event
    const syncEvent = receivedEvents.find((e): e is SyncCompleteEvent => e.type === 'sync:complete');

    if (!syncEvent || syncEvent.chatCount !== 5) {
      throw new Error(`Expected sync:complete with 5 chats, got: ${JSON.stringify(syncEvent)}`);
    }

    console.log(`   ✓ Discovery sync completed (${syncEvent.chatCount} chats, ${syncEvent.messageCount} messages)`);

    // 5. Verify Virtual Filesystem representation
    console.log('5. Verifying system archive directory in VFS...');
    const rootVisible = await client.ls('/');
    const rootVisibleNames = rootVisible.map((e) => e.name);

    if (rootVisibleNames.includes('.whatsapp-personal/')) {
      throw new Error('.whatsapp-personal should be hidden from default ls');
    }

    console.log('   ✓ System root .whatsapp-personal/ is properly hidden from default ls');

    const rootAll = await client.ls('/', { all: true });
    const rootAllNames = rootAll.map((e) => e.name);

    if (!rootAllNames.includes('.whatsapp-personal/')) {
      throw new Error('.whatsapp-personal/ missing from ls -a');
    }

    console.log('   ✓ ls -a reveals .whatsapp-personal/ [system archive]');

    // 6. List system archive contents
    console.log('6. Inspecting chats inside /.whatsapp-personal...');
    const archiveEntries = await client.ls('/.whatsapp-personal');
    const archiveNames = archiveEntries.map((e) => e.name);
    console.log('   Archive entries:', archiveNames);

    if (
      !archiveNames.includes('alice-smith.dm') ||
      !archiveNames.includes('bob-jones.dm') ||
      !archiveNames.includes('project-alpha-team.group') ||
      !archiveNames.includes('family-group.group') ||
      !archiveNames.includes('open-source-digest.channel')
    ) {
      throw new Error('Missing expected chats in /.whatsapp-personal');
    }

    const aliceEntry = archiveEntries.find((e) => e.name === 'alice-smith.dm');

    if (!aliceEntry || aliceEntry.platform !== 'whatsapp') {
      throw new Error(`Expected alice-smith.dm platform to be 'whatsapp', got: ${aliceEntry?.platform}`);
    }

    console.log("   ✓ All chats discovered with proper extensions and platform ('whatsapp')");

    // 7. Verify cat reads synced message history
    console.log('7. Reading message history for alice-smith.dm...');
    const catResult = await client.cat('/.whatsapp-personal/alice-smith.dm');

    if (catResult.messages.length !== 4) {
      throw new Error(`Expected 4 messages for Alice Smith, got ${catResult.messages.length}`);
    }

    console.log(`   ✓ Read ${catResult.messages.length} messages from Alice Smith:`);

    for (const msg of catResult.messages) {
      console.log(`     [${msg.senderName}]: ${msg.text}`);
    }

    // 8. Verify linking into custom user folder
    console.log('8. Linking Alice into /Personal...');
    const linked = await client.ln('/.whatsapp-personal/alice-smith.dm', '/Personal');

    if (linked !== 'alice-smith.dm') {
      throw new Error(`Expected linked name alice-smith.dm, got ${linked}`);
    }

    const personalEntries = await client.ls('/Personal');

    if (!personalEntries.some((e) => e.name === 'alice-smith.dm')) {
      throw new Error('alice-smith.dm not found in /Personal');
    }

    console.log('   ✓ Chat pointer successfully linked into /Personal folder');

    // 9. Verify external read receipt sync (mobile app read)
    console.log('9. Verifying external read receipt from mobile app...');
    // SAFETY: serverInstance.authManager maintains internal activeAdapters map
    const activeAdapter = (serverInstance.authManager as any).activeAdapters.get('acc_whatsapp_personal');

    if (activeAdapter?.simulateChatRead) {
      activeAdapter.simulateChatRead('12036301@c.us');
      const updatedEntries = await client.ls('/.whatsapp-personal');
      const alice = updatedEntries.find((e) => e.name === 'alice-smith.dm');

      if (alice && alice.unreadCount !== 0) {
        throw new Error(`Expected Alice unread count 0 after mobile read, got ${alice.unreadCount}`);
      }

      console.log('   ✓ External read receipt from mobile app synced unread count to 0 in SQLite');
    }

    console.log('\n=== ALL PHASE 3 VERIFICATIONS PASSED ===\n');
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

runPhase3Verification();
