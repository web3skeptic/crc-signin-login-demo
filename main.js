/**
 * Northwind — login-with-Circles demo (third-party host side).
 *
 * Framework-free example of: (1) logging a user in by embedding the Circles
 * /crc-signin connector in an iframe, (2) loading their Circles profile, (3)
 * searching for a recipient, and (4) transferring an ERC-20 Circles token.
 *
 * Login flow:
 *   1. Embed <iframe src="https://<host>/crc-signin"> with the WebAuthn
 *      Permissions-Policy granted (see index.html `allow=`).
 *   2. The connector posts `crc_bridge_ready`; we reply `request_address`.
 *   3. The user completes their passkey; the connector posts `wallet_connected`.
 *
 * Transfer flow (the wallet only ever touches THIS one step):
 *   - Profile, search, and balances are PUBLIC RPC reads — done here directly.
 *   - We build the ERC-20 `transfer` calldata and post `send_transactions` to the
 *     connector, which signs & sends it via the user's Safe and replies tx_success.
 *
 * Wire format is identical to @aboutcircles/miniapp-sdk, so no SDK is needed.
 *
 * NOTE on passkeys: an EXISTING Circles passkey is only found when the connector
 * is served from a *.gnosis.io host (passkeys are bound to RP ID `gnosis.io`).
 */
import {
  getProfile,
  searchProfiles,
  getErc20Balances,
  erc20BalanceWei,
  erc20BalanceDisplay,
  crcToWei,
  buildErc20Transfer,
  isAddress,
  getAddress,
} from './circles.js';

const DEFAULT_HOST = 'https://circles.gnosis.io';
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
const balanceList = $('balance-list');
const recipientInput = $('recipient-input');
const searchResults = $('search-results');
const amountInput = $('amount-input');
const sendBtn = $('send-btn');
const txStatus = $('tx-status');

// Mode tabs + sign panel
const modeTxBtn = $('mode-tx');
const modeSignBtn = $('mode-sign');
const panelTx = $('panel-tx');
const panelSign = $('panel-sign');
const messageInput = $('message-input');
const signBtn = $('sign-btn');
const signStatus = $('sign-status');
const signResult = $('sign-result');

// ── State ─────────────────────────────────────────────────────────────────────
let connectedAddress = null;
let erc20Rows = [];           // ERC-20 balance rows for the connected avatar
let selectedToken = null;     // chosen balance row
let selectedRecipient = null; // { address, name }
let txReqCounter = 0;
const pendingTx = {};         // requestId -> { resolve, reject }
let searchTimer = null;
let signReqCounter = 0;
const pendingSign = {};        // requestId -> { resolve, reject }

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

// ── Send a tx through the connector and await its result ────────────────────────
function requestTransactions(transactions) {
  return new Promise((resolve, reject) => {
    const requestId = 'tx_' + ++txReqCounter;
    pendingTx[requestId] = { resolve, reject };
    postToFrame({ type: 'send_transactions', requestId, transactions });
  });
}

// ── Ask the connector to sign arbitrary text and await its result ───────────────
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

    case 'tx_success':
      log('in', `tx_success: ${(d.hashes || []).join(', ')}`);
      pendingTx[d.requestId]?.resolve(d.hashes || []);
      delete pendingTx[d.requestId];
      break;

    case 'tx_rejected':
      log('in', `tx_rejected: ${d.reason ?? d.error}`);
      pendingTx[d.requestId]?.reject(new Error(d.reason ?? d.error ?? 'Rejected'));
      delete pendingTx[d.requestId];
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
  updateSignState();
}

// ── Mode tabs: transfer a tx vs. sign text ──────────────────────────────────────
function setMode(mode) {
  const sign = mode === 'sign';
  panelTx.hidden = sign;
  panelSign.hidden = !sign;
  modeTxBtn.classList.toggle('active', !sign);
  modeSignBtn.classList.toggle('active', sign);
  modeTxBtn.setAttribute('aria-selected', String(!sign));
  modeSignBtn.setAttribute('aria-selected', String(sign));
}

modeTxBtn.addEventListener('click', () => setMode('tx'));
modeSignBtn.addEventListener('click', () => setMode('sign'));

function renderSignedOut() {
  signedOut.hidden = false;
  signedIn.hidden = true;
  erc20Rows = [];
  selectedToken = null;
  selectedRecipient = null;
}

// ── Load profile + ERC-20 balances for the connected account ────────────────────
async function loadAccount() {
  profileAddr.textContent = connectedAddress;
  profileName.textContent = 'Loading…';
  profileAvatar.textContent = avatarInitial('', connectedAddress);
  profileAvatar.style.backgroundImage = '';

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

  // ERC-20 balances
  balanceList.innerHTML = '<div class="muted-row">Loading balances…</div>';
  try {
    erc20Rows = await getErc20Balances(connectedAddress);
    renderBalances();
  } catch (e) {
    balanceList.innerHTML = `<div class="muted-row">Couldn't load balances: ${e.message}</div>`;
  }
}

function renderBalances() {
  if (!erc20Rows.length) {
    balanceList.innerHTML =
      '<div class="muted-row">No ERC-20 Circles tokens. Wrap some Circles to ERC-20 first, then reload.</div>';
    selectedToken = null;
    updateSendState();
    return;
  }
  balanceList.innerHTML = '';
  for (const row of erc20Rows) {
    const wei = erc20BalanceWei(row);
    if (wei <= 0n) continue;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'token-row';
    el.dataset.token = row.tokenAddress;
    const flavor = row.isInflationary ? 'static' : 'demurrage';
    el.innerHTML = `
      <span class="token-main">
        <span class="token-amt">${Number(erc20BalanceDisplay(row)).toLocaleString(undefined, { maximumFractionDigits: 4 })} CRC</span>
        <span class="token-meta">${flavor} · issuer ${shortAddr(row.tokenOwner)}</span>
      </span>
      <span class="token-addr">${shortAddr(row.tokenAddress)}</span>`;
    el.addEventListener('click', () => selectToken(row, el));
    balanceList.appendChild(el);
  }
  if (!balanceList.children.length) {
    balanceList.innerHTML = '<div class="muted-row">All ERC-20 Circles balances are zero.</div>';
  }
}

function selectToken(row, el) {
  selectedToken = row;
  [...balanceList.querySelectorAll('.token-row')].forEach((n) => n.classList.remove('selected'));
  el.classList.add('selected');
  updateSendState();
}

// ── Recipient search ─────────────────────────────────────────────────────────────
recipientInput.addEventListener('input', () => {
  const q = recipientInput.value.trim();
  selectedRecipient = null;
  updateSendState();
  clearTimeout(searchTimer);

  if (!q) {
    searchResults.innerHTML = '';
    searchResults.hidden = true;
    return;
  }

  // If it's a full valid address, accept it directly as the recipient.
  if (isAddress(q)) {
    selectedRecipient = { address: getAddress(q), name: '' };
    searchResults.innerHTML = '';
    searchResults.hidden = true;
    updateSendState();
    return;
  }

  searchTimer = setTimeout(() => runSearch(q), 250);
});

async function runSearch(q) {
  searchResults.hidden = false;
  searchResults.innerHTML = '<div class="muted-row">Searching…</div>';
  try {
    const results = await searchProfiles(q, { limit: 8 });
    if (!results.length) {
      searchResults.innerHTML = '<div class="muted-row">No matches.</div>';
      return;
    }
    searchResults.innerHTML = '';
    for (const r of results) {
      if (!r.address) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'result-row';
      const init = avatarInitial(r.name, r.address);
      const img = r.previewImageUrl
        ? `<span class="result-avatar" style="background-image:url('${r.previewImageUrl}')"></span>`
        : `<span class="result-avatar">${init}</span>`;
      el.innerHTML = `
        ${img}
        <span class="result-meta">
          <span class="result-name">${r.name || 'Unnamed'}</span>
          <span class="result-sub">${shortAddr(r.address)}${r.avatarType ? ' · ' + typeLabel(r.avatarType) : ''}</span>
        </span>`;
      el.addEventListener('click', () => pickRecipient(r));
      searchResults.appendChild(el);
    }
  } catch (e) {
    searchResults.innerHTML = `<div class="muted-row">Search failed: ${e.message}</div>`;
  }
}

function typeLabel(t) {
  return {
    CrcV2_RegisterHuman: 'person',
    CrcV2_RegisterGroup: 'group',
    CrcV2_RegisterOrganization: 'org',
    CrcV1_Signup: 'v1',
  }[t] || t;
}

function pickRecipient(r) {
  selectedRecipient = { address: getAddress(r.address), name: r.name || '' };
  recipientInput.value = r.name ? `${r.name} (${shortAddr(r.address)})` : r.address;
  searchResults.innerHTML = '';
  searchResults.hidden = true;
  updateSendState();
}

// ── Send ──────────────────────────────────────────────────────────────────────
function updateSendState() {
  const amt = amountInput.value.trim();
  const ok = !!selectedToken && !!selectedRecipient && !!amt && Number(amt) > 0;
  sendBtn.disabled = !ok;
}

amountInput.addEventListener('input', updateSendState);

sendBtn.addEventListener('click', async () => {
  if (!selectedToken || !selectedRecipient) return;
  txStatus.textContent = '';
  txStatus.className = 'tx-status';

  let amountWei;
  try {
    amountWei = crcToWei(amountInput.value);
  } catch (e) {
    txStatus.textContent = e.message;
    txStatus.classList.add('error');
    return;
  }

  const balance = erc20BalanceWei(selectedToken);
  if (amountWei > balance) {
    txStatus.textContent = `Amount exceeds balance (${erc20BalanceDisplay(selectedToken)} CRC available).`;
    txStatus.classList.add('error');
    return;
  }

  const tx = buildErc20Transfer({
    tokenAddress: selectedToken.tokenAddress,
    recipient: selectedRecipient.address,
    amountWei,
  });

  sendBtn.disabled = true;
  sendBtn.textContent = 'Confirm in the Circles popup…';
  txStatus.textContent = 'Waiting for approval in the connector…';
  try {
    const hashes = await requestTransactions([tx]);
    const hash = hashes[0];
    txStatus.innerHTML =
      `Sent! <a href="https://gnosisscan.io/tx/${hash}" target="_blank" rel="noopener noreferrer">${shortAddr(hash)} ↗</a>`;
    txStatus.classList.add('success');
    amountInput.value = '';
    // Refresh balances after a moment so the new amount shows.
    setTimeout(loadAccount, 3000);
  } catch (e) {
    txStatus.textContent = `Transfer failed: ${e.message}`;
    txStatus.classList.add('error');
  } finally {
    sendBtn.textContent = 'Send Circles';
    updateSendState();
  }
});

// ── Sign text ───────────────────────────────────────────────────────────────────
function selectedSigType() {
  return document.querySelector('input[name="sig-type"]:checked')?.value || 'erc1271';
}

function updateSignState() {
  signBtn.disabled = !connectedAddress || !messageInput.value.trim();
}

messageInput.addEventListener('input', updateSignState);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderSignResult({ message, signatureType, signature, verified }) {
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
    renderSignResult({ message, signatureType, signature, verified });
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
// Ask the connector to drop its session, then show the signed-out view. We do NOT
// reload the iframe: reloading remounts the connector, which would auto-restore the
// saved session and reconnect. The `disconnect` message makes the connector clear
// its saved session and reply `wallet_disconnected`.
$('logout-btn').addEventListener('click', () => {
  connectedAddress = null;
  renderSignedOut();
  postToFrame({ type: 'disconnect' });
  log('·', 'logged out (sent disconnect to connector)');
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
