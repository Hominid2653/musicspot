/**
 * auth.js — Spotify PKCE Authentication Module
 */

const AUTH_CONFIG = {
  clientId: '8ed8966ce60f488d935afb9fb06cce88',
  redirectUri: window.location.origin + window.location.pathname.replace(/index\.html$/, '').replace(/\/$/, '') + '/',
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

function generateCodeVerifier(length = 128) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(randomValues).map((b) => possible[b % possible.length]).join('');
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function persistTokens(tokenData) {
  localStorage.setItem(STORAGE_KEYS.accessToken, tokenData.access_token);
  localStorage.setItem(STORAGE_KEYS.tokenExpiry, (Date.now() + tokenData.expires_in * 1000).toString());
  if (tokenData.refresh_token) localStorage.setItem(STORAGE_KEYS.refreshToken, tokenData.refresh_token);
}

function clearTokens() {
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
}

function getValidAccessToken() {
  const token = localStorage.getItem(STORAGE_KEYS.accessToken);
  const expiry = parseInt(localStorage.getItem(STORAGE_KEYS.tokenExpiry) || '0', 10);
  return token && Date.now() < expiry ? token : null;
}

function isAuthenticated() { return !!getValidAccessToken(); }

async function initiateLogin() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem(STORAGE_KEYS.codeVerifier, verifier);
  const params = new URLSearchParams({
    client_id: AUTH_CONFIG.clientId, response_type: 'code',
    redirect_uri: AUTH_CONFIG.redirectUri,
    scope: AUTH_CONFIG.scopes.join(' '),
    code_challenge_method: 'S256', code_challenge: challenge,
  });
  window.location.href = `${AUTH_CONFIG.authEndpoint}?${params}`;
}

async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  window.history.replaceState({}, document.title, window.location.pathname);
  if (error || !code) return false;
  const verifier = localStorage.getItem(STORAGE_KEYS.codeVerifier);
  if (!verifier) return false;
  try {
    const res = await fetch(AUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        redirect_uri: AUTH_CONFIG.redirectUri,
        client_id: AUTH_CONFIG.clientId, code_verifier: verifier,
      }).toString(),
    });
    if (!res.ok) throw new Error(await res.text());
    persistTokens(await res.json());
    localStorage.removeItem(STORAGE_KEYS.codeVerifier);
    return true;
  } catch (e) { console.error('[auth] callback error', e); return false; }
}

async function refreshAccessToken() {
  const rt = localStorage.getItem(STORAGE_KEYS.refreshToken);
  if (!rt) return false;
  try {
    const res = await fetch(AUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: AUTH_CONFIG.clientId }).toString(),
    });
    if (!res.ok) throw new Error();
    persistTokens(await res.json());
    return true;
  } catch { clearTokens(); return false; }
}

async function getAccessToken() {
  return getValidAccessToken() || ((await refreshAccessToken()) ? getValidAccessToken() : null);
}

function logout() { clearTokens(); window.location.reload(); }

window.SpotifyAuth = { initiateLogin, handleCallback, getAccessToken, isAuthenticated, logout, STORAGE_KEYS };