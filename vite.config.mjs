import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiHandler } from './server/api.mjs';

function liangpeiMatchProxy(token) {
  const handleApiRequest = createApiHandler({ token, trustProxy: false });

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
    plugins: [react(), liangpeiMatchProxy(env.LIANGPEI_TOKEN)],
  };
});
