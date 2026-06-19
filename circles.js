/**
 * Circles RPC + transfer helpers (read-only RPC + calldata encoding).
 *
 * These are pure host-side helpers: profile lookup, recipient search, and ERC-20
 * Circles balances are all PUBLIC reads against the Circles RPC — no wallet needed.
 * The only thing that touches the wallet is the transfer, and even that is just
 * calldata we hand to the connector iframe to sign & send via the Safe.
 *
 * Method names / field names verified against the SDK source at
 * /Users/mark/Gnosis/Circles/new-sdk (packages/rpc, packages/types).
 */
import { encodeFunctionData, getAddress, isAddress, parseEther, formatEther } from 'viem';

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

/**
 * Search avatars by name OR address prefix. Uses circles_searchProfiles (legacy,
 * offset-based) because each row reliably carries `address` and `avatarType` —
 * exactly what a recipient picker needs. Returns SearchResultProfile[].
 */
export function searchProfiles(query, { limit = 10, offset = 0, avatarTypes } = {}) {
  const params = [String(query).toLowerCase(), limit, offset];
  if (avatarTypes) params.push(avatarTypes);
  return rpc('circles_searchProfiles', params).then((r) => (Array.isArray(r) ? r : []));
}

/**
 * Fetch an avatar's token balances, filtered to ERC-20 Circles wrappers only.
 * Each returned row:
 *   { tokenAddress, tokenOwner, tokenType, isInflationary, attoCircles, staticAttoCircles, circles, staticCircles }
 * `tokenAddress` is the ERC-20 contract to call `transfer` on.
 */
export async function getErc20Balances(avatar) {
  const rows = await rpc('circles_getTokenBalances', [avatar]);
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r.isErc20 === true);
}

/**
 * The on-chain ERC-20 balance unit for a wrapper row, as a bigint of 18-decimal units:
 *   - demurrage wrapper  → attoCircles
 *   - inflationary wrapper → staticAttoCircles
 * (Raw RPC returns these as decimal strings.)
 */
export function erc20BalanceWei(row) {
  const raw = row.isInflationary ? row.staticAttoCircles : row.attoCircles;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

/** Human-readable balance (CRC) for a wrapper row. */
export function erc20BalanceDisplay(row) {
  return formatEther(erc20BalanceWei(row));
}

/** Convert a user-entered CRC amount (e.g. "1.5") to 18-decimal wei. Throws on bad input. */
export function crcToWei(amount) {
  const trimmed = String(amount).trim();
  if (!trimmed || Number(trimmed) <= 0 || Number.isNaN(Number(trimmed))) {
    throw new Error('Enter a positive amount');
  }
  return parseEther(trimmed);
}

const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
];

/**
 * Build the single transaction for a plain ERC-20 Circles transfer.
 * A direct wrapper `transfer` bypasses the Hub, trust graph, and pathfinder entirely —
 * it's a standard ERC-20 token move. Returns { to, data, value } for send_transactions.
 */
export function buildErc20Transfer({ tokenAddress, recipient, amountWei }) {
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [getAddress(recipient), amountWei],
  });
  return { to: getAddress(tokenAddress), data, value: '0' };
}

export { isAddress, getAddress };
