import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { initDatabase } from '../core/db/database.js';
import { VirtualFileSystem } from '../core/vfs/vfs.js';

function runVerification() {
  console.log('--- Starting Slice 1 Automated Verification ---');
  const tempDbPath = path.join(os.tmpdir(), `openchat_test_${Date.now()}.db`);

  try {
    // 1. Initialize DB and VFS
    console.log('1. Initializing SQLite DB...');
    const db = initDatabase(tempDbPath);
    const vfs = new VirtualFileSystem(db);
    console.log('   ✓ DB initialized and seeded at', tempDbPath);

    // 2. Verify seeded directories
    console.log('2. Verifying initial seed at root /...');
    const rootEntries = vfs.ls();
    const names = rootEntries.map((e) => e.name);
    console.log('   Root entries:', names);

    if (!names.includes('Personal/') || !names.includes('Work/') || !names.includes('welcome.dm')) {
      throw new Error('Missing seeded items in root directory');
    }

    console.log('   ✓ Root contains Personal/, Work/, welcome.dm');

    // 3. Verify reading chat
    console.log('3. Reading welcome.dm...');
    const welcome = vfs.cat('welcome.dm');

    if (welcome.messages.length !== 3) {
      throw new Error(`Expected 3 welcome messages, got ${welcome.messages.length}`);
    }

    console.log('   ✓ Read 3 welcome messages successfully');

    // 4. Test directory navigation and creation
    console.log('4. Testing mkdir and cd...');
    vfs.mkdir('/Work/Projects');
    vfs.mkdir('/Work/Q3/Clients', { recursive: true });
    vfs.cd('/Work/Projects');

    if (vfs.getCwd() !== '/Work/Projects') {
      throw new Error(`Expected cwd /Work/Projects, got ${vfs.getCwd()}`);
    }

    vfs.cd('..');

    if (vfs.getCwd() !== '/Work') {
      throw new Error(`Expected cwd /Work, got ${vfs.getCwd()}`);
    }

    console.log('   ✓ mkdir and cd work correctly');

    // 5. Test symlink pointer creation and collision resolution
    console.log('5. Testing ln -s and collision resolution...');
    const link1 = vfs.ln('/welcome.dm', '/Personal');

    if (link1 !== 'welcome.dm') {
      throw new Error(`Expected link name 'welcome.dm', got '${link1}'`);
    }

    const link2 = vfs.ln('/welcome.dm', '/Personal');

    if (link2 !== 'welcome-2.dm') {
      throw new Error(`Expected collision resolution 'welcome-2.dm', got '${link2}'`);
    }

    const personalEntries = vfs.ls('/Personal').map((e) => e.name);
    console.log('   /Personal entries:', personalEntries);

    if (!personalEntries.includes('welcome.dm') || !personalEntries.includes('welcome-2.dm')) {
      throw new Error('Pointers missing in /Personal');
    }

    console.log('   ✓ Pointer created and collision auto-suffixed (-2)');

    // 6. Test pointer deletion (rm) preserves canonical chat
    console.log('6. Testing rm pointer...');
    vfs.rm('/Personal/welcome-2.dm');
    const personalAfterRm = vfs.ls('/Personal').map((e) => e.name);

    if (personalAfterRm.includes('welcome-2.dm')) {
      throw new Error('Pointer welcome-2.dm was not deleted');
    }

    // Verify source chat in root still exists
    vfs.cat('/welcome.dm');
    console.log('   ✓ rm deleted pointer; canonical chat still accessible in root');

    // 7. Test directory copy (cp -r) and move (mv)
    console.log('7. Testing cp -r and mv on directories...');
    vfs.cp('/Work', '/Work-Backup', { recursive: true });
    const rootAfterCp = vfs.ls('/').map((e) => e.name);

    if (!rootAfterCp.includes('Work-Backup/')) {
      throw new Error('Directory Work-Backup was not cloned');
    }

    vfs.mv('/Work-Backup', '/Work-Archived');
    const rootAfterMv = vfs.ls('/').map((e) => e.name);

    if (rootAfterMv.includes('Work-Backup/') || !rootAfterMv.includes('Work-Archived/')) {
      throw new Error('mv failed to rename directory');
    }

    console.log('   ✓ cp -r cloned directory tree and mv renamed successfully');

    // 8. Test persistence: close DB, open new connection
    console.log('8. Testing persistence across DB re-open...');
    db.close();
    const db2 = initDatabase(tempDbPath);
    const vfs2 = new VirtualFileSystem(db2);
    const persistedRoot = vfs2.ls('/').map((e) => e.name);
    console.log('   Persisted root entries:', persistedRoot);

    if (!persistedRoot.includes('Work-Archived/') || !persistedRoot.includes('Personal/')) {
      throw new Error('Data failed to persist across DB re-open');
    }

    const persistedPersonal = vfs2.ls('/Personal').map((e) => e.name);

    if (!persistedPersonal.includes('welcome.dm')) {
      throw new Error('Pointers failed to persist across DB re-open');
    }

    db2.close();
    console.log('   ✓ All state persisted reliably in SQLite');

    console.log('\n=== ALL SLICE 1 VERIFICATIONS PASSED ===\n');
  } finally {
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }

    const walPath = `${tempDbPath}-wal`;
    const shmPath = `${tempDbPath}-shm`;

    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }

    if (fs.existsSync(shmPath)) {
      fs.unlinkSync(shmPath);
    }
  }
}

runVerification();
