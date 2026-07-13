const ADJECTIVES = [
  'Brave',
  'Quiet',
  'Lucky',
  'Sunny',
  'Mellow',
  'Witty',
  'Calm',
  'Crisp',
  'Bold',
  'Cosy',
  'Vivid',
  'Gentle',
  'Swift',
  'Fuzzy',
  'Lively',
  'Zesty',
  'Clever',
  'Cheery',
  'Polite',
  'Honest',
] as const;

const NOUNS = [
  'Falcon',
  'River',
  'Lantern',
  'Sparrow',
  'Comet',
  'Orchid',
  'Pine',
  'Harbor',
  'Maple',
  'Otter',
  'Beacon',
  'Willow',
  'Glacier',
  'Meadow',
  'Cedar',
  'Pebble',
  'Robin',
  'Aurora',
  'Cloud',
  'Brook',
] as const;

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

export function randomCredentialName(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}
