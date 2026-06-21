/**
 * Circles RPC helpers (read-only).
 *
 * Profile lookup is a PUBLIC read against the Circles RPC — no wallet needed.
 * The only thing that touches the wallet is signing, and that happens entirely
 * inside the connector iframe (see main.js `sign_message`).
 *
 * Method names / field names verified against the SDK source at
 * /Users/mark/Gnosis/Circles/new-sdk (packages/rpc, packages/types).
 */
import { getAddress, isAddress } from 'viem';

export const CIRCLES_RPC_URL = 'https://rpc.aboutcircles.com/';

let _id = 0;
async function rpc(method, params) {
  const res = await fetch(CIRCLES_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++_id, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message ?? 'error'}`);
  return json.result;
}

/** Load a single Circles profile. Returns { name, previewImageUrl, ... } or null. */
export function getProfile(address) {
  return rpc('circles_getProfileByAddress', [address.toLowerCase()]);
}

export { isAddress, getAddress };
