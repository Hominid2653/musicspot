/**
 * auth.js — Spotify PKCE Authentication Module
 * Handles all cryptographic helpers, token state, and Spotify OAuth flow.
 */

// ─── Configuration ────────────────────────────────────────────────────────────
const AUTH_CONFIG = {
  clientId: '8ed8966ce60f488d935afb9fb06cce88', // Replace with your Spotify App Client ID
  redirectUri: window.location.origin + window.location.pathname.replace(/\/$/, ''),
  scopes: ['user-top-read', 'user-library-read'],
  authEndpoint: 'https://accounts.spotify.com/authorize',
  tokenEndpoint: 'https://accounts.spotify.com/api/token',
};

const STORAGE_KEYS = {
  codeVerifier: 'spotify_pkce_verifier',
  accessToken: 'spotify_access_token',
  refreshToken: 'spotify_refresh_token',
  tokenExpiry: 'spotify_token_expiry',
  userProfile: 'spotify_user_profile',
};

// ─── Crypto Helpers ───────────────────────────────────────────────────────────

/**
 * Generates a cryptographically secure random string for the PKCE code_verifier.
 * @param {number} length - Desired length (43–128 chars per RFC 7636).
 * @returns {string}
 */
function generateCodeVerifier(length = 128) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(randomValues)
    .map((byte) => possible[byte % possible.length])
    .join('');
}

/**
 * Derives the PKCE code_challenge from the verifier using SHA-256.
 * @param {string} verifier
 * @returns {Promise<string>} Base64URL-encoded SHA-256 hash.
 */
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ─── Token State Management ───────────────────────────────────────────────────

/**
 * Stores tokens from a successful exchange response into localStorage.
 * @param {Object} tokenData - Response body from Spotify token endpoint.
 */
function persistTokens(tokenData) {
  const expiryTime = Date.now() + tokenData.expires_in * 1000;
  localStorage.setItem(STORAGE_KEYS.accessToken, tokenData.access_token);
  localStorage.setItem(STORAGE_KEYS.tokenExpiry, expiryTime.toString());
  if (tokenData.refresh_token) {
    localStorage.setItem(STORAGE_KEYS.refreshToken, tokenData.refresh_token);
  }
}

/**
 * Clears all stored auth tokens and session data from localStorage.
 */
function clearTokens() {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
}

/**
 * Returns the stored access token if it hasn't expired.
 * @returns {string|null}
 */
function getValidAccessToken() {
  const token = localStorage.getItem(STORAGE_KEYS.accessToken);
  const expiry = parseInt(localStorage.getItem(STORAGE_KEYS.tokenExpiry) || '0', 10);
  if (!token || Date.now() >= expiry) return null;
  return token;
}

/**
 * Returns true if the user has a valid, unexpired session.
 * @returns {boolean}
 */
function isAuthenticated() {
  return getValidAccessToken() !== null;
}

// ─── OAuth Flow ───────────────────────────────────────────────────────────────

/**
 * Initiates the Spotify PKCE authorization flow.
 * Generates verifier/challenge, caches verifier, then redirects to Spotify.
 */
async function initiateLogin() {
  try {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);

    // Cache verifier before redirect — needed for token exchange on callback
    localStorage.setItem(STORAGE_KEYS.codeVerifier, verifier);

    const params = new URLSearchParams({
      client_id: AUTH_CONFIG.clientId,
      response_type: 'code',
      redirect_uri: AUTH_CONFIG.redirectUri,
      scope: AUTH_CONFIG.scopes.join(' '),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      show_dialog: 'false',
    });

    window.location.href = `${AUTH_CONFIG.authEndpoint}?${params.toString()}`;
  } catch (err) {
    console.error('[auth] Failed to initiate login:', err);
    throw new Error('Authentication initiation failed. Please try again.');
  }
}

/**
 * Handles the OAuth callback: reads ?code= param, exchanges for tokens,
 * and cleans up the URL bar.
 * @returns {Promise<boolean>} True if token exchange succeeded.
 */
async function handleCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const error = urlParams.get('error');

  if (error) {
    console.error('[auth] Spotify auth error:', error);
    // Clean URL regardless of error
    window.history.replaceState({}, document.title, window.location.pathname);
    return false;
  }

  if (!code) return false;

  const verifier = localStorage.getItem(STORAGE_KEYS.codeVerifier);
  if (!verifier) {
    console.error('[auth] No code_verifier found in storage. Possible replay attack or stale session.');
    window.history.replaceState({}, document.title, window.location.pathname);
    return false;
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: AUTH_CONFIG.redirectUri,
      client_id: AUTH_CONFIG.clientId,
      code_verifier: verifier,
    });

    const response = await fetch(AUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(`Token exchange failed: ${errBody.error_description || response.statusText}`);
    }

    const tokenData = await response.json();
    persistTokens(tokenData);

    // Remove verifier — one-time use only
    localStorage.removeItem(STORAGE_KEYS.codeVerifier);

    // Clean URL bar
    window.history.replaceState({}, document.title, window.location.pathname);

    return true;
  } catch (err) {
    console.error('[auth] Token exchange error:', err);
    window.history.replaceState({}, document.title, window.location.pathname);
    return false;
  }
}

/**
 * Attempts to refresh the access token using the stored refresh_token.
 * @returns {Promise<boolean>}
 */
async function refreshAccessToken() {
  const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken);
  if (!refreshToken) return false;

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: AUTH_CONFIG.clientId,
    });

    const response = await fetch(AUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) throw new Error(`Refresh failed: ${response.statusText}`);

    const tokenData = await response.json();
    persistTokens(tokenData);
    return true;
  } catch (err) {
    console.error('[auth] Token refresh error:', err);
    clearTokens();
    return false;
  }
}

/**
 * Returns a valid access token, attempting a refresh if needed.
 * @returns {Promise<string|null>}
 */
async function getAccessToken() {
  let token = getValidAccessToken();
  if (token) return token;

  const refreshed = await refreshAccessToken();
  if (refreshed) return getValidAccessToken();

  return null;
}

/**
 * Logs the user out by clearing all stored tokens and reloading.
 */
function logout() {
  clearTokens();
  window.location.reload();
}

// ─── Exports ──────────────────────────────────────────────────────────────────
window.SpotifyAuth = {
  initiateLogin,
  handleCallback,
  getAccessToken,
  isAuthenticated,
  logout,
  STORAGE_KEYS,
};