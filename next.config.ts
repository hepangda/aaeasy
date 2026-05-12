import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Tracing must cover BOTH the canonical `node_modules/@expo-google-fonts/...`
  // path (where the symlink lives in pnpm projects) AND the real file at
  // `node_modules/.pnpm/@expo-google-fonts+noto-sans-sc@*/node_modules/...`,
  // because Vercel's bundler frequently drops the top-level symlink and the
  // function ends up only seeing the resolved path.
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf',
      './node_modules/@expo-google-fonts/noto-sans-sc/700Bold/NotoSansSC_700Bold.ttf',
      './node_modules/.pnpm/@expo-google-fonts+noto-sans-sc@*/node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf',
      './node_modules/.pnpm/@expo-google-fonts+noto-sans-sc@*/node_modules/@expo-google-fonts/noto-sans-sc/700Bold/NotoSansSC_700Bold.ttf',
    ],
    '/api/groups/[id]/export': [
      './node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf',
      './node_modules/@expo-google-fonts/noto-sans-sc/700Bold/NotoSansSC_700Bold.ttf',
      './node_modules/.pnpm/@expo-google-fonts+noto-sans-sc@*/node_modules/@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf',
      './node_modules/.pnpm/@expo-google-fonts+noto-sans-sc@*/node_modules/@expo-google-fonts/noto-sans-sc/700Bold/NotoSansSC_700Bold.ttf',
    ],
  },
};

export default withNextIntl(nextConfig);
