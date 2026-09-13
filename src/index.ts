import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv, Env } from './types';
import { authRouter } from './routes/auth';
import { conversationsRouter } from './routes/conversations';
import { messagesRouter } from './routes/messages';
import { syncRouter } from './routes/sync';
import { usersRouter } from './routes/users';
import { socialRouter } from './routes/social';
import { groupsRouter } from './routes/groups';
import { mediaRouter } from './routes/media';
import { SweeperService } from './services/sweeper';

const app = new Hono<AppEnv>();

app.use('*', cors());

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: Date.now(),
    service: 'web3-chat-worker',
    factory: c.env?.FACTORY_ADDRESS || null,
    rpc_urls: c.env?.RPC_URLS || null,
  });
});

app.route('/auth', authRouter);
app.route('/conversations', conversationsRouter);
app.route('/sync', syncRouter);
app.route('/', usersRouter);
app.route('/', socialRouter);
app.route('/', groupsRouter);
app.route('/', mediaRouter);
app.route('/', messagesRouter);

export { app };

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    try {
      await SweeperService.runSweeper(env);
    } catch (err) {
      console.error('Scheduled sweeper failed:', err);
    }
  },
};
