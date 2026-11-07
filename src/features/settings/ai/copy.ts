/** Settings › Coach copy (design/screens/settings-sync-ai.md §5). */
import type { Preset } from '@/ai';
import { formatNumber } from '@/components';

export const AI_COPY = {
  title: 'Coach',
  coachLabel: 'Coach',
  none: 'Off',
  offHelp: 'Choose a provider below and add its key to turn it on',
  providerLabel: 'Provider',
  customLabel: 'Custom endpoint',
  customNote: 'Any server with an OpenAI- or Anthropic-style API',
  siwcNote: 'Your ChatGPT plan, signed in on your server.',
  zenNote: 'A paid OpenCode Zen key, kept on your server.',
  nimNote: 'Your NVIDIA key, kept on your server.',
  viaServer: 'Through your server',
  /** The provider list's groups (r068 V5): hosted services, servers on this computer, any other endpoint. */
  hostedGroup: 'Hosted',
  localGroup: 'On this computer',
  otherGroup: 'Other',
  choose: 'Choose',
  chip: { needsServer: 'Needs your server', notSignedIn: 'Not signed in', signedIn: 'Signed in', expired: 'Sign-in expired', noKey: 'No key', keySet: 'Key set' },
  needsServer: 'This provider works through your server. Pair this device in Sync first.',
  needsServerShort: 'Pair this device with your server first.',
  pairServer: 'Open Sync',
  serverKeyHelp: (provider: string) =>
    `Your key is sent once to your server, kept there, and only ever sent to ${provider}. It never stays in this browser. It can spend money on your account: set a spending limit with ${provider}.`,
  serverKeySaved: 'Key set on your server',
  serverKeyNone: 'No key on your server yet',
  replaceKey: 'Replace key',
  removeServerKeyTitle: (provider: string) => `Remove the ${provider} key from your server?`,
  removeServerKeyBody: 'Every device stops using it.',
  siwcSignedIn: 'Signed in on your server',
  siwcPlan: (plan: string) => `${plan} plan`,
  siwcSignedOut: 'Not signed in yet. Whoever runs your server signs in once.',
  siwcSignOut: 'Sign out',
  siwcSignOutTitle: 'Sign out of ChatGPT on your server?',
  siwcSignOutBody: 'Every device stops using your ChatGPT plan.',
  manageUsage: 'Manage usage',
  manageUsageUrl: 'https://chatgpt.com/settings/usage',
  serverUnreachable: (provider: string) => `Your server isn't answering, so the Coach can't use ${provider} right now.`,
  serverModelsFailed: "Couldn't reach your server. Check that it is on, then try again.",
  cancel: 'Cancel',
  loadModels: 'Load the model list',
  loadingModels: 'Loading…',
  modelsLoaded: (n: number) => `${n} models listed by the provider.`,
  modelsFailed: (reason: string) => `Couldn't load the list: ${reason}`,
  vllmNote: 'Any OpenAI-compatible server you run',
  baseUrlLabel: 'Base URL',
  baseUrlHelp: 'https://, or http:// on this computer.',
  styleLabel: 'API style',
  styleHelp: 'OpenAI chat completions, OpenAI responses or Anthropic messages',
  keyLabel: 'API key',
  keyHelp: (provider: string) => `Kept on this device, encrypted, and only ever sent to ${provider}. It can spend money: set a spending limit with ${provider}.`,
  getKey: 'Get a key',
  saveKey: 'Save key',
  removeKey: 'Remove key',
  show: 'Show key',
  hide: 'Hide key',
  keySaved: (last4: string) => `Key saved · ends …${last4}`,
  keyNone: 'No key saved',
  keyMoved: 'Enter the key again for the new address.',
  keyEmpty: 'Paste the key first.',
  noKeyNeeded: 'No key needed.',
  checkConsent: (provider: string) => `Test connection sends three tiny requests to ${provider} (about 600 tokens) to see what this model can do.`,
  check: 'Test connection',
  checking: 'Checking…',
  modelLabel: 'Model',
  modelHelp: 'Pick from the list or type a model ID.',
  modelOther: 'Other model…',
  modelIdLabel: 'Model ID',
  visionLabel: 'Model for photos',
  visionHelp: "Optional. Reads food photos when the main model can't.",
  behaviourHeading: 'Coach behaviour',
  smallEditsLabel: 'Small plan edits without asking',
  smallEditsHelp: 'Moves of up to 3 days that add no load and change no safety setting.',
  capLabel: 'Monthly spending cap',
  capHelp: 'Warns at 80 %. Empty: no cap.',
  stopAtCapLabel: 'Stop the Coach at the cap',
  stopAtCapHelp: 'Off: warn only.',
  usageHeading: 'Usage',
  usageNote: 'estimate',
  spendInfo: "Spend is an estimate from the tokens each reply used and your provider's list price; your provider's invoice is the truth. The cap warns at 80 % and, if stop at cap is on, pauses the Coach at 100 %.",
  capWarn: (pct: number, cap: string) => `You've used ${pct} % of this month's cap (${cap}).`,
  capReached: (cap: string) => `You've reached this month's cap (${cap}).`,
  capPaused: 'The Coach is paused.',
  capWarnOnly: 'The Coach keeps working; stopping at the cap is off.',
  save: 'Save provider',
  saved: 'Saved.',
  remove: 'Remove provider',
  removed: 'Provider removed. The Coach is off.',
  needModel: 'Choose a model.',
  needKey: 'Save a key first.',
  sent: 'The Coach sends {provider} this conversation, the results of what it looks up in Vitals, and a short summary of your plan and recent days. Not your name or email. Photos only in the message you attach them to.',
} as const;

export const BADGE = {
  supported: 'Supported',
  basic: 'Basic — logs and answers only',
  chatOnly: "Chat only — can't use tools",
} as const;

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Error copy per provider error kind (§5.8). `provider` may be lower case ("your server"); sentences start capitalised. */
export function probeErrorText(kind: string | undefined, provider: string, corsFix?: string): string {
  const Provider = sentence(provider);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline && (kind === 'network' || kind === 'cors' || kind === 'blocked')) return "Can't check now — you're offline.";
  switch (kind) {
    case 'auth':
      return `${Provider} refused this key. Check it and try again.`;
    case 'model_not_found':
      return "That model isn't available on your account. Choose another.";
    case 'network':
      return `Couldn't reach ${provider}. Check the address and that the server is running.`;
    case 'cors':
    case 'blocked':
      // A browser reports "server not running" and "server refuses web pages" (CORS) as the same failure: say both.
      return `No answer from ${provider}: it may not be running or reachable, or it may not accept requests from a web page. ${
        corsFix ?? 'Check the address and that the server is running; if it is, choose a provider that runs through your Vitals server, or another provider.'
      }`;
    case 'quota':
      return `${Provider} says the account has no credit or hit its limit.`;
    case 'rate_limit':
    case 'overloaded':
      return `${Provider} is busy. Try again in a minute.`;
    default:
      return `The check didn't finish. Try again, or choose another model.`;
  }
}

/** The one line under a provider's name: only where it says what the provider needs (your own server, through the server). */
export function presetNote(p: Preset): string {
  if (p.id === 'siwc') return AI_COPY.siwcNote;
  if (p.id === 'opencode-zen') return AI_COPY.zenNote;
  if (p.id === 'nim') return AI_COPY.nimNote;
  if (p.id === 'vllm') return AI_COPY.vllmNote;
  return '';
}

export const TIER_WORD: Record<string, string> = {
  best: 'Best',
  balanced: 'Balanced',
  budget: 'Budget',
  free: 'Free, may be slow or unavailable',
  local: 'Local, free, basic',
  'text-only': 'Text only',
};

export const usd = (n: number) => `$${formatNumber(n, n >= 10 ? 0 : 2)}`;

/** Settings › Coach while this device is paired with the server, which runs the Coach (server-coach contract). */
export const SERVER_COACH_COPY = {
  title: 'Coach',
  label: 'Coach',
  value: 'On your server',
  checking: 'Checking…',
  available: (hours: number) => `Available · chats are deleted after ${hours} h`,
  unavailable: (reason: string, hours: number) => `${reason} · chats are deleted after ${hours} h`,
  off: 'Off on your server',
  unreachable: 'Your server can’t be reached',
  notSupported: 'Your server doesn’t run the Coach yet',
} as const;
