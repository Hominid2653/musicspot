/**
 * app.js — Core Application Logic
 * Spotify API · ColorThief · DOM Poster Builders · Export
 */

// ─── Spotify API ──────────────────────────────────────────────────────────────

const SPOTIFY_API = 'https://api.spotify.com/v1';

async function spotifyFetch(endpoint) {
  const token = await window.SpotifyAuth.getAccessToken();
  if (!token) throw new Error('No valid access token. Please log in again.');
  const url = endpoint.startsWith('http') ? endpoint : `${SPOTIFY_API}${endpoint}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) { window.SpotifyAuth.logout(); throw new Error('Session expired.'); }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Spotify API error: ${response.status}`);
  }
  return response.json();
}

async function fetchUserProfile()                        { return spotifyFetch('/me'); }
async function fetchTopTracks(tr = 'medium_term', n=10)  { return spotifyFetch(`/me/top/tracks?time_range=${tr}&limit=${n}`); }
async function fetchTopArtists(tr = 'medium_term', n=30) { return spotifyFetch(`/me/top/artists?time_range=${tr}&limit=${n}`); }
async function fetchAlbum(id)                            { return spotifyFetch(`/albums/${id}`); }
async function searchAlbums(q)                           { return spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=album&limit=8`); }

async function fetchTopAlbums(timeRange = 'medium_term') {
  const data = await fetchTopTracks(timeRange, 50);
  const seen = new Map();
  for (const t of (data.items || [])) { if (!seen.has(t.album.id)) seen.set(t.album.id, t.album); }
  return Array.from(seen.values()).slice(0, 12);
}

// ─── Color Utils ──────────────────────────────────────────────────────────────

function extractPalette(imgEl, count = 6) {
  try {
    const t = new ColorThief();
    return t.getPalette(imgEl, count).map(([r,g,b]) => rgbToHex(r,g,b));
  } catch { return ['#1a1a1a','#2d2d2d','#3f3f3f','#555','#717171','#999']; }
}
function rgbToHex(r,g,b) { return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''); }
function luminance(hex) {
  const r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  return 0.2126*r+0.7152*g+0.0722*b;
}
function getContrastColor(hex) { return luminance(hex) > 0.38 ? '#000000' : '#ffffff'; }
function darken(hex, amt=40) {
  let r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return rgbToHex(Math.max(0,r-amt), Math.max(0,g-amt), Math.max(0,b-amt));
}
function loadCorsImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`Image load failed: ${url}`));
    img.src = url;
  });
}

// ─── Album Picker ─────────────────────────────────────────────────────────────

async function openAlbumPicker() {
  document.getElementById('album-picker-panel').classList.remove('hidden');
  document.getElementById('album-search-input').value = '';
  document.getElementById('album-search-results').innerHTML = '';
  await loadTopAlbumsIntoGrid();
}
function closeAlbumPicker() {
  document.getElementById('album-picker-panel').classList.add('hidden');
}
async function loadTopAlbumsIntoGrid() {
  const grid = document.getElementById('album-search-results');
  const tr = document.getElementById('time-range-select')?.value || 'medium_term';
  grid.innerHTML = '<p class="picker-status">Loading your top albums…</p>';
  try {
    const albums = await fetchTopAlbums(tr);
    if (!albums.length) { grid.innerHTML = '<p class="picker-status">No albums found.</p>'; return; }
    renderAlbumGrid(albums, grid);
  } catch (e) { grid.innerHTML = `<p class="picker-status error">${e.message}</p>`; }
}
async function runAlbumSearch(query) {
  if (!query.trim()) { await loadTopAlbumsIntoGrid(); return; }
  const grid = document.getElementById('album-search-results');
  grid.innerHTML = '<p class="picker-status">Searching…</p>';
  try {
    const data = await searchAlbums(query);
    const albums = data.albums?.items || [];
    if (!albums.length) { grid.innerHTML = '<p class="picker-status">No results.</p>'; return; }
    renderAlbumGrid(albums, grid);
  } catch (e) { grid.innerHTML = `<p class="picker-status error">${e.message}</p>`; }
}
function renderAlbumGrid(albums, container) {
  container.innerHTML = '';
  albums.forEach(album => {
    const thumb = album.images?.[1]?.url || album.images?.[0]?.url;
    const card = document.createElement('button');
    card.className = 'album-picker-card';
    card.innerHTML = `
      <img src="${thumb}" alt="${album.name}" crossorigin="anonymous"/>
      <div class="album-picker-info">
        <span class="picker-name">${album.name}</span>
        <span class="picker-artist">${album.artists?.[0]?.name || ''}</span>
      </div>`;
    card.addEventListener('click', async () => { closeAlbumPicker(); await renderAlbumPosterFromId(album.id); });
    container.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 1 — ALBUM ART POSTER (Swiss Minimalist)
// ═══════════════════════════════════════════════════════════════════════════════

async function renderAlbumPosterFromId(albumId) {
  showPosterLoading(true); setPosterVisible(false);
  try {
    const album = await fetchAlbum(albumId);
    const artUrl = album.images[0]?.url;
    if (!artUrl) throw new Error('Album art unavailable.');
    const artImg = await loadCorsImage(artUrl);
    const palette = extractPalette(artImg, 6);
    buildAlbumPosterDOM(album, palette, artUrl);
    setPosterVisible(true); setActivePosterType('album');
    window._currentPosterData = { type:'album', album, palette, artUrl };
  } catch(e) { showError(e.message); }
  finally { showPosterLoading(false); }
}

async function renderAlbumPoster(timeRange) {
  showPosterLoading(true); setPosterVisible(false);
  try {
    const data = await fetchTopTracks(timeRange, 1);
    if (!data.items?.length) throw new Error('No top tracks found.');
    await renderAlbumPosterFromId(data.items[0].album.id);
  } catch(e) { showError(e.message); showPosterLoading(false); }
}

function buildAlbumPosterDOM(album, palette, artUrl) {
  const poster = document.getElementById('poster-canvas');
  poster.innerHTML = '';
  poster.className = 'poster-canvas album-template';

  const bg       = palette[0] || '#0a0a0a';
  const accent   = palette[1] || '#ffffff';
  const ink      = getContrastColor(bg);
  const inkMuted = ink === '#ffffff' ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.38)';
  const inkDim   = ink === '#ffffff' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';
  const border   = ink === '#ffffff' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';

  poster.style.cssText = `background:${bg}; color:${ink};`;

  const tracks  = album.tracks?.items || [];
  const half    = Math.ceil(tracks.length / 2);
  const col1    = tracks.slice(0, half);
  const col2    = tracks.slice(half);
  const releaseYear = (album.release_date || '').split('-')[0];
  const artistName  = album.artists?.map(a => a.name).join(', ') || '';

  const formatDur = ms => ms ? `${Math.floor(ms/60000)}′${String(Math.floor((ms%60000)/1000)).padStart(2,'0')}″` : '';

  const trackRow = (t, i) => `
    <div class="alb-track-row" style="border-color:${border}">
      <span class="alb-tn" style="color:${inkMuted}">${String(i+1).padStart(2,'0')}</span>
      <span class="alb-tt" style="color:${inkDim}">${t.name.toUpperCase()}</span>
      <span class="alb-td" style="color:${inkMuted}">${formatDur(t.duration_ms)}</span>
    </div>`;

  const swatches = palette.map(hex =>
    `<span class="alb-swatch" style="background:${hex};outline:1px solid ${border}" title="${hex}"></span>`
  ).join('');

  poster.innerHTML = `
    <!-- ── Art Block ── -->
    <div class="alb-art-block">
      <img class="alb-art-img" src="${artUrl}" crossorigin="anonymous" alt="${album.name}"/>
      <!-- Gradient overlay at bottom of art -->
      <div class="alb-art-fade" style="background:linear-gradient(to bottom, transparent 60%, ${bg})"></div>
    </div>

    <!-- ── Divider rule ── -->
    <div class="alb-rule" style="background:${border}"></div>

    <!-- ── Bottom grid ── -->
    <div class="alb-bottom">

      <!-- Left: tracklist -->
      <div class="alb-tracks-section">
        <div class="alb-section-label" style="color:${inkMuted}">TRACKLIST</div>
        <div class="alb-tracklist-cols">
          <div class="alb-col">
            ${col1.map((t,i) => trackRow(t,i)).join('')}
          </div>
          ${col2.length ? `<div class="alb-col">${col2.map((t,i) => trackRow(t, half+i)).join('')}</div>` : ''}
        </div>
      </div>

      <!-- Right: identity block -->
      <div class="alb-identity">
        <!-- Palette row -->
        <div class="alb-palette">${swatches}</div>
        <!-- Artist -->
        <div class="alb-artist" style="color:${ink}">${artistName.toUpperCase()}</div>
        <!-- Album title -->
        <div class="alb-title" style="color:${inkDim}">${album.name}</div>
        <!-- Meta -->
        <div class="alb-meta" style="color:${inkMuted}; border-top:1px solid ${border}">
          ${album.label ? `<span>LABEL — ${album.label.toUpperCase()}</span>` : ''}
          ${releaseYear ? `<span>© ${releaseYear}</span>` : ''}
          <span>${tracks.length} TRACKS</span>
        </div>
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 2 — RECEIPT (Thermal Printer)
// ═══════════════════════════════════════════════════════════════════════════════

async function renderReceiptPoster(timeRange) {
  showPosterLoading(true); setPosterVisible(false);
  try {
    const [tracksData, profile] = await Promise.all([
      fetchTopTracks(timeRange, 10),
      fetchUserProfile(),
    ]);
    if (!tracksData.items?.length) throw new Error('No top tracks found.');
    buildReceiptPosterDOM(tracksData.items, profile, timeRange);
    setPosterVisible(true); setActivePosterType('receipt');
    window._currentPosterData = { type:'receipt', tracks: tracksData.items, profile, timeRange };
  } catch(e) { showError(e.message); }
  finally { showPosterLoading(false); }
}

function buildReceiptPosterDOM(tracks, profile, timeRange) {
  const poster = document.getElementById('poster-canvas');
  poster.innerHTML = '';
  poster.className = 'poster-canvas receipt-template';

  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year:'numeric', month:'2-digit', day:'2-digit' });
  const timeStr = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const orderNo = '#' + Math.floor(10000 + Math.random()*90000);

  const rangeLabel = { short_term:'LAST 4 WEEKS', medium_term:'LAST 6 MONTHS', long_term:'ALL TIME' }[timeRange] || '';

  const totalMs   = tracks.reduce((s,t) => s + (t.duration_ms||0), 0);
  const totalMin  = Math.floor(totalMs/60000);
  const totalSec  = Math.floor((totalMs%60000)/1000);
  const avgPop    = Math.round(tracks.reduce((s,t)=>s+(t.popularity||0),0)/tracks.length);

  const formatDur = ms => {
    const m = Math.floor(ms/60000), s = String(Math.floor((ms%60000)/1000)).padStart(2,'0');
    return `${m}:${s}`;
  };

  // SVG barcode (decorative)
  const widths = [3,1,2,1,3,1,1,2,3,1,2,1,1,3,2,1,3,1,2,1,3,1,1,2,1,3,2,1,1,3,2,1,3,1,2,1];
  let x = 0;
  const bars = widths.map((w, i) => {
    const bar = i%2===0 ? `<rect x="${x}" y="0" width="${w*2}" height="32" fill="#1a1a1a"/>` : '';
    x += w*2 + 1;
    return bar;
  }).join('');

  const rows = tracks.map((t,i) => {
    const dur = t.duration_ms ? formatDur(t.duration_ms) : '--:--';
    const pop = t.popularity != null ? `${t.popularity}%` : '';
    const artist = (t.artists?.[0]?.name || '').toUpperCase().slice(0, 22);
    const name   = t.name.toUpperCase().slice(0, 26);
    return `
      <div class="rcp-item">
        <div class="rcp-item-head">
          <span class="rcp-idx">${String(i+1).padStart(2,'0')}</span>
          <span class="rcp-name">${name}</span>
          <span class="rcp-dur">${dur}</span>
        </div>
        <div class="rcp-item-sub">
          <span class="rcp-artist">${artist}</span>
          <span class="rcp-pop">${pop}</span>
        </div>
      </div>`;
  }).join('');

  poster.innerHTML = `
    <div class="rcp-paper">
      <!-- Noise texture overlay -->
      <div class="rcp-noise"></div>

      <!-- Torn top edge -->
      <svg class="rcp-tear rcp-tear-top" viewBox="0 0 300 12" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,12 L0,6 Q10,0 20,5 Q30,10 40,4 Q50,0 60,6 Q70,10 80,3 Q90,0 100,7 Q110,11 120,4 Q130,0 140,6 Q150,10 160,3 Q170,0 180,7 Q190,11 200,4 Q210,0 220,6 Q230,10 240,3 Q250,0 260,7 Q270,11 280,4 Q290,0 300,5 L300,12 Z" fill="#f5f0e6"/>
      </svg>

      <div class="rcp-body">
        <!-- Store header -->
        <div class="rcp-store-header">
          <div class="rcp-logo-line">★ SPOTIFY RECEIPT ★</div>
          <div class="rcp-store-name">${(profile.display_name || 'LISTENER').toUpperCase()}</div>
          <div class="rcp-store-sub">MUSIC CONSUMPTION RECORD</div>
          <div class="rcp-store-addr">INTERNET · EVERYWHERE · ALWAYS</div>
        </div>

        <div class="rcp-dashed"></div>

        <!-- Transaction info -->
        <div class="rcp-info-block">
          <div class="rcp-info-row"><span>DATE</span><span>${dateStr}</span></div>
          <div class="rcp-info-row"><span>TIME</span><span>${timeStr}</span></div>
          <div class="rcp-info-row"><span>ORDER</span><span>${orderNo}</span></div>
          <div class="rcp-info-row"><span>PERIOD</span><span>${rangeLabel}</span></div>
          <div class="rcp-info-row"><span>CASHIER</span><span>SPOTIFY API</span></div>
        </div>

        <div class="rcp-dashed"></div>

        <!-- Column headers -->
        <div class="rcp-col-heads">
          <span>#  ITEM</span>
          <span>TIME</span>
        </div>

        <div class="rcp-dashed"></div>

        <!-- Track rows -->
        <div class="rcp-items">${rows}</div>

        <div class="rcp-dashed"></div>

        <!-- Totals -->
        <div class="rcp-totals">
          <div class="rcp-total-row"><span>ITEMS</span><span>${tracks.length} TRACKS</span></div>
          <div class="rcp-total-row"><span>SUBTOTAL</span><span>${totalMin}:${String(totalSec).padStart(2,'0')}</span></div>
          <div class="rcp-total-row"><span>AVG POPULARITY</span><span>${avgPop}%</span></div>
          <div class="rcp-dashed"></div>
          <div class="rcp-total-row rcp-grand"><span>TOTAL TIME</span><span>${totalMin} MIN</span></div>
        </div>

        <div class="rcp-dashed"></div>

        <!-- Footer messages -->
        <div class="rcp-messages">
          <div class="rcp-msg-main">THANK YOU FOR YOUR</div>
          <div class="rcp-msg-main">EXCELLENT TASTE</div>
          <div class="rcp-msg-sub">NO REFUNDS · ALL STREAMS FINAL</div>
          <div class="rcp-msg-sub">VALID FOR BRAGGING RIGHTS ONLY</div>
        </div>

        <div class="rcp-dashed"></div>

        <!-- Barcode -->
        <div class="rcp-barcode-block">
          <svg class="rcp-barcode-svg" viewBox="0 0 ${x} 32" preserveAspectRatio="none">${bars}</svg>
          <div class="rcp-barcode-num">${orderNo.replace('#','')} ${Date.now().toString().slice(-8)}</div>
        </div>

        <div class="rcp-powered">POWERED BY SPOTIFY WEB API</div>
        <div class="rcp-powered">yourwrap.app · ${now.getFullYear()}</div>
      </div>

      <!-- Torn bottom edge -->
      <svg class="rcp-tear rcp-tear-bot" viewBox="0 0 300 12" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M0,0 L0,6 Q10,12 20,7 Q30,2 40,8 Q50,12 60,6 Q70,2 80,9 Q90,12 100,5 Q110,1 120,8 Q130,12 140,6 Q150,2 160,9 Q170,12 180,5 Q190,1 200,8 Q210,12 220,6 Q230,2 240,9 Q250,12 260,5 Q270,1 280,8 Q290,12 300,7 L300,0 Z" fill="#f5f0e6"/>
      </svg>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE 3 — FESTIVAL LINEUP
// ═══════════════════════════════════════════════════════════════════════════════

async function renderFestivalPoster(timeRange) {
  showPosterLoading(true); setPosterVisible(false);
  try {
    const data = await fetchTopArtists(timeRange, 30);
    if (!data.items?.length) throw new Error('No top artists found.');
    buildFestivalPosterDOM(data.items);
    setPosterVisible(true); setActivePosterType('festival');
    window._currentPosterData = { type:'festival', artists: data.items };
  } catch(e) { showError(e.message); }
  finally { showPosterLoading(false); }
}

function buildFestivalPosterDOM(artists) {
  const poster = document.getElementById('poster-canvas');
  poster.innerHTML = '';
  poster.className = 'poster-canvas festival-template';

  const t1 = artists.slice(0,3), t2 = artists.slice(3,8);
  const t3 = artists.slice(8,16), t4 = artists.slice(16,30);
  const year = new Date().getFullYear();

  poster.innerHTML = `
    <div class="fest-bg-texture"></div>
    <div class="fest-inner">
      <div class="fest-header">
        <div class="fest-eyebrow">YOUR PERSONAL</div>
        <div class="fest-logo">MUSIC<br>FESTIVAL</div>
        <div class="fest-year">${year}</div>
      </div>
      <div class="fest-rule"></div>
      <div class="fest-tier fest-t1">
        ${t1.map(a=>`<span>${a.name.toUpperCase()}</span>`).join('<span class="fest-dot">✦</span>')}
      </div>
      <div class="fest-hairline"></div>
      <div class="fest-tier fest-t2">${t2.map(a=>a.name.toUpperCase()).join(' · ')}</div>
      <div class="fest-hairline"></div>
      <div class="fest-tier fest-t3">${t3.map(a=>a.name.toUpperCase()).join(' · ')}</div>
      <div class="fest-hairline"></div>
      <div class="fest-tier fest-t4">${t4.map(a=>a.name.toUpperCase()).join(' · ')}</div>
      <div class="fest-rule"></div>
      <div class="fest-footer">
        <span>ALL GENRES</span><span class="fest-diamond">◆</span>
        <span>ALL STAGES</span><span class="fest-diamond">◆</span>
        <span>BASED ON YOUR SPOTIFY DATA</span>
      </div>
    </div>`;
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function showPosterLoading(v) { const l=document.getElementById('poster-loader'); if(l) l.style.display=v?'flex':'none'; }
function setPosterVisible(v)  { const c=document.getElementById('poster-canvas'); if(c) c.style.opacity=v?'1':'0'; }
function setActivePosterType(t) {
  document.querySelectorAll('[data-template]').forEach(b => b.classList.toggle('btn-active', b.dataset.template===t));
}
function showError(msg) {
  const el=document.getElementById('error-banner');
  if(!el) return;
  el.textContent=msg; el.style.display='block';
  setTimeout(()=>el.style.display='none',5000);
}
function showUserProfile(p) {
  const n=document.getElementById('user-name'), a=document.getElementById('user-avatar');
  if(n) n.textContent=p.display_name||'Listener';
  if(a&&p.images?.[0]?.url){a.src=p.images[0].url;a.style.display='block';}
}

// ─── Export ───────────────────────────────────────────────────────────────────

async function exportPoster() {
  const poster = document.getElementById('poster-canvas');
  if (!poster || poster.style.opacity==='0') { showError('Please generate a poster first.'); return; }
  const btn = document.getElementById('export-btn');
  if (btn) { btn.textContent='Exporting…'; btn.disabled=true; }
  try {
    const canvas = await html2canvas(poster, {
      scale:4, useCORS:true, allowTaint:false,
      backgroundColor:null, logging:false, imageTimeout:15000,
    });
    const link = document.createElement('a');
    link.download=`poster-${Date.now()}.png`;
    link.href=canvas.toDataURL('image/png');
    link.click();
  } catch(e) {
    console.error('[export]',e);
    showError('Export failed. Ensure album art loaded correctly.');
  } finally {
    if(btn){btn.textContent='Download Poster';btn.disabled=false;}
  }
}

// ─── Saved Posters ────────────────────────────────────────────────────────────

function saveCurrentPoster() {
  if (!window._currentPosterData) { showError('Nothing to save yet.'); return; }
  try {
    const list = JSON.parse(localStorage.getItem('saved_posters')||'[]');
    list.unshift({ id:Date.now(), createdAt:new Date().toISOString(), ...window._currentPosterData });
    localStorage.setItem('saved_posters', JSON.stringify(list.slice(0,20)));
    showError('Poster saved ✓');
  } catch { showError('Save failed — storage may be full.'); }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  await window.SpotifyAuth.handleCallback();

  if (window.SpotifyAuth.isAuthenticated()) {
    document.getElementById('auth-section')?.classList.add('hidden');
    document.getElementById('app-section')?.classList.remove('hidden');
    try { showUserProfile(await fetchUserProfile()); } catch(e) { console.warn(e.message); }
    await renderAlbumPoster(document.getElementById('time-range-select')?.value||'medium_term');
  } else {
    document.getElementById('auth-section')?.classList.remove('hidden');
    document.getElementById('app-section')?.classList.add('hidden');
  }
  attachEventListeners();
}

function attachEventListeners() {
  document.getElementById('login-btn')?.addEventListener('click', ()=>window.SpotifyAuth.initiateLogin());
  document.getElementById('logout-btn')?.addEventListener('click', ()=>window.SpotifyAuth.logout());
  document.getElementById('export-btn')?.addEventListener('click', exportPoster);
  document.getElementById('save-btn')?.addEventListener('click', saveCurrentPoster);

  document.querySelectorAll('[data-template]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const t = btn.dataset.template;
      const tr = document.getElementById('time-range-select')?.value||'medium_term';
      if (t==='album')   openAlbumPicker();
      if (t==='receipt') await renderReceiptPoster(tr);
      if (t==='festival') await renderFestivalPoster(tr);
    });
  });

  document.getElementById('time-range-select')?.addEventListener('change', async e => {
    const tr = e.target.value;
    const active = document.querySelector('[data-template].btn-active')?.dataset.template||'album';
    if (active==='album')   await renderAlbumPoster(tr);
    if (active==='receipt') await renderReceiptPoster(tr);
    if (active==='festival') await renderFestivalPoster(tr);
  });

  document.getElementById('album-picker-close')?.addEventListener('click', closeAlbumPicker);
  document.getElementById('album-picker-overlay')?.addEventListener('click', closeAlbumPicker);
  document.getElementById('album-picker-panel')?.addEventListener('click', e => e.stopPropagation());

  let searchTimer;
  document.getElementById('album-search-input')?.addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(()=>runAlbumSearch(e.target.value), 380);
  });
}

document.addEventListener('DOMContentLoaded', bootstrap);
