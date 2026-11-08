import { type Database } from 'better-sqlite3';
import {
  type DirectoryRow,
  type ChatPointerRow,
  type ChatRow,
  type PlatformId,
} from '../db/schema.js';
import { randomUUID } from 'crypto';

export interface VfsEntry {
  name: string;
  type: 'directory' | 'chat';
  chatType?: string | undefined;
  platform?: PlatformId | undefined;
  unreadCount: number;
  isHidden: boolean;
  isSystemRoot?: boolean | undefined;
  updatedAt?: number | undefined;
}

export interface ChatMessage {
  id: string;
  senderName: string;
  senderId: string;
  text: string;
  timestamp: number;
  status: string;
}

export interface CatChatResult {
  chat: ChatRow;
  messages: ChatMessage[];
}

export class VirtualFileSystem {
  private db: Database;
  private currentPath: string = '/';

  constructor(db: Database) {
    this.db = db;
  }

  public getCwd(): string {
    return this.currentPath;
  }

  /**
   * Normalizes a virtual path against cwd, returning an array of path segments.
   * Root '/' is represented as an empty array [].
   */
  public normalizePath(targetPath?: string): string[] {
    const rawPath = targetPath ?? '';
    const isAbsolute = rawPath.startsWith('/');
    const baseSegments = isAbsolute ? [] : this.currentPath.split('/').filter(Boolean);
    const inputSegments = rawPath.split('/').filter(Boolean);

    const result: string[] = [...baseSegments];

    for (const segment of inputSegments) {
      if (segment === '.' || segment === '') {
        continue;
      }

      if (segment === '..') {
        if (result.length > 0) {
          result.pop();
        }
      } else {
        result.push(segment);
      }
    }

    return result;
  }

  public segmentsToPath(segments: string[]): string {
    return '/' + segments.join('/');
  }

  /**
   * Resolves a directory node from path segments.
   */
  public resolveDirectory(segments: string[]): DirectoryRow | null {
    let currentId = 'root';

    // SAFETY: SQLite query selects all columns from directories table matching DirectoryRow
    let currentDir: DirectoryRow | null = this.db
      .prepare('SELECT * FROM directories WHERE id = ?')
      .get('root') as DirectoryRow | null;

    if (!currentDir) {
      return null;
    }

    for (const segment of segments) {
      // SAFETY: SQLite query selects all columns from directories table matching DirectoryRow
      const child: DirectoryRow | null = this.db
        .prepare('SELECT * FROM directories WHERE parent_id = ? AND name = ?')
        .get(currentId, segment) as DirectoryRow | null;

      if (!child) {
        return null;
      }

      currentDir = child;
      currentId = child.id;
    }

    return currentDir;
  }

  /**
   * Resolves a chat pointer given path segments.
   */
  public resolveChatPointer(
    segments: string[]
  ): { pointer: ChatPointerRow; chat: ChatRow; dir: DirectoryRow } | null {
    if (segments.length === 0) {
      return null;
    }

    const dirSegments = segments.slice(0, -1);
    const fileName = segments[segments.length - 1]!;

    const dir = this.resolveDirectory(dirSegments);

    if (!dir) {
      return null;
    }

    // SAFETY: SQLite query selects all columns from chat_pointers table matching ChatPointerRow
    const pointer: ChatPointerRow | null = this.db
      .prepare('SELECT * FROM chat_pointers WHERE directory_id = ? AND pointer_name = ?')
      .get(dir.id, fileName) as ChatPointerRow | null;

    if (!pointer) {
      return null;
    }

    // SAFETY: SQLite query selects all columns from chats table matching ChatRow
    const chat: ChatRow | null = this.db
      .prepare('SELECT * FROM chats WHERE id = ?')
      .get(pointer.chat_id) as ChatRow | null;

    if (!chat) {
      return null;
    }

    return { pointer, chat, dir };
  }

  /**
   * Calculates total unread messages bubbling up through a directory and its subdirectories.
   */
  public getDirectoryUnreadCount(dirId: string): number {
    const query = `
      WITH RECURSIVE subdirs(id) AS (
        SELECT id FROM directories WHERE id = ?
        UNION ALL
        SELECT d.id FROM directories d JOIN subdirs s ON d.parent_id = s.id
      )
      SELECT COALESCE(SUM(c.unread_count), 0) as total_unread
      FROM subdirs s
      JOIN chat_pointers cp ON cp.directory_id = s.id
      JOIN chats c ON c.id = cp.chat_id;
    `;

    // SAFETY: Aggregate query returns total_unread integer
    const row = this.db.prepare(query).get(dirId) as { total_unread: number } | undefined;

    return row ? row.total_unread : 0;
  }

  /**
   * Calculates the latest message or chat activity timestamp across a directory and its subdirectories.
   */
  public getDirectoryLastActivity(dirId: string): number {
    const query = `
      WITH RECURSIVE subdirs(id) AS (
        SELECT id FROM directories WHERE id = ?
        UNION ALL
        SELECT d.id FROM directories d JOIN subdirs s ON d.parent_id = s.id
      )
      SELECT COALESCE(MAX(m.timestamp), MAX(c.updated_at), d_self.created_at) as last_activity
      FROM subdirs s
      JOIN directories d_self ON d_self.id = ?
      LEFT JOIN chat_pointers cp ON cp.directory_id = s.id
      LEFT JOIN chats c ON c.id = cp.chat_id
      LEFT JOIN messages m ON m.chat_id = c.id;
    `;

    // SAFETY: Aggregate query returns last_activity integer
    const row = this.db.prepare(query).get(dirId, dirId) as { last_activity: number } | undefined;

    return row ? row.last_activity : 0;
  }

  /**
   * Changes the current working directory.
   */
  public cd(targetPath?: string): string {
    if (!targetPath || targetPath === '~' || targetPath === '/') {
      this.currentPath = '/';

      return this.currentPath;
    }

    const segments = this.normalizePath(targetPath);
    const dir = this.resolveDirectory(segments);

    if (!dir) {
      // Check if user tried to cd into a chat file
      const chatLookup = this.resolveChatPointer(segments);

      if (chatLookup) {
        throw new Error(`cd: not a directory: ${targetPath}`);
      }

      throw new Error(`cd: no such file or directory: ${targetPath}`);
    }

    this.currentPath = this.segmentsToPath(segments);

    return this.currentPath;
  }

  /**
   * Lists the contents of a directory.
   * Default sorting: descending by last message / activity timestamp.
   */
  public ls(
    targetPath?: string,
    options: { all?: boolean | undefined; sort?: 'time' | 'name' | undefined; reverse?: boolean | undefined } = {}
  ): VfsEntry[] {
    const segments = this.normalizePath(targetPath);
    const dir = this.resolveDirectory(segments);

    if (!dir) {
      // If targetPath is a single chat file, return just that file
      const chatLookup = this.resolveChatPointer(segments);

      if (chatLookup) {
        return [
          {
            name: chatLookup.pointer.pointer_name,
            type: 'chat',
            chatType: chatLookup.chat.chat_type,
            platform: chatLookup.chat.platform_id,
            unreadCount: chatLookup.chat.unread_count,
            isHidden: chatLookup.pointer.pointer_name.startsWith('.'),
            updatedAt: chatLookup.chat.updated_at,
          },
        ];
      }

      throw new Error(`ls: cannot access '${targetPath ?? ''}': No such file or directory`);
    }

    const entries: VfsEntry[] = [];

    // 1. Fetch child directories
    // SAFETY: SQLite query selects all columns from directories table matching DirectoryRow
    const subdirs = this.db
      .prepare('SELECT * FROM directories WHERE parent_id = ?')
      .all(dir.id) as DirectoryRow[];

    for (const sub of subdirs) {
      const isHidden = sub.name.startsWith('.') || sub.is_hidden === 1;

      if (isHidden && !options.all) {
        continue;
      }

      const unreadCount = this.getDirectoryUnreadCount(sub.id);
      const lastActivity = this.getDirectoryLastActivity(sub.id);
      entries.push({
        name: sub.name + '/',
        type: 'directory',
        unreadCount,
        isHidden,
        isSystemRoot: sub.is_system_root === 1,
        updatedAt: lastActivity,
      });
    }

    // 2. Fetch chat pointers with latest message/activity timestamp
    // SAFETY: Database query selects columns matching pointer listing structure
    const pointers = this.db
      .prepare(
        `
        SELECT 
          cp.pointer_name, 
          c.chat_type, 
          c.platform_id,
          c.unread_count, 
          COALESCE(MAX(m.timestamp), NULLIF(c.updated_at, 0), NULL) as last_activity
        FROM chat_pointers cp
        JOIN chats c ON c.id = cp.chat_id
        LEFT JOIN messages m ON m.chat_id = c.id
        WHERE cp.directory_id = ?
        GROUP BY cp.id
      `
      )
      .all(dir.id) as {
      pointer_name: string;
      chat_type: string;
      platform_id: PlatformId;
      unread_count: number;
      last_activity: number;
    }[];

    for (const ptr of pointers) {
      const isHidden = ptr.pointer_name.startsWith('.');

      if (isHidden && !options.all) {
        continue;
      }

      entries.push({
        name: ptr.pointer_name,
        type: 'chat',
        chatType: ptr.chat_type,
        platform: ptr.platform_id,
        unreadCount: ptr.unread_count,
        isHidden,
        updatedAt: ptr.last_activity,
      });
    }

    // 3. Sorting (default: descending by last message/activity timestamp)
    const sortBy = options.sort ?? 'time';
    const reverse = !!options.reverse;

    entries.sort((a, b) => {
      if (sortBy === 'time') {
        const timeA = a.updatedAt || 0;
        const timeB = b.updatedAt || 0;

        if (timeA > 0 && timeB > 0) {
          if (timeB !== timeA) {
            return timeB - timeA; // Most recent first
          }
        } else if (timeA > 0 && timeB === 0) {
          return -1; // a has messages, b does not -> a comes first
        } else if (timeA === 0 && timeB > 0) {
          return 1; // b has messages, a does not -> b comes first
        }

        return a.name.localeCompare(b.name);
      } else {
        return a.name.localeCompare(b.name); // Ascending by name
      }
    });

    if (reverse) {
      entries.reverse();
    }

    return entries;
  }

  /**
   * Creates a new directory. Supports `-p` recursive creation.
   */
  public mkdir(targetPath: string, options: { recursive?: boolean } = {}): string {
    const segments = this.normalizePath(targetPath);

    if (segments.length === 0) {
      throw new Error(`mkdir: cannot create root directory`);
    }

    if (!options.recursive) {
      const parentSegments = segments.slice(0, -1);
      const dirName = segments[segments.length - 1]!;

      const parent = this.resolveDirectory(parentSegments);

      if (!parent) {
        throw new Error(`mkdir: cannot create directory '${targetPath}': No such file or directory`);
      }

      // Check collision with existing directory or pointer
      const existingDir = this.db
        .prepare('SELECT id FROM directories WHERE parent_id = ? AND name = ?')
        .get(parent.id, dirName);

      if (existingDir) {
        throw new Error(`mkdir: cannot create directory '${targetPath}': File exists`);
      }

      const existingPtr = this.db
        .prepare('SELECT id FROM chat_pointers WHERE directory_id = ? AND pointer_name = ?')
        .get(parent.id, dirName);

      if (existingPtr) {
        throw new Error(`mkdir: cannot create directory '${targetPath}': File exists`);
      }

      const isHidden = dirName.startsWith('.') ? 1 : 0;
      const newId = 'dir_' + randomUUID().replace(/-/g, '').slice(0, 12);
      this.db
        .prepare(
          `
        INSERT INTO directories (id, name, parent_id, is_system_root, is_hidden, created_at)
        VALUES (?, ?, ?, 0, ?, ?)
      `
        )
        .run(newId, dirName, parent.id, isHidden, Date.now());

      return this.segmentsToPath(segments);
    }

    // Recursive creation (-p)
    let currentId = 'root';
    let pathAccum: string[] = [];

    for (const segment of segments) {
      pathAccum.push(segment);

      // SAFETY: Query returns directory id
      let existing = this.db
        .prepare('SELECT id FROM directories WHERE parent_id = ? AND name = ?')
        .get(currentId, segment) as { id: string } | undefined;

      if (!existing) {
        const isHidden = segment.startsWith('.') ? 1 : 0;
        const newId = 'dir_' + randomUUID().replace(/-/g, '').slice(0, 12);
        this.db
          .prepare(
            `
          INSERT INTO directories (id, name, parent_id, is_system_root, is_hidden, created_at)
          VALUES (?, ?, ?, 0, ?, ?)
        `
          )
          .run(newId, segment, currentId, isHidden, Date.now());
        currentId = newId;
      } else {
        currentId = existing.id;
      }
    }

    return this.segmentsToPath(segments);
  }

  /**
   * Removes an empty directory.
   */
  public rmdir(targetPath: string): void {
    const segments = this.normalizePath(targetPath);

    if (segments.length === 0) {
      throw new Error(`rmdir: cannot remove root directory`);
    }

    const dir = this.resolveDirectory(segments);

    if (!dir) {
      throw new Error(`rmdir: failed to remove '${targetPath}': No such file or directory`);
    }

    if (dir.is_system_root === 1) {
      throw new Error(`rmdir: failed to remove '${targetPath}': Cannot remove system root directory`);
    }

    // Check if directory has child directories
    // SAFETY: COUNT(*) aggregate returns numeric count
    const subdirs = this.db
      .prepare('SELECT COUNT(*) as count FROM directories WHERE parent_id = ?')
      .get(dir.id) as { count: number };

    if (subdirs.count > 0) {
      throw new Error(`rmdir: failed to remove '${targetPath}': Directory not empty`);
    }

    // Check if directory has chat pointers
    // SAFETY: COUNT(*) aggregate returns numeric count
    const pointers = this.db
      .prepare('SELECT COUNT(*) as count FROM chat_pointers WHERE directory_id = ?')
      .get(dir.id) as { count: number };

    if (pointers.count > 0) {
      throw new Error(`rmdir: failed to remove '${targetPath}': Directory not empty`);
    }

    this.db.prepare('DELETE FROM directories WHERE id = ?').run(dir.id);
  }

  /**
   * Reads chat history for a chat pointer.
   */
  public cat(targetPath: string, limit = 50): CatChatResult {
    const segments = this.normalizePath(targetPath);
    const lookup = this.resolveChatPointer(segments);

    if (!lookup) {
      const dirLookup = this.resolveDirectory(segments);

      if (dirLookup) {
        throw new Error(`cat: ${targetPath}: Is a directory`);
      }

      throw new Error(`cat: ${targetPath}: No such file or directory`);
    }

    // SAFETY: Query returns message rows matching projection
    const rows = this.db
      .prepare(
        `
        SELECT id, sender_name, sender_id, text, timestamp, status
        FROM messages
        WHERE chat_id = ?
        ORDER BY timestamp ASC
        LIMIT ?
      `
      )
      .all(lookup.chat.id, limit) as {
      id: string;
      sender_name: string;
      sender_id: string;
      text: string;
      timestamp: number;
      status: string;
    }[];

    const messages: ChatMessage[] = rows.map((r) => ({
      id: r.id,
      senderName: r.sender_name,
      senderId: r.sender_id,
      text: r.text,
      timestamp: r.timestamp,
      status: r.status,
    }));

    // Reset unread count on reading
    if (lookup.chat.unread_count > 0) {
      this.db.prepare('UPDATE chats SET unread_count = 0 WHERE id = ?').run(lookup.chat.id);
    }

    return { chat: lookup.chat, messages };
  }

  /**
   * Creates a pointer (symlink) to an existing chat inside target directory.
   * Auto-resolves naming collisions using -2, -3 suffixes.
   */
  public ln(sourceChatPath: string, targetDirPath: string): string {
    const sourceSegments = this.normalizePath(sourceChatPath);
    const sourceLookup = this.resolveChatPointer(sourceSegments);

    if (!sourceLookup) {
      throw new Error(`ln: failed to link '${sourceChatPath}': No such chat file`);
    }

    const targetSegments = this.normalizePath(targetDirPath);
    const targetDir = this.resolveDirectory(targetSegments);

    if (!targetDir) {
      throw new Error(`ln: failed to link to '${targetDirPath}': Target directory does not exist`);
    }

    const baseName = sourceLookup.pointer.pointer_name;
    let chosenName = baseName;

    // Check collision and assign -2, -3 suffix if necessary
    // SAFETY: Query returns pointer_name strings
    const existing = this.db
      .prepare('SELECT pointer_name FROM chat_pointers WHERE directory_id = ?')
      .all(targetDir.id) as { pointer_name: string }[];

    const nameSet = new Set(existing.map((e) => e.pointer_name));

    if (nameSet.has(chosenName)) {
      // Split extension (e.g., alex.dm -> name: alex, ext: .dm)
      const lastDot = baseName.lastIndexOf('.');
      const rawName = lastDot > 0 ? baseName.slice(0, lastDot) : baseName;
      const ext = lastDot > 0 ? baseName.slice(lastDot) : '';

      let counter = 2;

      while (nameSet.has(`${rawName}-${counter}${ext}`)) {
        counter++;
      }

      chosenName = `${rawName}-${counter}${ext}`;
    }

    const newPtrId = 'ptr_' + randomUUID().replace(/-/g, '').slice(0, 12);
    this.db
      .prepare(
        `
      INSERT INTO chat_pointers (id, directory_id, chat_id, pointer_name, created_at)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(newPtrId, targetDir.id, sourceLookup.chat.id, chosenName, Date.now());

    return chosenName;
  }

  /**
   * Removes a pointer from a directory. The canonical chat node remains unaffected.
   */
  public rm(targetPath: string): void {
    const segments = this.normalizePath(targetPath);
    const lookup = this.resolveChatPointer(segments);

    if (!lookup) {
      const dirLookup = this.resolveDirectory(segments);

      if (dirLookup) {
        throw new Error(`rm: cannot remove '${targetPath}': Is a directory (use rmdir)`);
      }

      throw new Error(`rm: cannot remove '${targetPath}': No such file or directory`);
    }

    // Check if trying to remove from an immutable system root
    if (lookup.dir.is_system_root === 1) {
      throw new Error(`rm: cannot remove chat pointer from system archive root directory`);
    }

    this.db.prepare('DELETE FROM chat_pointers WHERE id = ?').run(lookup.pointer.id);
  }

  /**
   * Moves or renames a directory or chat pointer.
   */
  public mv(sourcePath: string, destPath: string): void {
    const srcSegments = this.normalizePath(sourcePath);
    const destSegments = this.normalizePath(destPath);

    if (srcSegments.length === 0) {
      throw new Error(`mv: cannot move root directory`);
    }

    // Check if source is a directory
    const srcDir = this.resolveDirectory(srcSegments);

    if (srcDir) {
      if (srcDir.is_system_root === 1) {
        throw new Error(`mv: cannot move system root directory`);
      }

      // Check if dest is an existing directory -> move inside it
      const destDir = this.resolveDirectory(destSegments);

      if (destDir) {
        // Move srcDir inside destDir keeping its current name
        this.db
          .prepare('UPDATE directories SET parent_id = ? WHERE id = ?')
          .run(destDir.id, srcDir.id);

        return;
      }

      // Rename / move to new parent and name
      const destParentSegments = destSegments.slice(0, -1);
      const newName = destSegments[destSegments.length - 1]!;
      const destParent = this.resolveDirectory(destParentSegments);

      if (!destParent) {
        throw new Error(`mv: cannot move to '${destPath}': No such destination directory`);
      }

      this.db
        .prepare('UPDATE directories SET parent_id = ?, name = ? WHERE id = ?')
        .run(destParent.id, newName, srcDir.id);

      return;
    }

    // Check if source is a chat pointer
    const srcPtr = this.resolveChatPointer(srcSegments);

    if (srcPtr) {
      if (srcPtr.dir.is_system_root === 1) {
        throw new Error(`mv: cannot move chat pointer out of system archive root`);
      }

      // If dest is an existing directory, move pointer into it
      const destDir = this.resolveDirectory(destSegments);

      if (destDir) {
        this.db
          .prepare('UPDATE chat_pointers SET directory_id = ? WHERE id = ?')
          .run(destDir.id, srcPtr.pointer.id);

        return;
      }

      // Rename pointer in place or move to new parent with new name
      const destParentSegments = destSegments.slice(0, -1);
      const newName = destSegments[destSegments.length - 1]!;
      const destParent = this.resolveDirectory(destParentSegments);

      if (!destParent) {
        throw new Error(`mv: cannot move to '${destPath}': No such destination directory`);
      }

      this.db
        .prepare('UPDATE chat_pointers SET directory_id = ?, pointer_name = ? WHERE id = ?')
        .run(destParent.id, newName, srcPtr.pointer.id);

      return;
    }

    throw new Error(`mv: cannot stat '${sourcePath}': No such file or directory`);
  }

  /**
   * Recursively copies a directory tree and its chat pointers. Prohibited on individual chats.
   */
  public cp(sourcePath: string, destPath: string, options: { recursive?: boolean } = {}): void {
    const srcSegments = this.normalizePath(sourcePath);
    const ptrCheck = this.resolveChatPointer(srcSegments);

    if (ptrCheck) {
      throw new Error(
        `cp: operation not permitted on chat files. Chats are unique communication channels; use 'ln -s' to link.`
      );
    }

    if (!options.recursive) {
      throw new Error(`cp: -r not specified; omitting directory '${sourcePath}'`);
    }

    const srcDir = this.resolveDirectory(srcSegments);

    if (!srcDir) {
      throw new Error(`cp: cannot stat '${sourcePath}': No such file or directory`);
    }

    const destSegments = this.normalizePath(destPath);
    const destParentSegments = destSegments.slice(0, -1);
    const newDirName = destSegments[destSegments.length - 1]!;
    const destParent = this.resolveDirectory(destParentSegments);

    if (!destParent) {
      throw new Error(`cp: destination path '${destPath}' does not exist`);
    }

    // Recursive directory clone transaction
    const cloneDir = (sourceDirId: string, targetParentId: string, folderName: string) => {
      const newId = 'dir_' + randomUUID().replace(/-/g, '').slice(0, 12);
      this.db
        .prepare(
          `
        INSERT INTO directories (id, name, parent_id, is_system_root, is_hidden, created_at)
        VALUES (?, ?, ?, 0, 0, ?)
      `
        )
        .run(newId, folderName, targetParentId, Date.now());

      // Clone pointers
      // SAFETY: Query returns ChatPointerRow records
      const pointers = this.db
        .prepare('SELECT * FROM chat_pointers WHERE directory_id = ?')
        .all(sourceDirId) as ChatPointerRow[];

      for (const ptr of pointers) {
        const ptrId = 'ptr_' + randomUUID().replace(/-/g, '').slice(0, 12);
        this.db
          .prepare(
            `
          INSERT INTO chat_pointers (id, directory_id, chat_id, pointer_name, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
          )
          .run(ptrId, newId, ptr.chat_id, ptr.pointer_name, Date.now());
      }

      // Clone subdirectories
      // SAFETY: Query returns DirectoryRow records
      const subdirs = this.db
        .prepare('SELECT * FROM directories WHERE parent_id = ?')
        .all(sourceDirId) as DirectoryRow[];

      for (const sub of subdirs) {
        cloneDir(sub.id, newId, sub.name);
      }
    };

    this.cloneInTransaction(() => cloneDir(srcDir.id, destParent.id, newDirName));
  }

  private cloneInTransaction(fn: () => void): void {
    const tx = this.db.transaction(fn);
    tx();
  }
}
