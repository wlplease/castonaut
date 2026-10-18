import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';

const ROUTES = {
  info: ['/v1/info', 'GET'],
  casts: ['/v1/castsByFid', 'GET'],
  links: ['/v1/linksByFid', 'GET'],
  userData: ['/v1/userDataByFid', 'GET'],
  signers: ['/v1/signersByFid', 'GET'],
  castById: ['/v1/castById', 'GET'],
  linkById: ['/v1/linkById', 'GET'],
  reactionById: ['/v1/reactionById', 'GET'],
  submit: ['/v1/submitMessage', 'POST'],
};

function localSnapchainAdapter(serverEnv) {
  return {
    name: 'castonaut-local-snapchain-adapter',
    configureServer(server) {
      server.middlewares.use('/api/snapchain', async (req, res) => {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        const route = ROUTES[requestUrl.searchParams.get('route')];
        const base = serverEnv.SNAPCHAIN_URL;
        if (!route) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Unknown Snapchain route' })); return; }
        if (!base) { res.statusCode = 503; res.end(JSON.stringify({ error: 'The shared feed service has not been configured for this preview yet.' })); return; }
        if (req.method !== route[1]) { res.statusCode = 405; res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
        try {
          const target = new URL(route[0], base.endsWith('/') ? base : `${base}/`);
          if ((serverEnv.SNAPCHAIN_HTTP_USER || serverEnv.SNAPCHAIN_HTTP_PASS) && target.protocol !== 'https:') throw new Error('Proxy credentials require an HTTPS Snapchain endpoint.');
          for (const [key, value] of requestUrl.searchParams.entries()) if (key !== 'route') target.searchParams.set(key, value);
          const headers = { accept: 'application/json' };
          let body;
          if (req.method === 'POST') {
            const chunks = []; let length = 0;
            for await (const chunk of req) { length += chunk.length; if (length > 64 * 1024) throw new Error('Message exceeds the 64 KB local limit'); chunks.push(chunk); }
            body = Buffer.concat(chunks); headers['content-type'] = 'application/octet-stream';
          }
          if (serverEnv.SNAPCHAIN_HTTP_USER && serverEnv.SNAPCHAIN_HTTP_PASS) headers.authorization = `Basic ${Buffer.from(`${serverEnv.SNAPCHAIN_HTTP_USER}:${serverEnv.SNAPCHAIN_HTTP_PASS}`).toString('base64')}`;
          const upstream = await fetch(target, { method: req.method, headers, body, signal: AbortSignal.timeout(12_000) });
          res.statusCode = upstream.status;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.end(await upstream.text());
        } catch (error) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: error.message.includes('64 KB') ? error.message : 'Could not reach the configured Snapchain node.' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Vite does not put .env values in process.env for config plugins. Read them
  // here, and pass only the server-side Snapchain settings to the adapter.
  const loaded = loadEnv(mode, process.cwd(), '');
  const serverEnv = {
    SNAPCHAIN_URL: process.env.SNAPCHAIN_URL || loaded.SNAPCHAIN_URL || '',
    SNAPCHAIN_HTTP_USER: process.env.SNAPCHAIN_HTTP_USER || loaded.SNAPCHAIN_HTTP_USER || '',
    SNAPCHAIN_HTTP_PASS: process.env.SNAPCHAIN_HTTP_PASS || loaded.SNAPCHAIN_HTTP_PASS || '',
  };

  return {
    plugins: [localSnapchainAdapter(serverEnv)],
    resolve: {
      alias: [{ find: /^@faker-js\/faker$/, replacement: resolve(process.cwd(), 'src/faker-compat.js') }],
    },
    publicDir: false,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rolldownOptions: {
        input: {
          main: resolve(process.cwd(), 'index.html'),
          tutorial: resolve(process.cwd(), 'tutorial.html'),
        },
      },
    },
    server: { port: 5175, strictPort: true },
  };
});
