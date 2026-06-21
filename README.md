# crc-signin login demo

A standalone third-party website ("Northwind") that logs users in by embedding the
Circles **`/crc-signin`** connector in an `<iframe>`. The host site never touches the
user's passkey or keys — it only receives the connected address over `postMessage`.

This is a minimal, framework-free integration example: copy `index.html` + `main.js`
into any site to add "Log in with Circles".

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5183.

The iframe defaults to the deployed connector (`https://circles-dev.gnosis.io/crc-signin`).
Override it with `?host=...` or the on-page "Connector host" box.

## Login flow

1. The page embeds `<iframe src="https://<host>/crc-signin">` and grants WebAuthn via
   `allow="publickey-credentials-get *; publickey-credentials-create *"`.
2. The connector posts `crc_bridge_ready`; the page replies `request_address`.
3. The user clicks **Log in** (existing passkey) or **Create account** (new) inside the
   iframe and completes the device passkey.
4. The connector posts `wallet_connected` with the address; the page switches to its
   signed-in view.

Wire format is identical to [`@aboutcircles/miniapp-sdk`](https://www.npmjs.com/package/@aboutcircles/miniapp-sdk),
so no SDK dependency is required.

## After login: profile + two modes

Once connected, the page loads the avatar's Circles profile via
`circles_getProfileByAddress`, then offers two modes (switchable with the tabs at
the top of the signed-in view):

### Mode 1 — Send a transaction (ERC-20 transfer)

- **ERC-20 balances** — lists the avatar's token balances via
  `circles_getTokenBalances`, filtered to `isErc20 === true` (ERC-1155 raw Hub
  tokens are excluded). Pick one to send.
- **Recipient search** — type a name to search avatars via
  `circles_searchProfiles` (returns address + avatarType), or paste a raw address.
- **Transfer** — builds a plain ERC-20 `transfer(address,uint256)` calldata
  (`circles.js`) and posts it to the connector as `send_transactions`. The
  connector shows its approval popup and sends it via the user's Safe, then
  replies `tx_success` / `tx_rejected`.

All RPC reads (profile, search, balances) are **public** and happen directly on
this site; only the transfer touches the wallet, and only through the iframe. A
direct ERC-20 wrapper transfer bypasses the Hub, trust graph, and pathfinder — it
is a standard token move.

> The connected account needs at least one **ERC-20 wrapped** Circles token with a
> non-zero balance for the transfer to be possible. Wrap some Circles to ERC-20 in
> the Circles app first if the list is empty.

### Mode 2 — Sign text (no transaction)

The user types any text, picks a signature type, and clicks **Sign message**. The
page posts `{ type: 'sign_message', requestId, message, signatureType }` to the
connector, which prompts the passkey, signs via the user's Safe, and replies
`sign_success` with `{ signature, verified }` (or `sign_rejected`). Nothing is
sent on-chain and no gas is spent — the only wallet interaction is the signature.

| Type | What the connector does | Verifiable on-chain |
| --- | --- | --- |
| `erc1271` (default) | Safe smart-account signature over `hashMessage(msg)` | ✅ via `isValidSignature` — `verified` is reported `true` |
| `raw` | raw owner/passkey signature over the EIP-191 message hash | — |

RPC: `https://rpc.aboutcircles.com/`.

## Passkeys & origin (important)

WebAuthn passkeys are bound to a **Relying Party ID** = the registrable domain
(`gnosis.io`), and a cross-origin iframe authenticates against **its own** origin's RP
ID, not the parent site's. Consequences:

| Connector served from | Existing Circles passkey found on "Log in"? |
| --- | --- |
| any `*.gnosis.io` host (incl. embedded in any third-party site) | ✅ yes — RP ID is `gnosis.io` |
| `localhost` | ❌ no — RP ID is `localhost`; use **Create account** |
| a non-`gnosis.io` domain | ❌ no — RP ID is that domain |

So to embed real Circles login on **your** website, point the iframe at a
`*.gnosis.io` connector host and add the `allow=` attribute. The embedding site can be
any domain; only the **connector's** host must be under `gnosis.io`. Both pages must be
served over **HTTPS** (localhost is the only HTTP exception).

## Related

- Connector route: `Circles/newCore/src/routes/crc-signin/+page.svelte`
- In-repo demo with sign/tx actions: `Circles/newCore/examples/crc-signin-demo`
