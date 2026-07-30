import { readFile } from 'node:fs/promises';

type EnvironmentConfig = {
  name?: string;
  vars?: Record<string, string>;
  hyperdrive?: Array<{ binding?: string; id?: string }>;
  browser?: { binding?: string };
  durable_objects?: { bindings?: Array<{ name?: string; class_name?: string }> };
};

type WranglerConfig = {
  env?: { production?: EnvironmentConfig };
};

// wrangler.jsonc is JSONC: it may carry comments and trailing commas, which
// JSON.parse rejects. Strip both while leaving string literals untouched.
function stripJsonc(source: string): string {
  let output = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      const start = index;
      index += 1;
      while (index < source.length && source[index] !== '"') {
        index += source[index] === '\\' ? 2 : 1;
      }
      index += 1;
      output += source.slice(start, index);
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    output += char;
    index += 1;
  }
  return output.replace(/,(?=\s*[}\]])/gu, '');
}

async function main() {
  const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  let config: WranglerConfig;
  try {
    config = JSON.parse(stripJsonc(source)) as WranglerConfig;
  } catch {
    throw new Error('wrangler.jsonc must remain valid JSONC so deployment validation can parse it');
  }

  const production = config.env?.production;
  if (!production) throw new Error('wrangler.jsonc is missing env.production');

  const failures: string[] = [];
  const hyperdrive = production.hyperdrive?.find((binding) => binding.binding === 'HYPERDRIVE');
  if (!hyperdrive?.id || /^0+$/u.test(hyperdrive.id) || /replace/i.test(hyperdrive.id)) {
    failures.push('set env.production.hyperdrive[HYPERDRIVE].id');
  }

  const appUrl = production.vars?.APP_URL;
  if (!appUrl || !appUrl.startsWith('https://') || /replace-me|localhost/iu.test(appUrl)) {
    failures.push('set env.production.vars.APP_URL to the final HTTPS origin');
  }
  if (production.vars?.ENVIRONMENT !== 'production') {
    failures.push('set env.production.vars.ENVIRONMENT to production');
  }

  if (production.browser?.binding !== 'BROWSER') {
    failures.push('configure the production BROWSER binding');
  }
  const durableBindings = new Set(
    production.durable_objects?.bindings?.map((binding) => binding.name) ?? [],
  );
  for (const binding of ['GROUP_ROOMS', 'RATE_LIMITER']) {
    if (!durableBindings.has(binding)) failures.push(`configure the production ${binding} binding`);
  }

  if (production.vars?.OIDC_ISSUER !== 'https://auth.pangda.app') {
    failures.push('set env.production.vars.OIDC_ISSUER to https://auth.pangda.app');
  }
  if (!production.vars?.OIDC_CLIENT_ID) {
    failures.push('set env.production.vars.OIDC_CLIENT_ID');
  }
  if (production.vars?.OIDC_RESOURCE !== 'https://aaeasy.pangda.app') {
    failures.push('set env.production.vars.OIDC_RESOURCE to https://aaeasy.pangda.app');
  }

  if (failures.length > 0) {
    throw new Error(
      `Cloudflare production configuration is incomplete:\n- ${failures.join('\n- ')}`,
    );
  }
  console.log(`Cloudflare production configuration is ready for ${production.name ?? 'aaeasy'}.`);
}

await main();
