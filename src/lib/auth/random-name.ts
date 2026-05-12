/**
 * Generates short, friendly random names for login credentials so the
 * user can tell multiple passwords / passkeys apart in the credential
 * list (e.g. "Brave Falcon", "Quiet River").
 *
 * Pure function, safe to call from server actions and client components.
 */

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
];

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
];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

/**
 * Two-word label, e.g. "Brave Falcon". Output stays under 32 chars so it
 * fits credential label storage limits comfortably.
 */
export function randomCredentialName(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}
