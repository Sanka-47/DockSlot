import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_API_FALLBACK = 'http://localhost:5000/api';

function parseApiUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('VITE_API_URL must be a valid absolute URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('VITE_API_URL must use http or https.');
  }

  if (url.username || url.password) {
    throw new Error('VITE_API_URL must not include credentials.');
  }

  if (url.search || url.hash) {
    throw new Error('VITE_API_URL must not include a query string or fragment.');
  }

  if (url.pathname === '/' || url.pathname === '') {
    throw new Error('VITE_API_URL must include the API base path, for example /api.');
  }

  return url;
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

function buildContentSecurityPolicy(apiOrigin: string, isDevelopment: boolean): string {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    // Development needs the Vite HMR websocket. Production is limited to the API.
    `connect-src 'self' ${apiOrigin}${isDevelopment ? ' ws: http: https:' : ''}`,
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    // Vite's dev client injects an inline React Refresh preamble.
    `script-src 'self'${isDevelopment ? " 'unsafe-inline'" : ''}`,
    // Tailwind is emitted as a stylesheet, but React/toast components use
    // inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'none'",
  ];

  if (!isDevelopment) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

const commonHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-DNS-Prefetch-Control': 'off',
  'X-Frame-Options': 'DENY',
};

/**
 * Cloudflare Workers static assets (and Pages) read security headers from a
 * static `_headers` file in the build output. Generate that file from the same
 * validated API origin used by the bundle so the production CSP cannot drift
 * from `VITE_API_URL`.
 */
function buildCloudflareHeaders(apiOrigin: string): string {
  const headers = {
    ...commonHeaders,
    'Content-Security-Policy': buildContentSecurityPolicy(apiOrigin, false),
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  };

  return `/*\n${Object.entries(headers)
    .map(([name, value]) => `  ${name}: ${value}`)
    .join('\n')}\n`;
}

function cloudflareAssetsHeadersPlugin(apiOrigin: string): Plugin {
  return {
    name: 'dockslot-cloudflare-assets-headers',
    apply: 'build',
    async closeBundle() {
      await writeFile(
        join(process.cwd(), 'dist', '_headers'),
        buildCloudflareHeaders(apiOrigin),
        'utf8',
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // Any build is a deployable artifact; `vite preview` also runs in production
  // mode. Both must have an explicit HTTPS API URL.
  const isProduction = mode === 'production' || command === 'build';
  const env = loadEnv(mode, process.cwd(), '');
  const rawApiUrl = (env.VITE_API_URL || process.env.VITE_API_URL || '').trim();

  if (isProduction && !rawApiUrl) {
    throw new Error(
      'VITE_API_URL is required for production builds. Set it to the HTTPS API base URL, for example https://api.example.com/api.',
    );
  }

  const apiUrl = rawApiUrl ? parseApiUrl(rawApiUrl) : parseApiUrl(DEV_API_FALLBACK);

  if (isProduction && apiUrl.protocol !== 'https:') {
    throw new Error('VITE_API_URL must use HTTPS in production.');
  }

  if (isProduction && isLocalHostname(apiUrl.hostname)) {
    throw new Error('VITE_API_URL must not point at localhost in production.');
  }

  return {
    plugins: [react(), cloudflareAssetsHeadersPlugin(apiUrl.origin)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          // Keep large vendor families in stable chunks so route-level lazy
          // loading does not pull them into the initial app shell.
          codeSplitting: {
            groups: [
              {
                name: (id) => {
                  if (!id.includes('node_modules')) {
                    return null;
                  }

                  if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
                    return 'react-vendor';
                  }

                  if (/[\\/]node_modules[\\/](date-fns|date-fns-tz)[\\/]/.test(id)) {
                    return 'date-vendor';
                  }

                  if (/[\\/]node_modules[\\/]axios[\\/]/.test(id)) {
                    return 'http-vendor';
                  }

                  if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
                    return 'icons-vendor';
                  }

                  return 'vendor';
                },
              },
            ],
          },
        },
      },
    },
    server: {
      headers: {
        ...commonHeaders,
        'Content-Security-Policy': buildContentSecurityPolicy(apiUrl.origin, true),
      },
    },
    preview: {
      headers: {
        ...commonHeaders,
        'Content-Security-Policy': buildContentSecurityPolicy(apiUrl.origin, false),
        ...(isProduction
          ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload' }
          : {}),
      },
    },
  };
});
