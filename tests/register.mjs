// Lets `node --test` import the app's server modules, which are written for
// the Next.js bundler: extension-less relative imports and the "@/" alias.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(`${process.cwd()}/`).href;

register(
  `data:text/javascript,${encodeURIComponent(`
    const ROOT = ${JSON.stringify(root)};
    const EXTS = ['', '.js', '.jsx', '.mjs', '/index.js'];
    export async function resolve(specifier, context, next) {
      let spec = specifier;
      if (spec.startsWith('@/')) spec = new URL(spec.slice(2), ROOT).href;
      const local = spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('file:');
      if (!local) return next(spec, context);
      let lastErr;
      for (const ext of EXTS) {
        try { return await next(spec + ext, context); } catch (err) { lastErr = err; }
      }
      throw lastErr;
    }
  `)}`,
  import.meta.url,
);
