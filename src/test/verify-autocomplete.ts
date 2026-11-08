import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createServer, type ServerInstance } from '../server/server.js';
import { ApiClient } from '../cli/api-client.js';

// Re-use logic for direct test
function createCompleter(client: ApiClient) {
  const COMMANDS = ['ls', 'cd', 'pwd', 'mkdir', 'rmdir', 'cat', 'ln', 'rm', 'mv', 'cp', 'connect', 'status', 'clear', 'help', 'exit', 'quit'];

  return (line: string): Promise<[string[], string]> => {
    return new Promise((resolve) => {
      const parts = line.split(' ');

      if (parts.length === 1) {
        const prefix = parts[0]!;
        const hits = COMMANDS.filter((cmd) => cmd.startsWith(prefix));

        return resolve([hits.length ? hits : COMMANDS, prefix]);
      }

      const cmd = parts[0]?.toLowerCase();
      const lastArg = parts[parts.length - 1]!;
      const lastSlash = lastArg.lastIndexOf('/');
      const dirPart = lastSlash >= 0 ? lastArg.slice(0, lastSlash + 1) : '';
      const filePrefix = lastSlash >= 0 ? lastArg.slice(lastSlash + 1) : lastArg;
      const queryPath = dirPart || undefined;

      client
        .ls(queryPath, { all: true })
        .then((entries) => {
          let candidateNames = entries.map((e) => e.name);

          if (cmd === 'cd' || cmd === 'rmdir') {
            candidateNames = candidateNames.filter((name) => name.endsWith('/'));
          } else if (cmd === 'cat') {
            candidateNames = candidateNames.filter((name) => !name.endsWith('/'));
          }

          if (!filePrefix.startsWith('.')) {
            candidateNames = candidateNames.filter((name) => !name.startsWith('.'));
          }

          const matches = candidateNames
            .filter((name) => name.startsWith(filePrefix))
            .map((name) => dirPart + name);

          resolve([matches, lastArg]);
        })
        .catch(() => resolve([[], lastArg]));
    });
  };
}

async function runAutocompleteVerification() {
  console.log('--- Starting Autocomplete Verification ---');

  const tempDbPath = path.join(os.tmpdir(), `openchat_auto_${Date.now()}.db`);
  const testPort = 3458;
  const serverUrl = `http://127.0.0.1:${testPort}`;

  let serverInstance: ServerInstance | null = null;
  let client: ApiClient | null = null;

  try {
    serverInstance = await createServer({ dbPath: tempDbPath, logger: false });
    await serverInstance.start('127.0.0.1', testPort);

    client = new ApiClient(serverUrl);
    await client.init();

    const completer = createCompleter(client);

    // 1. Test command completion
    console.log("1. Testing 'c' command autocompletion...");
    const [cmdMatches] = await completer('c');
    console.log('   Matches for c:', cmdMatches);

    if (!cmdMatches.includes('cd') || !cmdMatches.includes('cat') || !cmdMatches.includes('connect')) {
      throw new Error("Failed to autocomplete commands starting with 'c'");
    }

    console.log('   ✓ Command names autocomplete correctly');

    // 2. Test directory completion for cd
    console.log("2. Testing 'cd Pers' autocompletion...");
    const [cdMatches, cdToken] = await completer('cd Pers');
    console.log('   Matches for cd Pers:', cdMatches);

    if (cdMatches.length !== 1 || cdMatches[0] !== 'Personal/') {
      throw new Error(`Expected ['Personal/'], got ${JSON.stringify(cdMatches)}`);
    }

    if (cdToken !== 'Pers') {
      throw new Error(`Expected token 'Pers', got '${cdToken}'`);
    }

    console.log("   ✓ 'cd Pers' autocompletes to 'Personal/'");

    // 3. Test absolute path completion
    console.log("3. Testing 'cd /W' autocompletion...");
    const [absMatches] = await completer('cd /W');
    console.log('   Matches for cd /W:', absMatches);

    if (absMatches.length !== 1 || absMatches[0] !== '/Work/') {
      throw new Error(`Expected ['/Work/'], got ${JSON.stringify(absMatches)}`);
    }

    console.log("   ✓ 'cd /W' autocompletes to '/Work/'");

    // 4. Test file-only completion for cat
    console.log("4. Testing 'cat wel' autocompletion...");
    const [catMatches] = await completer('cat wel');
    console.log('   Matches for cat wel:', catMatches);

    if (catMatches.length !== 1 || catMatches[0] !== 'welcome.dm') {
      throw new Error(`Expected ['welcome.dm'], got ${JSON.stringify(catMatches)}`);
    }

    const [catDirMatches] = await completer('cat Pers');

    if (catDirMatches.length !== 0) {
      throw new Error('cat should not autocomplete directories');
    }

    console.log("   ✓ 'cat' autocompletes chat files only and filters out directories");

    console.log('\n=== ALL AUTOCOMPLETE VERIFICATIONS PASSED ===\n');
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

runAutocompleteVerification();
