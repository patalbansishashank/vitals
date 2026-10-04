/** Settings › AI provider copy (design/screens/settings-sync-ai.md §5). */
import type { Preset } from '@/ai';

export const AI_COPY = {
  title: 'AI provider',
  none: 'No AI provider. The Coach is off; everything else works and you can log by hand.',
  uiOnly: 'Only you can change this. Neither the Coach nor any agent can change providers, keys or safety settings.',
  providerLabel: 'provider',
  customLabel: 'Custom endpoint',
  customNote: 'Any server with an OpenAI- or Anthropic-style API.',
  siwcNote: 'Uses your ChatGPT plan instead of an API key. Your server signs in and sends the requests.',
  zenNote: 'Your OpenCode Zen key, kept on your server. The free tier only works inside OpenCode, so a paid key is needed here.',
  nimNote: 'Your NVIDIA key, kept on your server.',
  viaServer: 'via your server',
  chip: { needsServer: 'needs your server', notSignedIn: 'not signed in', signedIn: 'signed in', expired: 'sign-in expired', noKey: 'no key', keySet: 'key set' },
  needsServer: 'This provider works through your server. Pair this device with your server first.',
  needsServerShort: 'Pair this device with your server first.',
  pairServer: 'Pair a server',
  serverKeyHelp: (provider: string) =>
    `Your key is sent once to your server, kept there, and only ever sent to ${provider}. It never stays in this browser. It can spend money on your account: set a spending limit with ${provider}.`,
  serverKeySaved: 'key set on your server',
  serverKeyNone: 'no key on your server yet',
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
  serverUsage: 'counted by your server for all your devices',
  cancel: 'Cancel',
  loadModels: 'Load the model list',
  loadingModels: 'Loading…',
  modelsLoaded: (n: number) => `${n} models listed by the provider.`,
  modelsFailed: (reason: string) => `Couldn't load the list: ${reason}`,
  localNote: 'Free, private, runs on your computer. Simpler models can log and answer, not re-plan.',
  vllmNote: 'Any OpenAI-compatible server you run.',
  keyNote: 'Your API key.',
  baseUrlLabel: 'base URL',
  baseUrlHelp: 'https://, or http:// on this computer.',
  styleLabel: 'API style',
  keyLabel: 'API key',
  keyHelp: (provider: string) =>
    `Your key stays on this device, encrypted, and is only ever sent to ${provider}. It can spend money on your account: set a spending limit with ${provider} (for example a monthly project limit). Encryption protects against lost backups and exports; it can't protect against malicious browser extensions or someone using your unlocked device.`,
  getKey: 'Get a key',
  saveKey: 'Save key',
  removeKey: 'Remove key',
  show: 'Show key',
  hide: 'Hide key',
  keySaved: (last4: string) => `key saved • ends …${last4}`,
  keyNone: 'no key saved',
  keyMoved: 'Enter the key again for the new address.',
  keyEmpty: 'Paste the key first.',
  noKeyNeeded: 'No key needed.',
  checkHeading: 'check what the model can do',
  checkConsent: (provider: string) => `Check what this model can do? This sends three tiny test requests to ${provider} (about 600 tokens).`,
  check: 'Test connection',
  checking: 'Checking…',
  modelLabel: 'model',
  modelHelp: 'Pick from the list or type a model id.',
  modelOther: 'Other model…',
  modelIdLabel: 'model id',
  visionLabel: 'model for photos',
  visionHelp: 'Optional: a second model that reads food photos when the main one cannot.',
  behaviourHeading: 'coach behaviour',
  smallEditsLabel: 'small plan edits without asking',
  smallEditsHelp:
    "Only moves of up to 3 days that don't add load and don't change any safety setting. Anything else is always a proposal you approve.",
  capLabel: 'monthly spending cap',
  capHelp: 'Warns at 80 %. Leave empty for no cap.',
  stopAtCapLabel: 'stop the Coach at the cap',
  stopAtCapHelp: 'Off: warn only.',
  usageHeading: 'usage',
  usageNote: "estimated; your provider's bill is the truth",
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

export function presetNote(p: Preset): string {
  if (p.id === 'siwc') return AI_COPY.siwcNote;
  if (p.id === 'opencode-zen') return AI_COPY.zenNote;
  if (p.id === 'nim') return AI_COPY.nimNote;
  if (p.id === 'ollama' || p.id === 'lmstudio') return AI_COPY.localNote;
  if (p.id === 'vllm') return AI_COPY.vllmNote;
  if (p.id === 'openai') return 'Your API key. Billed by OpenAI, separate from a ChatGPT subscription.';
  if (p.id === 'openrouter') return 'One key for many models, including free ones.';
  return AI_COPY.keyNote;
}

export const TIER_WORD: Record<string, string> = {
  best: 'best',
  balanced: 'balanced',
  budget: 'budget',
  free: 'free — may be slow or unavailable',
  local: 'local — free, basic',
  'text-only': 'text only',
};

export const usd = (n: number) => (n >= 10 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);
