// Reads qa/local.config.json (git-ignored; shape in qa/local.config.example.json) merged with VITALS_QA_* overrides.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../../local.config.json', import.meta.url));

const ENV = {
  VITALS_QA_SERVER_URL: 'serverUrl',
  VITALS_QA_SERVER_HOST: 'serverHost',
  VITALS_QA_SERVER_SSH: 'serverSsh',
  VITALS_QA_SERVER_IP4: 'serverIp4',
  VITALS_QA_SERVER_IP6: 'serverIp6',
  VITALS_QA_PC_HOST: 'pcHost',
  VITALS_QA_PC_IP4: 'pcIp4',
  VITALS_QA_SITE_URL: 'siteUrl',
  VITALS_QA_OWNER_PERSON_ID: 'ownerPersonId',
};

/** The local QA settings. `required` lists keys that must be set; a missing one throws a plain error. */
export function localConfig(required = []) {
  const cfg = {};
  if (existsSync(FILE)) {
    const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) if (k !== '_comment' && v !== '' && v != null) cfg[k] = v;
  }
  for (const [name, key] of Object.entries(ENV)) if (process.env[name]) cfg[key] = process.env[name];
  for (const key of required) {
    if (cfg[key] == null || cfg[key] === '') {
      throw new Error(`qa/local.config.json is missing ${key}; copy qa/local.config.example.json and fill it in`);
    }
  }
  return cfg;
}

/** The server address (https://host:port), the common case. */
export function serverUrl() {
  return localConfig(['serverUrl']).serverUrl;
}

/** The server address with another port, for a second server on the same host. */
export function serverUrlWithPort(port) {
  const u = new URL(serverUrl());
  u.port = String(port);
  return u.origin;
}
