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
