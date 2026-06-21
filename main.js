/**
 * Northwind — sign-text-with-Circles demo (third-party host side).
 *
 * Framework-free example of: (1) connecting a user by embedding the Circles
 * /crc-signin connector in an iframe, (2) loading their Circles profile, and
 * (3) asking the connector to SIGN ARBITRARY TEXT (not a transaction).
 *
 * Connect flow:
 *   1. Embed <iframe src="https://<host>/crc-signin"> with the WebAuthn
 *      Permissions-Policy granted (see index.html `allow=`).
 *   2. The connector posts `crc_bridge_ready`; we reply `request_address`.
 *   3. The user completes their passkey; the connector posts `wallet_connected`.
 *
 * Sign flow (the wallet only ever touches THIS one step):
 *   - The profile read is a PUBLIC RPC read — done here directly.
 *   - We post `sign_message` to the connector with the text and a signature type.
 *     The connector prompts the passkey, signs via the user's Safe, and replies
 *     `sign_success` with { signature, verified } (or `sign_rejected`).
 *
 * Signature types (matched to the connector's iframeHost protocol):
 *   - 'erc1271' → Safe smart-account signature, verifiable on-chain via
 *     isValidSignature(hashMessage(msg), sig). `verified` is reported true.
 *   - 'raw'     → raw owner/passkey signature over the EIP-191 message hash.
 *
 * Wire format is identical to @aboutcircles/miniapp-sdk, so no SDK is needed.
 *
 * NOTE on passkeys: an EXISTING Circles passkey is only found when the connector
 * is served from a *.gnosis.io host (passkeys are bound to RP ID `gnosis.io`).
 */
import { getProfile, getAddress } from './circles.js';

const DEFAULT_HOST = 'https://circles-dev.gnosis.io';
const params = new URLSearchParams(location.search);
let connectorHost = params.get('host') || localStorage.getItem('crc-login-host') || DEFAULT_HOST;

const $ = (id) => document.getElementById(id);
const frame = $('crc-frame');
const hostInput = $('host-input');
const signedOut = $('signed-out');
const signedIn = $('signed-in');
const logEl = $('log');

// Signed-in subviews
const profileAvatar = $('profile-avatar');
const profileName = $('profile-name');
const profileAddr = $('profile-addr');
const messageInput = $('message-input');
const signBtn = $('sign-btn');
const signStatus = $('sign-status');
const signResult = $('sign-result');

// ── State ─────────────────────────────────────────────────────────────────────
let connectedAddress = null;
let signReqCounter = 0;
const pendingSign = {}; // requestId -> { resolve, reject }

// ── Logging ────────────────────────────────────────────────────────────────────
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
  frame.contentWindow?.postMessage(data, '*');
  log('out', JSON.stringify(data));
}

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

function avatarInitial(name, addr) {
  if (name) return name.trim().charAt(0).toUpperCase();
  return addr ? addr.slice(2, 4).toUpperCase() : '?';
}

function selectedSigType() {
  return document.querySelector('input[name="sig-type"]:checked')?.value || 'erc1271';
}

// ── Ask the connector to sign a message and await its result ─────────────────────
function requestSignature(message, signatureType) {
  return new Promise((resolve, reject) => {
    const requestId = 'sign_' + ++signReqCounter;
    pendingSign[requestId] = { resolve, reject };
    postToFrame({ type: 'sign_message', requestId, message, signatureType });
  });
}

// ── Incoming messages from the connector iframe ─────────────────────────────────
window.addEventListener('message', (event) => {
  const d = event.data;
  if (!d || !d.type) return;

  switch (d.type) {
    case 'crc_bridge_ready':
      log('in', 'crc_bridge_ready — connector mounted');
      postToFrame({ type: 'request_address' });
      break;

    case 'wallet_connected':
      log('in', `wallet_connected: ${d.address}`);
      connectedAddress = getAddress(d.address);
      renderSignedIn();
      loadAccount();
      break;

    case 'wallet_disconnected':
      log('in', 'wallet_disconnected');
      connectedAddress = null;
      renderSignedOut();
      break;

    case 'sign_success':
      log('in', `sign_success: verified=${d.verified} sig=${shortAddr(d.signature)}`);
      pendingSign[d.requestId]?.resolve({ signature: d.signature, verified: d.verified });
      delete pendingSign[d.requestId];
      break;

    case 'sign_rejected':
      log('in', `sign_rejected: ${d.reason ?? d.error}`);
      pendingSign[d.requestId]?.reject(new Error(d.reason ?? d.error ?? 'Rejected'));
      delete pendingSign[d.requestId];
      break;
  }
});

// ── Top-level view switch ───────────────────────────────────────────────────────
function renderSignedIn() {
  signedOut.hidden = true;
  signedIn.hidden = false;
}

function renderSignedOut() {
  signedOut.hidden = false;
  signedIn.hidden = true;
}

// ── Load profile for the connected account ──────────────────────────────────────
async function loadAccount() {
  profileAddr.textContent = connectedAddress;
  profileName.textContent = 'Loading…';
  profileAvatar.textContent = avatarInitial('', connectedAddress);
  profileAvatar.style.backgroundImage = '';
  updateSignState();

  // Profile (non-fatal if missing)
  try {
    const p = await getProfile(connectedAddress);
    profileName.textContent = p?.name || 'Unnamed account';
    profileAvatar.textContent = p?.previewImageUrl ? '' : avatarInitial(p?.name, connectedAddress);
    profileAvatar.style.backgroundImage = p?.previewImageUrl ? `url("${p.previewImageUrl}")` : '';
  } catch (e) {
    profileName.textContent = 'Unnamed account';
    log('·', `profile load failed: ${e.message}`);
  }
}

// ── Sign ────────────────────────────────────────────────────────────────────────
function updateSignState() {
  signBtn.disabled = !connectedAddress || !messageInput.value.trim();
}

messageInput.addEventListener('input', updateSignState);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderResult({ message, signatureType, signature, verified }) {
  const verifiedBadge =
    verified === true
      ? '<span class="verified-badge ok">verified ✓</span>'
      : verified === false
        ? '<span class="verified-badge no">not verified</span>'
        : '';
  signResult.innerHTML = `
    <dl class="result-grid">
      <dt>Type</dt><dd><code>${escapeHtml(signatureType)}</code> ${verifiedBadge}</dd>
      <dt>Signer</dt><dd><code>${escapeHtml(connectedAddress)}</code></dd>
      <dt>Message</dt><dd><pre class="result-msg">${escapeHtml(message)}</pre></dd>
      <dt>Signature</dt><dd><code class="result-sig">${escapeHtml(signature)}</code></dd>
    </dl>`;
}

signBtn.addEventListener('click', async () => {
  const message = messageInput.value;
  if (!message.trim() || !connectedAddress) return;
  const signatureType = selectedSigType();

  signStatus.textContent = '';
  signStatus.className = 'tx-status';

  signBtn.disabled = true;
  signBtn.textContent = 'Confirm in the Circles popup…';
  signStatus.textContent = 'Waiting for passkey approval in the connector…';
  try {
    const { signature, verified } = await requestSignature(message, signatureType);
    renderResult({ message, signatureType, signature, verified });
    signStatus.textContent = 'Signed!';
    signStatus.classList.add('success');
  } catch (e) {
    signStatus.textContent = `Signing failed: ${e.message}`;
    signStatus.classList.add('error');
  } finally {
    signBtn.textContent = 'Sign message';
    updateSignState();
  }
});

// ── Log out ───────────────────────────────────────────────────────────────────
$('logout-btn').addEventListener('click', () => {
  connectedAddress = null;
  renderSignedOut();
  frame.src = frameSrc(connectorHost);
  log('·', 'logged out (host-side) and reloaded connector');
});

$('clear-log').addEventListener('click', () => {
  logEl.textContent = '';
});

// ── Host picker ─────────────────────────────────────────────────────────────────
function applyHost(host) {
  connectorHost = host.replace(/\/$/, '');
  localStorage.setItem('crc-login-host', connectorHost);
  hostInput.value = connectorHost;
  connectedAddress = null;
  renderSignedOut();
  frame.src = frameSrc(connectorHost);
  log('·', `loading connector: ${frame.src}`);
}

$('host-apply').addEventListener('click', () => applyHost(hostInput.value.trim() || DEFAULT_HOST));
hostInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyHost(hostInput.value.trim() || DEFAULT_HOST);
});

// ── Boot ────────────────────────────────────────────────────────────────────────
applyHost(connectorHost);
renderSignedOut();
