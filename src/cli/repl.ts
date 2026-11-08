import * as readline from 'readline';
import qrcode from 'qrcode-terminal';
import { type ApiClient } from './api-client.js';
import { type VfsEntry } from '../core/vfs/vfs.js';

// ANSI color helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function formatDate(timestamp?: number): string {
  if (!timestamp || timestamp <= 0) {
    return '-';
  }

  const d = new Date(timestamp);
  const now = new Date();

  const isSameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (isSameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const isSameYear = d.getFullYear() === now.getFullYear();

  if (isSameYear) {
    const month = d.toLocaleDateString([], { month: 'short' });
    const day = String(d.getDate()).padStart(2, ' ');
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return `${month} ${day} ${time}`;
  }

  const month = d.toLocaleDateString([], { month: 'short' });
  const day = String(d.getDate()).padStart(2, ' ');

  return `${month} ${day}  ${d.getFullYear()}`;
}

function formatEntry(entry: VfsEntry, isLong: boolean): string {
  const unreadBadge = entry.unreadCount > 0 ? ` ${colors.yellow}(${entry.unreadCount} unread)${colors.reset}` : '';

  if (entry.type === 'directory') {
    const icon = colors.blue + colors.bold + entry.name + colors.reset;

    if (!isLong) {
      return icon + unreadBadge;
    }

    const typeLabel = entry.isSystemRoot ? '[system archive]' : '[directory]';
    const dateStr = formatDate(entry.updatedAt).padStart(14, ' ');

    return `${colors.dim}drwxr-xr-x${colors.reset}  ${icon.padEnd(30)} ${colors.dim}${typeLabel.padEnd(18)} ${dateStr}${colors.reset}${unreadBadge}`;
  } else {
    const icon = colors.green + entry.name + colors.reset;

    if (!isLong) {
      return icon + unreadBadge;
    }

    const typeLabel = entry.platform
      ? `[${entry.platform}/${entry.chatType ?? 'chat'}]`
      : `[${entry.chatType ?? 'chat'}]`;

    const dateStr = formatDate(entry.updatedAt).padStart(14, ' ');

    return `${colors.dim}-rw-r--r--${colors.reset}  ${icon.padEnd(30)} ${colors.dim}${typeLabel.padEnd(18)} ${dateStr}${colors.reset}${unreadBadge}`;
  }
}

function parseArgs(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;

    if ((char === '"' || char === "'") && (!inQuotes || quoteChar === char)) {
      inQuotes = !inQuotes;
      quoteChar = inQuotes ? char : '';
    } else if (char === ' ' && !inQuotes) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

const SHELL_COMMANDS = [
  'ls',
  'cd',
  'pwd',
  'mkdir',
  'rmdir',
  'cat',
  'ln',
  'rm',
  'mv',
  'cp',
  'connect',
  'status',
  'clear',
  'help',
  'exit',
  'quit',
];

function createCompleter(client: ApiClient) {
  return (line: string, callback: (err: Error | null, result: [string[], string]) => void) => {
    const parts = line.split(' ');

    // 1. Complete command name if user is typing the first word
    if (parts.length === 1) {
      const prefix = parts[0]!;
      const hits = SHELL_COMMANDS.filter((cmd) => cmd.startsWith(prefix));

      return callback(null, [hits.length ? hits : SHELL_COMMANDS, prefix]);
    }

    const cmd = parts[0]?.toLowerCase();
    const lastArg = parts[parts.length - 1]!;

    // Non-path commands
    if (
      cmd === 'pwd' ||
      cmd === 'clear' ||
      cmd === 'help' ||
      cmd === 'exit' ||
      cmd === 'quit' ||
      cmd === 'status'
    ) {
      return callback(null, [[], lastArg]);
    }

    // Determine directory part and prefix to complete
    const lastSlash = lastArg.lastIndexOf('/');
    const dirPart = lastSlash >= 0 ? lastArg.slice(0, lastSlash + 1) : '';
    const filePrefix = lastSlash >= 0 ? lastArg.slice(lastSlash + 1) : lastArg;

    const queryPath = dirPart || undefined;

    client
      .ls(queryPath, { all: true })
      .then((entries) => {
        let candidateNames = entries.map((e) => e.name);

        // Filter directories only for cd and rmdir
        if (cmd === 'cd' || cmd === 'rmdir') {
          candidateNames = candidateNames.filter((name) => name.endsWith('/'));
        } else if (cmd === 'cat') {
          // Filter chat files only for cat
          candidateNames = candidateNames.filter((name) => !name.endsWith('/'));
        }

        // Hide dotfiles unless the user explicitly started typing a dot
        if (!filePrefix.startsWith('.')) {
          candidateNames = candidateNames.filter((name) => !name.startsWith('.'));
        }

        const matches = candidateNames
          .filter((name) => name.startsWith(filePrefix))
          .map((name) => dirPart + name);

        callback(null, [matches, lastArg]);
      })
      .catch(() => {
        callback(null, [[], lastArg]);
      });
  };
}

export function startRepl(client: ApiClient): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: createCompleter(client),
  });

  const getPrompt = () => {
    return `${colors.cyan}${colors.bold}openchat${colors.reset}:${colors.blue}${client.getCwd()}${colors.reset}$ `;
  };

  const printHelp = () => {
    console.log(`
${colors.bold}Open Chat - Virtual Shell Commands:${colors.reset}
  ${colors.green}ls [-l] [-a] [-t] [-n] [-r] [path]${colors.reset} List contents (default: recent first; -n: by name; -r: reverse)
  ${colors.green}cd <path>${colors.reset}             Change virtual directory (supports .., /, relative)
  ${colors.green}pwd${colors.reset}                   Print current virtual directory
  ${colors.green}mkdir [-p] <path>${colors.reset}     Create a new virtual directory
  ${colors.green}rmdir <path>${colors.reset}          Remove an empty directory
  ${colors.green}cat <chat_path>${colors.reset}       Read message history of a chat
  ${colors.green}ln [-s] <src> <dest>${colors.reset}  Link chat into folder (pointer creation)
  ${colors.green}rm <chat_pointer>${colors.reset}     Remove chat pointer from folder (source preserved)
  ${colors.green}mv <src> <dest>${colors.reset}       Move or rename directory or chat pointer
  ${colors.green}cp -r <src> <dest>${colors.reset}    Recursively duplicate directory and pointers
  ${colors.green}connect <plat> [lbl]${colors.reset} Connect a platform account (e.g. 'connect whatsapp personal')
  ${colors.green}status${colors.reset}                Display connected accounts and daemon status
  ${colors.green}clear${colors.reset}                 Clear terminal screen
  ${colors.green}help${colors.reset}                  Display this help reference
  ${colors.green}exit / quit${colors.reset}           Exit Open Chat shell
`);
  };

  // Subscribe to live WebSocket events
  client.onEvent((event) => {
    if (event.type === 'vfs:change') {
      process.stdout.write(`\r\x1b[K${colors.magenta}[Live Event]${colors.reset} Filesystem updated (${event.action}: ${event.path})\n`);
      rl.setPrompt(getPrompt());
      rl.prompt(true);
    } else if (event.type === 'auth:challenge') {
      process.stdout.write(`\r\x1b[K\n${colors.cyan}${colors.bold}[Auth Challenge] ${event.platform} (${event.accountLabel}):${colors.reset}\n`);

      if (event.challenge.challengeType === 'qr_code') {
        qrcode.generate(event.challenge.data, { small: true }, (qrAscii: string) => {
          console.log(qrAscii);
          console.log(`${colors.yellow}Scan this QR code with WhatsApp (Settings > Linked Devices)${colors.reset}\n`);
        });
      } else {
        console.log(`${colors.yellow}${event.challenge.prompt || event.challenge.data}${colors.reset}\n`);
      }

      rl.setPrompt(getPrompt());
      rl.prompt(true);
    } else if (event.type === 'auth:status') {
      if (event.status === 'authenticated') {
        process.stdout.write(`\r\x1b[K${colors.green}${colors.bold}[Auth Success]${colors.reset} ${event.platform} (${event.accountLabel}) authenticated!\n`);
      } else if (event.status === 'failed') {
        process.stdout.write(`\r\x1b[K${colors.red}${colors.bold}[Auth Failed]${colors.reset} ${event.platform} (${event.accountLabel}): ${event.error}\n`);
      }

      rl.setPrompt(getPrompt());
      rl.prompt(true);
    } else if (event.type === 'sync:complete') {
      process.stdout.write(
        `\r\x1b[K${colors.green}${colors.bold}[Discovery Sync]${colors.reset} Synced ${event.chatCount} chats into ${colors.blue}${event.systemRootDir}${colors.reset} (${event.messageCount} messages backfilled).\n`
      );
      rl.setPrompt(getPrompt());
      rl.prompt(true);
    }
  });

  console.log(`
${colors.cyan}${colors.bold}==============================================
       Open Chat Virtual Shell (Phase 2)
==============================================${colors.reset}
Type ${colors.green}help${colors.reset} for command reference, or ${colors.green}cat welcome.dm${colors.reset} to begin.
`);

  rl.setPrompt(getPrompt());
  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      rl.setPrompt(getPrompt());
      rl.prompt();

      return;
    }

    const args = parseArgs(trimmed);
    const command = args[0]?.toLowerCase();

    try {
      switch (command) {
        case 'pwd': {
          console.log(client.getCwd());
          break;
        }

        case 'cd': {
          const target = args[1];
          await client.cd(target);
          break;
        }

        case 'ls': {
          let showAll = false;
          let showLong = false;
          let sortBy: 'time' | 'name' = 'time'; // Default: descending by last message / activity timestamp
          let reverse = false;
          let targetPath: string | undefined = undefined;

          for (let i = 1; i < args.length; i++) {
            const arg = args[i]!;

            if (arg === '--sort=time' || arg === '-t') {
              sortBy = 'time';
            } else if (arg === '--sort=name' || arg === '-n') {
              sortBy = 'name';
            } else if (arg === '--reverse' || arg === '-r') {
              reverse = true;
            } else if (arg.startsWith('-')) {
              if (arg.includes('a')) showAll = true;

              if (arg.includes('l')) showLong = true;

              if (arg.includes('t')) sortBy = 'time';

              if (arg.includes('n')) sortBy = 'name';

              if (arg.includes('r')) reverse = true;
            } else {
              targetPath = arg;
            }
          }

          const entries = await client.ls(targetPath, { all: showAll, sort: sortBy, reverse });

          if (entries.length === 0) {
            // empty folder, no output like standard Unix ls
          } else if (showLong) {
            for (const entry of entries) {
              console.log(formatEntry(entry, true));
            }
          } else {
            console.log(entries.map((e) => formatEntry(e, false)).join('  '));
          }

          break;
        }

        case 'mkdir': {
          let recursive = false;
          let targetPath: string | undefined = undefined;

          for (let i = 1; i < args.length; i++) {
            const arg = args[i]!;

            if (arg === '-p') {
              recursive = true;
            } else {
              targetPath = arg;
            }
          }

          if (!targetPath) {
            console.error(`${colors.red}mkdir: missing operand${colors.reset}`);
          } else {
            await client.mkdir(targetPath, { recursive });
          }

          break;
        }

        case 'rmdir': {
          const targetPath = args[1];

          if (!targetPath) {
            console.error(`${colors.red}rmdir: missing operand${colors.reset}`);
          } else {
            await client.rmdir(targetPath);
          }

          break;
        }

        case 'cat': {
          const targetPath = args[1];

          if (!targetPath) {
            console.error(`${colors.red}cat: missing chat operand${colors.reset}`);
          } else {
            const { chat, messages } = await client.cat(targetPath);
            console.log(
              `\n${colors.bold}${colors.green}--- Chat: ${chat.title} (${chat.chat_type}) ---${colors.reset}`
            );

            if (messages.length === 0) {
              console.log(`${colors.dim}(No messages in this chat)${colors.reset}`);
            } else {
              for (const msg of messages) {
                const timeStr = new Date(msg.timestamp).toLocaleTimeString();
                console.log(
                  `${colors.dim}[${timeStr}]${colors.reset} ${colors.bold}${msg.senderName}:${colors.reset} ${msg.text}`
                );
              }
            }

            console.log(`${colors.bold}${colors.green}------------------------------------------------${colors.reset}\n`);
          }

          break;
        }

        case 'ln': {
          let sourcePath: string | undefined = undefined;
          let destPath: string | undefined = undefined;

          for (let i = 1; i < args.length; i++) {
            const arg = args[i]!;

            if (arg === '-s') {
              continue; // -s flag is standard symlink syntax
            }

            if (!sourcePath) {
              sourcePath = arg;
            } else if (!destPath) {
              destPath = arg;
            }
          }

          if (!sourcePath || !destPath) {
            console.error(`${colors.red}ln: usage: ln [-s] <source_chat> <target_directory>${colors.reset}`);
          } else {
            const linkedName = await client.ln(sourcePath, destPath);
            console.log(`${colors.dim}Created pointer '${linkedName}' in '${destPath}'${colors.reset}`);
          }

          break;
        }

        case 'rm': {
          const targetPath = args[1];

          if (!targetPath) {
            console.error(`${colors.red}rm: missing operand${colors.reset}`);
          } else {
            await client.rm(targetPath);
            console.log(`${colors.dim}Removed pointer '${targetPath}'${colors.reset}`);
          }

          break;
        }

        case 'mv': {
          const src = args[1];
          const dest = args[2];

          if (!src || !dest) {
            console.error(`${colors.red}mv: usage: mv <source> <destination>${colors.reset}`);
          } else {
            await client.mv(src, dest);
          }

          break;
        }

        case 'cp': {
          let recursive = false;
          let src: string | undefined = undefined;
          let dest: string | undefined = undefined;

          for (let i = 1; i < args.length; i++) {
            const arg = args[i]!;

            if (arg === '-r' || arg === '-R') {
              recursive = true;
            } else if (!src) {
              src = arg;
            } else if (!dest) {
              dest = arg;
            }
          }

          if (!src || !dest) {
            console.error(`${colors.red}cp: usage: cp -r <source_dir> <dest_dir>${colors.reset}`);
          } else {
            await client.cp(src, dest, { recursive });
          }

          break;
        }

        case 'clear': {
          console.clear();
          break;
        }

        case 'connect': {
          const platform = args[1];
          let label = 'personal';
          let isMock = false;
          let isClean = false;

          for (let i = 2; i < args.length; i++) {
            const arg = args[i]!;

            if (arg === '--mock') {
              isMock = true;
            } else if (arg === '--clean' || arg === '--fresh') {
              isClean = true;
            } else if (!arg.startsWith('-')) {
              label = arg;
            }
          }

          if (!platform) {
            console.error(`${colors.red}connect: usage: connect <platform> [accountLabel] [--clean] [--mock]${colors.reset}`);
          } else {
            console.log(`${colors.dim}Initiating connection to ${platform} (${label})...${colors.reset}`);
            await client.connectAuth(platform, label, isMock, isClean);
          }

          break;
        }

        case 'status': {
          const accounts = await client.listAccounts();
          console.log(`\n${colors.bold}Connected Accounts:${colors.reset}`);

          if (accounts.length === 0) {
            console.log(`  ${colors.dim}(No accounts connected yet)${colors.reset}`);
          } else {
            for (const acc of accounts) {
              const statusColor = acc.status === 'active' ? colors.green : colors.yellow;
              console.log(
                `  • ${colors.bold}${acc.platform_id}${colors.reset} (${acc.label}) [${statusColor}${acc.status}${colors.reset}] - Created: ${new Date(acc.created_at).toLocaleDateString()}`
              );
            }
          }

          console.log();
          break;
        }

        case 'help': {
          printHelp();
          break;
        }

        case 'exit':
        case 'quit': {
          console.log(`\nGoodbye!`);
          client.close();
          rl.close();
          process.exit(0);
          break;
        }

        default: {
          console.error(
            `${colors.red}openchat: command not found: ${command}. Type 'help' for available commands.${colors.reset}`
          );
          break;
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${colors.red}${message}${colors.reset}`);
    }

    rl.setPrompt(getPrompt());
    rl.prompt();
  });

  rl.on('close', () => {
    client.close();
    process.exit(0);
  });
}
