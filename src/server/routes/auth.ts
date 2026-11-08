import { type FastifyInstance } from 'fastify';
import { type AuthManager } from '../../core/auth/auth-manager.js';

export function registerAuthRoutes(app: FastifyInstance, authManager: AuthManager): void {
  // POST /api/auth/connect { platform, accountLabel, mock, clean }
  app.post<{
    Body: { platform: string; accountLabel?: string; mock?: boolean; clean?: boolean };
  }>('/api/auth/connect', async (request, reply) => {
    try {
      const { platform, accountLabel, mock, clean } = request.body ?? {};

      if (!platform) {
        reply.status(400);

        return { error: 'auth/connect: missing platform parameter' };
      }

      const result = await authManager.connect({
        platform,
        accountLabel,
        mock,
        clean,
      });

      return result;
    } catch (err: unknown) {
      reply.status(400);

      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // GET /api/auth/accounts
  app.get('/api/auth/accounts', async () => {
    const accounts = authManager.listAccounts();

    return { accounts };
  });

  // POST /api/auth/disconnect { accountId }
  app.post<{
    Body: { accountId: string };
  }>('/api/auth/disconnect', async (request, reply) => {
    try {
      const { accountId } = request.body ?? {};

      if (!accountId) {
        reply.status(400);

        return { error: 'auth/disconnect: missing accountId parameter' };
      }

      await authManager.disconnect(accountId);

      return { success: true, accountId };
    } catch (err: unknown) {
      reply.status(400);

      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
