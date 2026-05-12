/* eslint-disable */
// Generate solid-color placeholder PNG icons for the PWA.
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });

const svg = (size: number) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.22}" fill="#0a0a0a"/>
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle"
        font-family="Helvetica, Arial, sans-serif" font-weight="700"
        font-size="${size * 0.42}" fill="#ffffff">AA</text>
</svg>`;

async function main() {
  for (const size of [192, 512]) {
    const png = await sharp(Buffer.from(svg(size))).png().toBuffer();
    writeFileSync(`public/icon-${size}.png`, png);
    console.log(`wrote public/icon-${size}.png`);
  }
  // Apple touch icon (180x180)
  const apple = await sharp(Buffer.from(svg(180))).png().toBuffer();
  writeFileSync('public/apple-icon.png', apple);
  console.log('wrote public/apple-icon.png');
  // Favicon
  const favicon = await sharp(Buffer.from(svg(64))).png().toBuffer();
  writeFileSync('public/favicon-32x32.png', favicon);
  console.log('wrote public/favicon-32x32.png');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
