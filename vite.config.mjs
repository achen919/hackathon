import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiHandler } from './server/api.mjs';
import { createConfigStore } from './server/config-store.mjs';

function liangpeiMatchProxy(env) {
  const handleApiRequest = createApiHandler({
    token: env.LIANGPEI_TOKEN,
    trustProxy: false,
    publicOrigin: env.PUBLIC_ORIGIN,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    configStore: createConfigStore({
      stateDir: env.STATE_DIR || 'data',
      encryptionKey: env.CONFIG_ENCRYPTION_KEY,
      allowedOrigins: env.AI_ALLOWED_ORIGINS,
    }),
  });

  const attachMiddleware = (middlewares) => {
    middlewares.use((request, response, next) => {
      void handleApiRequest(request, response)
        .then((handled) => {
          if (!handled) next();
        })
        .catch(next);
    });
  };

  return {
    name: 'liangpei-match-proxy',
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), liangpeiMatchProxy(env)],
  };
});
