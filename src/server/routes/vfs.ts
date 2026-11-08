import { type FastifyInstance } from 'fastify';
import { type VirtualFileSystem } from '../../core/vfs/vfs.js';
import { type EventBroadcaster } from '../events.js';

export function registerVfsRoutes(
  app: FastifyInstance,
  vfs: VirtualFileSystem,
  broadcaster: EventBroadcaster
): void {
  // Health check
  app.get('/api/health', async () => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      wsClients: broadcaster.getClientCount(),
      timestamp: Date.now(),
    };
  });

  // GET /api/vfs/ls?path=...&all=true
  app.get<{
    Querystring: { path?: string; all?: string | boolean };
  }>('/api/vfs/ls', async (request, reply) => {
    try {
      const targetPath = request.query.path;
      const all = request.query.all === 'true' || request.query.all === true;
      const entries = vfs.ls(targetPath, { all });
      return { entries };
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });

  // POST /api/vfs/cd { path: string }
  app.post<{
    Body: { path?: string };
  }>('/api/vfs/cd', async (request, reply) => {
    try {
      const targetPath = request.body?.path;
      const segments = vfs.normalizePath(targetPath);
      const dir = vfs.resolveDirectory(segments);

      if (!dir) {
        const chatLookup = vfs.resolveChatPointer(segments);
        if (chatLookup) {
          reply.status(400);
          return { error: `cd: not a directory: ${targetPath}` };
        }
        reply.status(404);
        return { error: `cd: no such file or directory: ${targetPath}` };
      }

      return { cwd: vfs.segmentsToPath(segments) };
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });

  // POST /api/vfs/mkdir { path: string, recursive?: boolean }
  app.post<{
    Body: { path: string; recursive?: boolean };
  }>('/api/vfs/mkdir', async (request, reply) => {
    try {
      const { path, recursive } = request.body ?? {};
      if (!path) {
        reply.status(400);
        return { error: 'mkdir: missing operand' };
      }
      const createdPath = vfs.mkdir(path, { recursive: !!recursive });
      broadcaster.broadcastVfsChange('mkdir', createdPath);
      return { created: createdPath };
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });

  // POST /api/vfs/rmdir { path: string }
  app.post<{
    Body: { path: string };
  }>('/api/vfs/rmdir', async (request, reply) => {
    try {
      const { path } = request.body ?? {};
      if (!path) {
        reply.status(400);
        return { error: 'rmdir: missing operand' };
      }
      vfs.rmdir(path);
      broadcaster.broadcastVfsChange('rmdir', path);
      return { removed: path };
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });

  // GET /api/vfs/cat?path=...&limit=...
  app.get<{
    Querystring: { path: string; limit?: string | number };
  }>('/api/vfs/cat', async (request, reply) => {
    try {
      const { path: targetPath, limit } = request.query;
      if (!targetPath) {
        reply.status(400);
        return { error: 'cat: missing chat operand' };
      }
      const numLimit = limit ? parseInt(String(limit), 10) : 50;
      const result = vfs.cat(targetPath, numLimit);
      return result;
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });

  // POST /api/vfs/ln { source: string, targetDir: string }
  app.post<{
    Body: { source: string; targetDir: string };
  }>('/api/vfs/ln', async (request, reply) => {
    try {
      const { source, targetDir } = request.body ?? {};
      if (!source || !targetDir) {
        reply.status(400);
        return { error: 'ln: usage: ln [-s] <source_chat> <target_directory>' };
      }
      const pointerName = vfs.ln(source, targetDir);
      broadcaster.broadcastVfsChange('ln', `${targetDir}/${pointerName}`);
      return { pointerName };
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });

  // POST /api/vfs/rm { path: string }
  app.post<{
    Body: { path: string };
  }>('/api/vfs/rm', async (request, reply) => {
    try {
      const { path } = request.body ?? {};
      if (!path) {
        reply.status(400);
        return { error: 'rm: missing operand' };
      }
      vfs.rm(path);
      broadcaster.broadcastVfsChange('rm', path);
      return { removed: path };
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });

  // POST /api/vfs/mv { source: string, destination: string }
  app.post<{
    Body: { source: string; destination: string };
  }>('/api/vfs/mv', async (request, reply) => {
    try {
      const { source, destination } = request.body ?? {};
      if (!source || !destination) {
        reply.status(400);
        return { error: 'mv: usage: mv <source> <destination>' };
      }
      vfs.mv(source, destination);
      broadcaster.broadcastVfsChange('mv', destination);
      return { success: true };
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });

  // POST /api/vfs/cp { source: string, destination: string, recursive?: boolean }
  app.post<{
    Body: { source: string; destination: string; recursive?: boolean };
  }>('/api/vfs/cp', async (request, reply) => {
    try {
      const { source, destination, recursive } = request.body ?? {};
      if (!source || !destination) {
        reply.status(400);
        return { error: 'cp: usage: cp -r <source_dir> <dest_dir>' };
      }
      vfs.cp(source, destination, { recursive: !!recursive });
      broadcaster.broadcastVfsChange('cp', destination);
      return { success: true };
    } catch (err: any) {
      reply.status(400);
      return { error: err.message };
    }
  });
}
