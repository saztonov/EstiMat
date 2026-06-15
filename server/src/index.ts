import { buildApp } from './app.js';
import { config } from './config.js';
import { runStartupChecks } from './startup-checks.js';

async function start() {
  // §25: упасть на старте, если прод-настройки небезопасны или отсутствуют.
  runStartupChecks();

  const app = await buildApp();

  // Graceful shutdown (§5): дождаться закрытия соединений (pool закрывается
  // через onClose-хук плагина database), с таймаутом на принудительный выход.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    const force = setTimeout(() => {
      app.log.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    force.unref();
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => void shutdown(sig));
  }

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`Server running on http://localhost:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
