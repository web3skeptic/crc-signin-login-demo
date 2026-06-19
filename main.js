/**
 * Northwind — login-with-Circles demo (third-party host side).
 *
 * Minimal, framework-free example of logging a user in by embedding the Circles
 * /crc-signin connector in an iframe and listening for its postMessage events.
 * This file is what a real third-party website would write.
 *
 * Login flow:
 *   1. Embed <iframe src="https://<host>/crc-signin"> with the WebAuthn
 *      Permissions-Policy granted (see index.html `allow=`).
 *   2. The connector posts `crc_bridge_ready` when it mounts. We reply with
 *      `request_address`.
 *   3. The user clicks "Log in" / "Create account" inside the iframe and completes
 *      their passkey. The connector posts `wallet_connected` with the address.
 *   4. We swap the UI to the signed-in state. Done — no keys ever touched here.
 *
 * The wire format is identical to @aboutcircles/miniapp-sdk, so no SDK is needed.
 *
 * NOTE on passkeys: an EXISTING Circles passkey is only found when the connector
 * is served from a *.gnosis.io host (passkeys are bound to RP ID `gnosis.io`).
 * On localhost or a non-gnosis host, "Log in" can't find it — use "Create account",
 * which mints a fresh passkey bound to that host's domain.
 */

const DEFAULT_HOST = 'https://circles-dev.gnosis.io';
const params = new URLSearchParams(location.search);
let connectorHost = params.get('host') || localStorage.getItem('crc-login-host') || DEFAULT_HOST;

const frame = document.getElementById('crc-frame');
const hostInput = document.getElementById('host-input');
const signedOut = document.getElementById('signed-out');
const signedIn = document.getElementById('signed-in');
const addrValue = document.getElementById('addr-value');
const logoutBtn = document.getElementById('logout-btn');
const logEl = document.getElementById('log');

let connectedAddress = null;

// ── Logging ──────────────────────────────────────────────────────────────────
function log(dir, msg) {
  const time = new Date().toLocaleTimeString();
  const arrow = dir === 'in' ? '←' : dir === 'out' ? '→' : '·';
  logEl.textContent += `[${time}] ${arrow} ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function frameSrc(host) {
  return `${host.replace(/\/$/, '')}/crc-signin`;
}

function postToFrame(data) {
  // In production, target the connector origin instead of '*'.
  frame.contentWindow?.postMessage(data, '*');
  log('out', JSON.stringify(data));
}

// ── Incoming messages from the connector iframe ───────────────────────────────
window.addEventListener('message', (event) => {
  // In production, verify event.origin matches the connector host here.
  const d = event.data;
  if (!d || !d.type) return;

  switch (d.type) {
    case 'crc_bridge_ready':
      log('in', 'crc_bridge_ready — connector mounted');
      postToFrame({ type: 'request_address' });
      break;

    case 'wallet_connected':
      log('in', `wallet_connected: ${d.address}`);
      connectedAddress = d.address;
      renderSignedIn();
      break;

    case 'wallet_disconnected':
      log('in', 'wallet_disconnected');
      connectedAddress = null;
      renderSignedOut();
      break;
  }
});

// ── UI ─────────────────────────────────────────────────────────────────────────
function renderSignedIn() {
  if (!connectedAddress) return;
  addrValue.textContent = connectedAddress;
  signedOut.hidden = true;
  signedIn.hidden = false;
}

function renderSignedOut() {
  signedOut.hidden = false;
  signedIn.hidden = true;
}

// "Log out" here is a host-side concept: we forget the address. The Circles
// session inside the iframe is independent; reloading the iframe drops it too.
logoutBtn.addEventListener('click', () => {
  connectedAddress = null;
  renderSignedOut();
  // Reload the connector so its own wallet state resets as well.
  frame.src = frameSrc(connectorHost);
  log('·', 'logged out (host-side) and reloaded connector');
});

document.getElementById('clear-log').addEventListener('click', () => {
  logEl.textContent = '';
});

// ── Host picker (point the iframe at local or deployed connector) ──────────────
function applyHost(host) {
  connectorHost = host.replace(/\/$/, '');
  localStorage.setItem('crc-login-host', connectorHost);
  hostInput.value = connectorHost;
  connectedAddress = null;
  renderSignedOut();
  frame.src = frameSrc(connectorHost);
  log('·', `loading connector: ${frame.src}`);
}

document.getElementById('host-apply').addEventListener('click', () =>
  applyHost(hostInput.value.trim() || DEFAULT_HOST)
);
hostInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyHost(hostInput.value.trim() || DEFAULT_HOST);
});

// ── Boot ────────────────────────────────────────────────────────────────────────
applyHost(connectorHost);
renderSignedOut();
