/**
 * The endpoint's `/blobs` API as a `BlobBackend` (R7 §3, §4.1): create-only `PUT` with `If-None-Match: *`, `GET`,
 * `HEAD`, all under `{base}/blobs/{ownerIdHash}/{chunkId}` with `Authorization: Bearer <K_auth>`.
 * Network goes through the injected `NetPort` only.
 */
import { buf } from '../crypto';
import type { BlobBackend, NetPort, VitalsKeys } from '../types';
import { assertChunkId } from './ids';

export type BlobErrorCode = 'blob_auth' | 'blob_too_large' | 'blob_server' | 'blob_http' | 'blob_network';

/** Error carrying a machine-readable `code` (and the HTTP status when there was one). */
export class BlobEndpointError extends Error {
  readonly code: BlobErrorCode;
  readonly status?: number;
  constructor(code: BlobErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'BlobEndpointError';
    this.code = code;
    this.status = status;
  }
}

export interface RemoteBlobBackendOptions {
  /** `https://host[:port]`; a trailing `/sync` or `/` is ignored and `ws(s)://` becomes `http(s)://`. */
  baseUrl: string;
  keys: VitalsKeys;
  net: NetPort;
}

export function normalizeBlobBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '').replace(/\/sync$/, '');
}

function statusError(status: number, what: string): BlobEndpointError {
  if (status === 401 || status === 403) return new BlobEndpointError('blob_auth', `The sync endpoint refused the credentials (${status}) for ${what}.`, status);
  if (status === 413) return new BlobEndpointError('blob_too_large', `The sync endpoint rejected ${what} as too large (413).`, status);
  if (status === 507) return new BlobEndpointError('blob_server', `The sync endpoint is out of space or over quota (507) for ${what}.`, status);
  if (status >= 500) return new BlobEndpointError('blob_server', `The sync endpoint failed (${status}) for ${what}.`, status);
  return new BlobEndpointError('blob_http', `Unexpected response ${status} for ${what}.`, status);
}

export function createRemoteBlobBackend({ baseUrl, keys, net }: RemoteBlobBackendOptions): BlobBackend {
  const base = normalizeBlobBaseUrl(baseUrl);
  const auth = `Bearer ${keys.authToken}`;

  const request = async (method: 'PUT' | 'GET' | 'HEAD', chunkId: string, init: RequestInit = {}): Promise<Response> => {
    assertChunkId(chunkId);
    const url = `${base}/blobs/${keys.ownerIdHash}/${chunkId}`;
    net.assertAllowed(url);
    try {
      return await net.fetch(url, { ...init, method, headers: { Authorization: auth, ...(init.headers as Record<string, string> | undefined) } });
    } catch (e) {
      throw new BlobEndpointError('blob_network', `Could not reach the sync endpoint: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return {
    async put(chunkId, sealed) {
      const res = await request('PUT', chunkId, {
        headers: { 'If-None-Match': '*', 'Content-Type': 'application/octet-stream' },
        body: buf(sealed),
      });
      if (res.status === 201 || res.status === 200 || res.status === 204) return 'created';
      if (res.status === 412) return 'exists';
      throw statusError(res.status, `upload of ${chunkId}`);
    },
    async get(chunkId) {
      const res = await request('GET', chunkId);
      if (res.status === 200) return new Uint8Array(await res.arrayBuffer());
      if (res.status === 404) return null;
      throw statusError(res.status, `download of ${chunkId}`);
    },
    async has(chunkId) {
      const res = await request('HEAD', chunkId);
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      throw statusError(res.status, `lookup of ${chunkId}`);
    },
  };
}
