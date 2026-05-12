import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

type Args = {
  text: string;
  image?: string;
  runs: number;
  timeoutMs: number;
  model: string;
  url: string;
  apiKey?: string;
  maxTokens?: number;
};

const DASH_SCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_TEXT = '昨天午餐 87.5 元，张三付的，三个人平摊';

function usage(): never {
  console.log(`Usage: pnpm ai:speed [options]

Options:
  --text <text>       Prompt text to send. Default: ${DEFAULT_TEXT}
  --image <path>      Optional image file to send as receipt context.
  --runs <n>          Number of requests to run. Default: 1
  --timeout <ms>      Per-request timeout in ms. Default: 30000
  --model <name>      Override AI_MODEL from .env.
  --url <url>         Override AI_API_URL from .env.
  --max-tokens <n>    Optional max_tokens for the model response.
  --help              Show this help.

Examples:
  pnpm ai:speed
  pnpm ai:speed -- --runs 3
  pnpm ai:speed -- --text "昨天火锅 328 元 李雷付"
  pnpm ai:speed -- --image ./receipt.jpg --timeout 60000
`);
  process.exit(0);
}

function readArgs(): Args {
  const model = process.env.AI_MODEL ?? 'deepseek-chat';
  const isDashScope =
    process.env.AI_PROVIDER?.toLowerCase() === 'aliyun' ||
    process.env.AI_PROVIDER?.toLowerCase() === 'dashscope' ||
    /qwen/i.test(model) ||
    process.env.AI_API_URL?.includes('dashscope.aliyuncs.com') === true;
  const args: Args = {
    text: DEFAULT_TEXT,
    runs: 1,
    timeoutMs: 30_000,
    model,
    url: process.env.AI_API_URL ?? (isDashScope ? DASH_SCOPE_URL : DEEPSEEK_URL),
    apiKey: process.env.AI_API_KEY ?? process.env.DASHSCOPE_API_KEY,
  };

  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    const next = () => {
      const value = raw[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case '--':
        break;
      case '--help':
      case '-h':
        usage();
      case '--text':
        args.text = next();
        break;
      case '--image':
        args.image = next();
        break;
      case '--runs':
        args.runs = Number(next());
        break;
      case '--timeout':
        args.timeoutMs = Number(next());
        break;
      case '--model':
        args.model = next();
        break;
      case '--url':
        args.url = next();
        break;
      case '--max-tokens':
        args.maxTokens = Number(next());
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!args.apiKey) throw new Error('AI_API_KEY or DASHSCOPE_API_KEY is required');
  if (!Number.isInteger(args.runs) || args.runs < 1) {
    throw new Error('--runs must be a positive integer');
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1_000) {
    throw new Error('--timeout must be an integer >= 1000');
  }
  if (args.maxTokens !== undefined && (!Number.isInteger(args.maxTokens) || args.maxTokens < 1)) {
    throw new Error('--max-tokens must be a positive integer');
  }

  return args;
}

function mimeFromPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

async function buildUserContent(args: Args) {
  if (!args.image) return args.text;

  const image = await readFile(args.image);
  const mime = mimeFromPath(args.image);
  return [
    { type: 'text' as const, text: args.text },
    {
      type: 'image_url' as const,
      image_url: { url: `data:${mime};base64,${image.toString('base64')}` },
    },
  ];
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!;
}

async function runOnce(args: Args, body: string, index: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  const startedAt = performance.now();

  try {
    const res = await fetch(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body,
      signal: controller.signal,
    });
    const headersMs = performance.now() - startedAt;
    const responseText = await res.text();
    const totalMs = performance.now() - startedAt;
    let contentChars: number | 'n/a' = 'n/a';
    let finishReason: string | 'n/a' = 'n/a';
    try {
      const json = JSON.parse(responseText) as {
        choices?: { message?: { content?: string }; finish_reason?: string }[];
      };
      const choice = json.choices?.[0];
      if (typeof choice?.message?.content === 'string') {
        contentChars = choice.message.content.length;
      }
      finishReason = choice?.finish_reason ?? 'n/a';
    } catch {
      // Keep the speed test focused on transport and model latency.
    }

    console.log(
      [
        `run=${index}`,
        `status=${res.status}`,
        `headers_ms=${Math.round(headersMs)}`,
        `total_ms=${Math.round(totalMs)}`,
        `response_bytes=${Buffer.byteLength(responseText)}`,
        `content_chars=${contentChars}`,
        `finish=${finishReason}`,
      ].join(' '),
    );
    return { ok: res.ok, totalMs };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = readArgs();
  const userContent = await buildUserContent(args);
  const body = JSON.stringify({
    model: args.model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    ...(args.maxTokens === undefined ? {} : { max_tokens: args.maxTokens }),
    messages: [
      {
        role: 'system',
        content:
          'Return one JSON object only with keys title, occurredAt, currency, amount, payerName, note, reasoning. Use null for unknown values.',
      },
      { role: 'user', content: userContent },
    ],
  });

  console.log(`model=${args.model}`);
  console.log(`host=${new URL(args.url).host}`);
  console.log(`runs=${args.runs}`);
  console.log(`text_chars=${args.text.length}`);
  if (args.image) console.log(`image=${basename(args.image)}`);
  console.log(`request_bytes=${Buffer.byteLength(body)}`);

  const results = [];
  for (let i = 1; i <= args.runs; i++) {
    results.push(await runOnce(args, body, i));
  }

  const successful = results.filter((r) => r.ok).map((r) => r.totalMs);
  if (successful.length > 0) {
    const avg = successful.reduce((sum, ms) => sum + ms, 0) / successful.length;
    console.log(
      [
        'summary',
        `ok=${successful.length}/${results.length}`,
        `avg_ms=${Math.round(avg)}`,
        `p50_ms=${Math.round(percentile(successful, 50))}`,
        `p95_ms=${Math.round(percentile(successful, 95))}`,
      ].join(' '),
    );
  } else {
    console.log(`summary ok=0/${results.length}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  if ((error as Error).name === 'AbortError') {
    console.error('Request timed out');
  } else {
    console.error((error as Error).message);
  }
  process.exit(1);
});
