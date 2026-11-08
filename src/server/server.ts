import fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { type Database } from 'better-sqlite3';
import { initDatabase } from '../core/db/database.js';
import { VirtualFileSystem } from '../core/vfs/vfs.js';
import { EventBroadcaster } from './events.js';
import { registerVfsRoutes } from './routes/vfs.js';
import { AuthManager } from '../core/auth/auth-manager.js';
import { registerAuthRoutes } from './routes/auth.js';

export interface ServerInstance {
  app: FastifyInstance;
  db: Database;
  vfs: VirtualFileSystem;
  broadcaster: EventBroadcaster;
  authManager: AuthManager;
  start: (host?: string, port?: number) => Promise<string>;
  stop: () => Promise<void>;
}

export async function createServer(options: { dbPath?: string; logger?: boolean } = {}): Promise<ServerInstance> {
  const app = fastify({
    logger: options.logger ?? false,
  });

  const db = initDatabase(options.dbPath);
  const vfs = new VirtualFileSystem(db);
  const broadcaster = new EventBroadcaster();
  const authManager = new AuthManager(db, broadcaster);

  // Register WebSocket plugin
  await app.register(fastifyWebsocket);

  // WebSocket endpoint
  app.get('/ws', { websocket: true }, (socket, _req) => {
    broadcaster.addClient(socket);

    // Send initial greeting event
    socket.send(
      JSON.stringify({
        type: 'connected',
        server: 'openchat-daemon',
        timestamp: Date.now(),
      })
    );

    socket.on('close', () => {
      broadcaster.removeClient(socket);
    });

    socket.on('error', () => {
      broadcaster.removeClient(socket);
    });
  });

  // Register REST routes
  registerVfsRoutes(app, vfs, broadcaster);
  registerAuthRoutes(app, authManager);

  const start = async (host = '127.0.0.1', port = 3000): Promise<string> => {
    const address = await app.listen({ host, port });

    return address;
  };

  const stop = async (): Promise<void> => {
    await app.close();
    db.close();
  };

  return {
    app,
    db,
    vfs,
    broadcaster,
    authManager,
    start,
    stop,
  };
}
