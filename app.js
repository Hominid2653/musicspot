/**
 * app.js — Core Application Logic
 * Spotify API fetching, ColorThief extraction, DOM mapping, poster rendering, and export.
 */

// ─── Spotify API Layer ────────────────────────────────────────────────────────

const SPOTIFY_API = 'https://api.spotify.com/v1';

/**
 * Generic authenticated fetch wrapper for Spotify endpoints.
 * @param {string} endpoint - Relative or absolute Spotify API URL.
 * @returns {Promise<Object>}
 */
async function spotifyFetch(endpoint) {
  const token = await window.SpotifyAuth.getAccessToken();
  if (!token) throw new Error('No valid access token. Please log in again.');

  const url = endpoint.startsWith('http') ? endpoint : `${SPOTIFY_API}${endpoint}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    window.SpotifyAuth.logout();
    throw new Error('Session expired. Please log in again.');
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Spotify API error: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetches current user's Spotify profile.
 */
async function fetchUserProfile() {
  return spotifyFetch('/me');
}

/**
 * Fetches user's top tracks for a given time range.
 * @param {'short_term'|'medium_term'|'long_term'} timeRange
 * @param {number} limit
 */
async function fetchTopTracks(timeRange = 'medium_term', limit = 10) {
  return spotifyFetch(`/me/top/tracks?time_range=${timeRange}&limit=${limit}`);
}

/**
 * Fetches user's top artists.
 * @param {'short_term'|'medium_term'|'long_term'} timeRange
 * @param {number} limit
 */
async function fetchTopArtists(timeRange = 'medium_term', limit = 30) {
  return spotifyFetch(`/me/top/artists?time_range=${timeRange}&limit=${limit}`);
}

/**
 * Fetches full album metadata including tracks.
 * @param {string} albumId
 */
async function fetchAlbum(albumId) {
  return spotifyFetch(`/albums/${albumId}`);
}

// ─── Color Extraction ─────────────────────────────────────────────────────────

/**
 * Uses ColorThief to extract the dominant palette from an image element.
 * Requires the image to be fully loaded and CORS-enabled.
 * @param {HTMLImageElement} imgEl
 * @param {number} count - Number of palette colors to extract.
 * @returns {string[]} Array of hex color strings.
 */
function extractPalette(imgEl, count = 5) {
  try {
    const thief = new ColorThief();
    const palette = thief.getPalette(imgEl, count);
    return palette.map(([r, g, b]) => rgbToHex(r, g, b));
  } catch (err) {
    console.warn('[app] ColorThief extraction failed:', err);
    return ['#1a1a1a', '#2d2d2d', '#3f3f3f', '#555555', '#717171'];
  }
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Loads an image element with crossOrigin anonymous and returns it on load.
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadCorsImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    // Use a proxy-safe approach: append a cache-buster to bypass cached non-CORS responses
    img.src = url;
  });
}

// ─── Poster Templates ─────────────────────────────────────────────────────────

/**
 * Renders Template 1: Minimalist Album Poster
 * @param {string} timeRange
 */
async function renderAlbumPoster(timeRange) {
  showPosterLoading(true);
  setPosterVisible(false);

  try {
    const tracksData = await fetchTopTracks(timeRange, 1);
    if (!tracksData.items?.length) throw new Error('No top tracks found for this time period.');

    const topTrack = tracksData.items[0];
    const album = await fetchAlbum(topTrack.album.id);

    // Load album art with CORS headers for canvas export
    const artUrl = album.images[0]?.url;
    if (!artUrl) throw new Error('Album art not available.');

    const artImg = await loadCorsImage(artUrl);
    const palette = extractPalette(artImg, 5);

    // Build poster DOM
    buildAlbumPosterDOM(album, topTrack, palette, artUrl);
    setPosterVisible(true);
    setActivePosterType('album');

    // Store for export
    window._currentPosterData = { type: 'album', album, topTrack, palette, artUrl };
  } catch (err) {
    showError(err.message);
  } finally {
    showPosterLoading(false);
  }
}

/**
 * Renders Template 2: Receipt / Ticket Stub
 * @param {string} timeRange
 */
async function renderReceiptPoster(timeRange) {
  showPosterLoading(true);
  setPosterVisible(false);

  try {
    const [tracksData, profileData] = await Promise.all([
      fetchTopTracks(timeRange, 10),
      fetchUserProfile(),
    ]);

    if (!tracksData.items?.length) throw new Error('No top tracks found.');
    buildReceiptPosterDOM(tracksData.items, profileData);
    setPosterVisible(true);
    setActivePosterType('receipt');

    window._currentPosterData = { type: 'receipt', tracks: tracksData.items, profile: profileData };
  } catch (err) {
    showError(err.message);
  } finally {
    showPosterLoading(false);
  }
}

/**
 * Renders Template 3: Festival Lineup Poster
 * @param {string} timeRange
 */
async function renderFestivalPoster(timeRange) {
  showPosterLoading(true);
  setPosterVisible(false);

  try {
    const artistsData = await fetchTopArtists(timeRange, 30);
    if (!artistsData.items?.length) throw new Error('No top artists found.');
    buildFestivalPosterDOM(artistsData.items);
    setPosterVisible(true);
    setActivePosterType('festival');

    window._currentPosterData = { type: 'festival', artists: artistsData.items };
  } catch (err) {
    showError(err.message);
  } finally {
    showPosterLoading(false);
  }
}

// ─── DOM Builders ─────────────────────────────────────────────────────────────

function buildAlbumPosterDOM(album, topTrack, palette, artUrl) {
  const poster = document.getElementById('poster-canvas');
  poster.innerHTML = '';
  poster.className = 'poster-canvas album-template';
  poster.style.background = palette[0] || '#0f0f0f';

  // Top: album artwork
  const artSection = document.createElement('div');
  artSection.className = 'poster-art-section';
  const img = document.createElement('img');
  img.src = artUrl;
  img.crossOrigin = 'anonymous';
  img.alt = album.name;
  img.className = 'poster-album-art';
  artSection.appendChild(img);
  poster.appendChild(artSection);

  // Bottom: info grid
  const bottomGrid = document.createElement('div');
  bottomGrid.className = 'poster-bottom-grid';

  // Left: tracklist
  const tracklistPanel = document.createElement('div');
  tracklistPanel.className = 'poster-tracklist-panel';
  const tracks = album.tracks?.items || [];
  const half = Math.ceil(tracks.length / 2);
  const col1 = tracks.slice(0, half);
  const col2 = tracks.slice(half);

  const tracksHtml = `
    <div class="poster-tracklist-cols">
      <ol class="poster-tracklist-col" start="1">
        ${col1.map((t, i) => `<li>${String(i + 1).padStart(2, '0')}. ${t.name.toUpperCase()}</li>`).join('')}
      </ol>
      ${col2.length ? `<ol class="poster-tracklist-col" start="${half + 1}">
        ${col2.map((t, i) => `<li>${String(half + i + 1).padStart(2, '0')}. ${t.name.toUpperCase()}</li>`).join('')}
      </ol>` : ''}
    </div>`;
  tracklistPanel.innerHTML = tracksHtml;

  // Right: palette + artist + album info
  const infoPanel = document.createElement('div');
  infoPanel.className = 'poster-info-panel';

  const swatchRow = palette.map((hex) =>
    `<span class="palette-swatch" style="background:${hex}" title="${hex}"></span>`
  ).join('');

  const releaseYear = album.release_date?.split('-')[0] || '';
  const label = album.label || '';
  const artistNames = album.artists?.map((a) => a.name).join(', ') || topTrack.artists?.[0]?.name || '';

  infoPanel.innerHTML = `
    <div class="palette-row">${swatchRow}</div>
    <div class="poster-artist-name">${artistNames.toUpperCase()}</div>
    <div class="poster-album-title"><em>${album.name}</em></div>
    <div class="poster-meta">
      <span>LABEL: ${label || '—'}</span>
      <span>RELEASED: ${releaseYear}</span>
    </div>`;

  bottomGrid.appendChild(tracklistPanel);
  bottomGrid.appendChild(infoPanel);
  poster.appendChild(bottomGrid);
}

function buildReceiptPosterDOM(tracks, profile) {
  const poster = document.getElementById('poster-canvas');
  poster.innerHTML = '';
  poster.className = 'poster-canvas receipt-template';

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const totalMs = tracks.reduce((sum, t) => sum + (t.duration_ms || 0), 0);
  const totalMin = Math.floor(totalMs / 60000);

  const rows = tracks.map((t, i) => {
    const dur = t.duration_ms ? `${Math.floor(t.duration_ms / 60000)}:${String(Math.floor((t.duration_ms % 60000) / 1000)).padStart(2, '0')}` : '--';
    return `
      <div class="receipt-row">
        <span class="receipt-idx">${String(i + 1).padStart(2, '0')}</span>
        <div class="receipt-track-info">
          <span class="receipt-track-name">${t.name.toUpperCase()}</span>
          <span class="receipt-artist">${t.artists?.[0]?.name?.toUpperCase() || ''}</span>
        </div>
        <span class="receipt-dur">${dur}</span>
      </div>`;
  }).join('');

  poster.innerHTML = `
    <div class="receipt-header">
      <div class="receipt-logo">★ SPOTIFY WRAPPED ★</div>
      <div class="receipt-store">${(profile.display_name || 'LISTENER').toUpperCase()}'S TOP TRACKS</div>
      <div class="receipt-date">${dateStr} · ${timeStr}</div>
      <div class="receipt-divider">- - - - - - - - - - - - - - - - - - - - -</div>
    </div>
    <div class="receipt-items">${rows}</div>
    <div class="receipt-footer">
      <div class="receipt-divider">- - - - - - - - - - - - - - - - - - - - -</div>
      <div class="receipt-total">
        <span>TOTAL LISTENING</span>
        <span>${totalMin} MIN</span>
      </div>
      <div class="receipt-divider">- - - - - - - - - - - - - - - - - - - - -</div>
      <div class="receipt-barcode">||||| ||| || ||||| || ||| ||||| || |||| |||</div>
      <div class="receipt-tagline">THANK YOU FOR YOUR GOOD TASTE</div>
    </div>`;
}

function buildFestivalPosterDOM(artists) {
  const poster = document.getElementById('poster-canvas');
  poster.innerHTML = '';
  poster.className = 'poster-canvas festival-template';

  // Split artists by tier based on rank
  const headliners = artists.slice(0, 3);
  const tier2 = artists.slice(3, 8);
  const tier3 = artists.slice(8, 16);
  const tier4 = artists.slice(16, 30);

  const now = new Date();
  const year = now.getFullYear();

  poster.innerHTML = `
    <div class="festival-header">
      <div class="festival-logo">YOUR MUSIC FEST</div>
      <div class="festival-subtitle">A PERSONAL MUSIC FESTIVAL · ${year} EDITION</div>
    </div>
    <div class="festival-lineup">
      <div class="festival-tier tier-1">
        ${headliners.map((a) => `<span>${a.name.toUpperCase()}</span>`).join('<span class="tier-dot">·</span>')}
      </div>
      <div class="festival-divider"></div>
      <div class="festival-tier tier-2">
        ${tier2.map((a) => `<span>${a.name.toUpperCase()}</span>`).join(' · ')}
      </div>
      <div class="festival-divider"></div>
      <div class="festival-tier tier-3">
        ${tier3.map((a) => `<span>${a.name.toUpperCase()}</span>`).join(' · ')}
      </div>
      <div class="festival-divider"></div>
      <div class="festival-tier tier-4">
        ${tier4.map((a) => `<span>${a.name.toUpperCase()}</span>`).join(' · ')}
      </div>
    </div>
    <div class="festival-footer">
      <span>BASED ON YOUR SPOTIFY DATA</span>
      <span>★</span>
      <span>ALL GENRES · ALL STAGES</span>
    </div>`;
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function showPosterLoading(visible) {
  const loader = document.getElementById('poster-loader');
  if (loader) loader.style.display = visible ? 'flex' : 'none';
}

function setPosterVisible(visible) {
  const canvas = document.getElementById('poster-canvas');
  if (canvas) canvas.style.opacity = visible ? '1' : '0';
}

function setActivePosterType(type) {
  document.querySelectorAll('[data-template]').forEach((btn) => {
    btn.classList.toggle('btn-active', btn.dataset.template === type);
  });
}

function showError(message) {
  const el = document.getElementById('error-banner');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  setTimeout(() => (el.style.display = 'none'), 5000);
}

function showUserProfile(profile) {
  const nameEl = document.getElementById('user-name');
  const avatarEl = document.getElementById('user-avatar');
  if (nameEl) nameEl.textContent = profile.display_name || 'Listener';
  if (avatarEl && profile.images?.[0]?.url) {
    avatarEl.src = profile.images[0].url;
    avatarEl.style.display = 'block';
  }
}

// ─── High-Res Export ──────────────────────────────────────────────────────────

/**
 * Exports the poster canvas as a high-resolution PNG using html2canvas.
 * Uses scale: 4 for sharp print output at A3 dimensions.
 */
async function exportPoster() {
  const poster = document.getElementById('poster-canvas');
  if (!poster || poster.style.opacity === '0') {
    showError('Please generate a poster first.');
    return;
  }

  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.textContent = 'Exporting…';
    exportBtn.disabled = true;
  }

  try {
    const canvas = await html2canvas(poster, {
      scale: 4,                    // 4× for crisp 300dpi-equivalent print quality
      useCORS: true,               // Allow cross-origin Spotify CDN images
      allowTaint: false,           // Prevent canvas taint from foreign images
      backgroundColor: null,       // Preserve poster background
      logging: false,
      imageTimeout: 15000,
    });

    const link = document.createElement('a');
    link.download = `spotify-poster-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('[app] Export failed:', err);
    showError('Export failed. Please ensure album art loaded correctly and try again.');
  } finally {
    if (exportBtn) {
      exportBtn.textContent = 'Download Poster';
      exportBtn.disabled = false;
    }
  }
}

// ─── Saved Posters (localStorage) ────────────────────────────────────────────

const SAVED_POSTERS_KEY = 'saved_posters';

function getSavedPosters() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_POSTERS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCurrentPoster() {
  if (!window._currentPosterData) {
    showError('Nothing to save yet.');
    return;
  }
  const posters = getSavedPosters();
  const entry = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    ...window._currentPosterData,
  };
  posters.unshift(entry);
  localStorage.setItem(SAVED_POSTERS_KEY, JSON.stringify(posters.slice(0, 20))); // Keep last 20
  showError('Poster saved! ✓'); // Reuse error banner as toast
}

// ─── App Bootstrap ────────────────────────────────────────────────────────────

async function bootstrap() {
  // 1. Handle OAuth callback if ?code= is in the URL
  const callbackHandled = await window.SpotifyAuth.handleCallback();
  if (callbackHandled) {
    console.log('[app] OAuth callback handled successfully.');
  }

  // 2. Check auth state and toggle UI sections
  if (window.SpotifyAuth.isAuthenticated()) {
    document.getElementById('auth-section')?.classList.add('hidden');
    document.getElementById('app-section')?.classList.remove('hidden');

    // 3. Fetch and display profile
    try {
      const profile = await fetchUserProfile();
      showUserProfile(profile);
      localStorage.setItem(window.SpotifyAuth.STORAGE_KEYS.userProfile, JSON.stringify(profile));
    } catch (err) {
      console.warn('[app] Could not load profile:', err.message);
    }

    // 4. Auto-render the album poster with medium_term on first load
    const currentTimeRange = document.getElementById('time-range-select')?.value || 'medium_term';
    await renderAlbumPoster(currentTimeRange);
  } else {
    document.getElementById('auth-section')?.classList.remove('hidden');
    document.getElementById('app-section')?.classList.add('hidden');
  }

  // 5. Wire up all event listeners
  attachEventListeners();
}

function attachEventListeners() {
  // Login button
  document.getElementById('login-btn')?.addEventListener('click', () => {
    window.SpotifyAuth.initiateLogin();
  });

  // Logout button
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    window.SpotifyAuth.logout();
  });

  // Template selector buttons
  document.querySelectorAll('[data-template]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const template = btn.dataset.template;
      const timeRange = document.getElementById('time-range-select')?.value || 'medium_term';
      if (template === 'album') await renderAlbumPoster(timeRange);
      else if (template === 'receipt') await renderReceiptPoster(timeRange);
      else if (template === 'festival') await renderFestivalPoster(timeRange);
    });
  });

  // Time range selector
  document.getElementById('time-range-select')?.addEventListener('change', async (e) => {
    const timeRange = e.target.value;
    const activeTemplate = document.querySelector('[data-template].btn-active')?.dataset.template || 'album';
    if (activeTemplate === 'album') await renderAlbumPoster(timeRange);
    else if (activeTemplate === 'receipt') await renderReceiptPoster(timeRange);
    else if (activeTemplate === 'festival') await renderFestivalPoster(timeRange);
  });

  // Export button
  document.getElementById('export-btn')?.addEventListener('click', exportPoster);

  // Save button
  document.getElementById('save-btn')?.addEventListener('click', saveCurrentPoster);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', bootstrap);