# Retired Openroom prototype

These files are preserved as historical source only. The active Castonaut build does not import them. Legacy API handlers are outside the root `api/` directory so Vercel cannot publish them as serverless routes; the production API is `api/snapchain.js` only.

The current Vite build uses `publicDir: false` and explicitly builds the root `index.html` and `tutorial.html` entry points.
