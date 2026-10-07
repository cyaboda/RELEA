
const form = document.getElementById('realUpcForm');
const input = document.getElementById('realUpc');
const btn = document.getElementById('searchReleaseBtn');
const btnText = btn.querySelector('.button-text');
const spinner = btn.querySelector('.button-spinner');
const message = document.getElementById('lookupMessage');
const result = document.getElementById('lookupResult');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');

const titleEl = document.getElementById('releaseTitle');
const artistEl = document.getElementById('releaseArtist');
const barcodeEl = document.getElementById('releaseBarcode');
const dateEl = document.getElementById('releaseDate');
const tracksEl = document.getElementById('releaseTracks');
const countryEl = document.getElementById('releaseCountry');
const typeEl = document.getElementById('releaseType');
const coverArt = document.getElementById('coverArt');
const coverFallback = document.getElementById('coverFallback');
const confidenceBadge = document.getElementById('confidenceBadge');
const sourceCount = document.getElementById('sourceCount');

const spotifySearch = document.getElementById('spotifySearch');
const appleSearch = document.getElementById('appleSearch');
const youtubeSearch = document.getElementById('youtubeSearch');
const appleLinkLabel = document.getElementById('appleLinkLabel');
const appleDestinationStatus = document.getElementById('appleDestinationStatus');
const deezerDestinationStatus = document.getElementById('deezerDestinationStatus');
const deezerOpen = document.getElementById('deezerOpen');
const tidalSearch = document.getElementById('tidalSearch');
const amazonSearch = document.getElementById('amazonSearch');
const soundcloudSearch = document.getElementById('soundcloudSearch');
const bandcampSearch = document.getElementById('bandcampSearch');

const manualEditor = document.getElementById('manualPlatformEditor');
const manualPlatformTitle = document.getElementById('manualPlatformTitle');
const manualPlatformName = document.getElementById('manualPlatformName');
const manualPlatformUrl = document.getElementById('manualPlatformUrl');
const manualPlatformMessage = document.getElementById('manualPlatformMessage');
let manualEditingPlatform = '';

const manualPlatformLinks = {};


const sourceEls = {
  apple: document.getElementById('sourceApple'),
  deezer: document.getElementById('sourceDeezer'),
  musicbrainz: document.getElementById('sourceMusicBrainz')
};

let lastResolvedRelease = null;

function setLoading(loading){
  btn.disabled = loading;
  btnText.textContent = loading ? 'Buscando en varias fuentes…' : 'Buscar lanzamiento';
  spinner.hidden = !loading;
}

function showMessage(text, type='error'){
  message.textContent = text;
  message.className = 'lookup-message ' + type;
  message.hidden = false;
}

function clearMessage(){ message.hidden = true; }

function normalizeCode(value){
  return value.trim().replace(/\s+/g,'').toUpperCase();
}

function detectCodeType(code){
  if(/^\d{12,14}$/.test(code)) return 'upc';
  if(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code)) return 'isrc';
  return null;
}

function norm(value=''){
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}

function artistCreditName(value){
  if(!value) return '';
  if(typeof value === 'string') return value;
  const credits = value['artist-credit'] || [];
  return credits.map(x => x.name || x.artist?.name).filter(Boolean).join(', ');
}

function trackCountFromMB(release){
  const media = release.media || [];
  const count = media.reduce((sum,m) => sum + (Number(m['track-count']) || 0),0);
  return count || null;
}

function candidate(source, data={}){
  return {
    source,
    title: data.title || '',
    artist: data.artist || '',
    artwork: data.artwork || '',
    date: data.date || '',
    tracks: data.tracks || null,
    country: data.country || '',
    upc: data.upc || '',
    isrc: data.isrc || '',
    exactUrl: data.exactUrl || '',
    releaseId: data.releaseId || '',
    raw: data.raw || null
  };
}

function jsonp(url, timeoutMs=9000){
  return new Promise((resolve, reject) => {
    const callback = `relea_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const separator = url.includes('?') ? '&' : '?';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Tiempo de espera agotado'));
    }, timeoutMs);

    function cleanup(){
      clearTimeout(timer);
      delete window[callback];
      script.remove();
    }

    window[callback] = data => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('No se pudo consultar la fuente'));
    };

    script.src = `${url}${separator}callback=${callback}`;
    document.head.appendChild(script);
  });
}

async function appleLookupUPC(code){
  const countries = ['ec','us'];
  for(const country of countries){
    try{
      const data = await jsonp(`https://itunes.apple.com/lookup?upc=${encodeURIComponent(code)}&entity=song&country=${country}`);
      const results = data.results || [];
      if(!results.length) continue;

      const collection = results.find(x => x.wrapperType === 'collection') || results.find(x => x.collectionName);
      const tracks = results.filter(x => x.wrapperType === 'track');
      const base = collection || tracks[0];
      if(!base) continue;

      return candidate('apple', {
        title: base.collectionName || base.trackName || '',
        artist: base.artistName || '',
        artwork: (base.artworkUrl100 || '').replace('100x100bb','600x600bb'),
        date: (base.releaseDate || '').slice(0,10),
        tracks: base.trackCount || tracks.length || null,
        country: country.toUpperCase(),
        upc: code,
        exactUrl: base.collectionViewUrl || base.trackViewUrl || '',
        raw: data
      });
    }catch(e){}
  }
  return null;
}

async function appleSearchMetadata(title, artist){
  if(!title || !artist) return null;
  try{
    const term = encodeURIComponent(`${artist} ${title}`);
    const data = await jsonp(`https://itunes.apple.com/search?term=${term}&entity=song&limit=10&country=us`);
    const results = data.results || [];
    if(!results.length) return null;

    const nt = norm(title), na = norm(artist);
    const scored = results.map(item => {
      const t = norm(item.trackName || item.collectionName || '');
      const a = norm(item.artistName || '');
      let score = 0;
      if(t === nt) score += 5;
      else if(t.includes(nt) || nt.includes(t)) score += 3;
      if(a === na) score += 5;
      else if(a.includes(na) || na.includes(a)) score += 3;
      return {item, score};
    }).sort((a,b) => b.score-a.score);

    if(!scored[0] || scored[0].score < 5) return null;
    const item = scored[0].item;
    return candidate('apple', {
      title: item.collectionName || item.trackName || title,
      artist: item.artistName || artist,
      artwork: (item.artworkUrl100 || '').replace('100x100bb','600x600bb'),
      date: (item.releaseDate || '').slice(0,10),
      tracks: item.trackCount || null,
      country: item.country || 'US',
      exactUrl: item.collectionViewUrl || item.trackViewUrl || '',
      raw: item
    });
  }catch(e){
    return null;
  }
}

async function deezerLookup(code, type){
  const endpoint = type === 'upc'
    ? `https://api.deezer.com/album/upc:${encodeURIComponent(code)}?output=jsonp`
    : `https://api.deezer.com/track/isrc:${encodeURIComponent(code)}?output=jsonp`;

  try{
    const data = await jsonp(endpoint);
    if(!data || data.error) return null;

    if(type === 'upc'){
      return candidate('deezer', {
        title: data.title || '',
        artist: data.artist?.name || '',
        artwork: data.cover_xl || data.cover_big || data.cover_medium || '',
        date: data.release_date || '',
        tracks: data.nb_tracks || null,
        country: '',
        upc: data.upc || code,
        exactUrl: data.link || '',
        raw: data
      });
    }

    let album = data.album || {};
    let albumDetails = null;
    if(album.id){
      try{
        albumDetails = await jsonp(`https://api.deezer.com/album/${album.id}?output=jsonp`);
      }catch(e){}
    }
    return candidate('deezer', {
      title: albumDetails?.title || album.title || data.title || '',
      artist: data.artist?.name || albumDetails?.artist?.name || '',
      artwork: albumDetails?.cover_xl || album.cover_xl || album.cover_big || '',
      date: albumDetails?.release_date || '',
      tracks: albumDetails?.nb_tracks || null,
      country: '',
      upc: albumDetails?.upc || '',
      isrc: data.isrc || code,
      exactUrl: albumDetails?.link || data.link || '',
      raw: {track:data, album:albumDetails}
    });
  }catch(e){
    return null;
  }
}

async function musicBrainzLookup(code, type){
  try{
    if(type === 'upc'){
      const query = encodeURIComponent(`barcode:${code}`);
      const response = await fetch(`https://musicbrainz.org/ws/2/release/?query=${query}&fmt=json&limit=5`, {
        headers:{'Accept':'application/json'}
      });
      if(!response.ok) return null;
      const data = await response.json();
      const release = (data.releases || [])[0];
      if(!release) return null;
      return candidate('musicbrainz', {
        title: release.title || '',
        artist: artistCreditName(release),
        date: release.date || '',
        tracks: trackCountFromMB(release),
        country: release.country || '',
        upc: release.barcode || code,
        releaseId: release.id || '',
        raw: release
      });
    }

    const response = await fetch(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(`isrc:${code}`)}&fmt=json&limit=5`, {
      headers:{'Accept':'application/json'}
    });
    if(!response.ok) return null;
    const data = await response.json();
    const recording = (data.recordings || [])[0];
    if(!recording) return null;

    let release = (recording.releases || [])[0] || null;
    if(!release){
      try{
        const detail = await fetch(`https://musicbrainz.org/ws/2/recording/${recording.id}?inc=releases+artist-credits&fmt=json`, {
          headers:{'Accept':'application/json'}
        });
        if(detail.ok){
          const detailData = await detail.json();
          release = (detailData.releases || [])[0] || null;
        }
      }catch(e){}
    }

    return candidate('musicbrainz', {
      title: release?.title || recording.title || '',
      artist: artistCreditName(recording) || artistCreditName(release),
      date: release?.date || recording['first-release-date'] || '',
      tracks: release ? trackCountFromMB(release) : 1,
      country: release?.country || '',
      upc: release?.barcode || '',
      isrc: code,
      releaseId: release?.id || '',
      raw: {recording, release}
    });
  }catch(e){
    return null;
  }
}

function setSourceState(name, state, text){
  const el = sourceEls[name];
  el.classList.remove('pending','found','miss');
  el.classList.add(state);
  el.querySelector('span').textContent = text;
  el.querySelector('b').textContent = state === 'found' ? '✓' : state === 'miss' ? '—' : '•••';
}

function resetSources(){
  setSourceState('apple','pending','Consultando catálogo…');
  setSourceState('deezer','pending','Consultando catálogo…');
  setSourceState('musicbrainz','pending','Consultando base…');
}

function chooseBest(candidates, code, type){
  if(!candidates.length) return null;

  const preference = type === 'upc'
    ? ['apple','deezer','musicbrainz']
    : ['deezer','musicbrainz','apple'];

  const sorted = [...candidates].sort((a,b) => preference.indexOf(a.source)-preference.indexOf(b.source));
  const best = {...sorted[0]};

  for(const c of sorted.slice(1)){
    if(!best.title && c.title) best.title = c.title;
    if(!best.artist && c.artist) best.artist = c.artist;
    if(!best.artwork && c.artwork) best.artwork = c.artwork;
    if(!best.date && c.date) best.date = c.date;
    if(!best.tracks && c.tracks) best.tracks = c.tracks;
    if(!best.country && c.country) best.country = c.country;
    if(!best.upc && c.upc) best.upc = c.upc;
    if(!best.isrc && c.isrc) best.isrc = c.isrc;
  }

  if(type === 'upc') best.upc = best.upc || code;
  else best.isrc = best.isrc || code;

  return best;
}

function agreementScore(candidates){
  if(candidates.length <= 1) return {label:'Coincidencia parcial', cls:'partial'};

  const pairs = [];
  for(let i=0;i<candidates.length;i++){
    for(let j=i+1;j<candidates.length;j++){
      const a=candidates[i], b=candidates[j];
      const titleMatch = norm(a.title) && norm(a.title) === norm(b.title);
      const artistMatch = norm(a.artist) && norm(a.artist) === norm(b.artist);
      pairs.push(titleMatch && artistMatch);
    }
  }

  const matches = pairs.filter(Boolean).length;
  if(candidates.length >= 3 && matches >= 2) return {label:'Coincidencia alta', cls:'high'};
  if(matches >= 1) return {label:'Coincidencia buena', cls:'good'};
  return {label:'Revisar coincidencia', cls:'partial'};
}

function buildStoreLinks(release, candidates){
  const raw = `${release.artist} ${release.title}`.trim();
  const q = encodeURIComponent(raw);

  spotifySearch.href = `https://open.spotify.com/search/${q}`;
  youtubeSearch.href = `https://music.youtube.com/search?q=${q}`;
  tidalSearch.href = `https://listen.tidal.com/search?q=${q}`;
  amazonSearch.href = `https://music.amazon.com/search/${q}`;
  soundcloudSearch.href = `https://soundcloud.com/search?q=${q}`;
  bandcampSearch.href = `https://bandcamp.com/search?q=${q}`;

  const apple = candidates.find(x => x.source === 'apple' && x.exactUrl);
  if(apple){
    appleSearch.href = apple.exactUrl;
    appleLinkLabel.textContent = 'Abrir release ↗';
    if(appleDestinationStatus) appleDestinationStatus.textContent = 'Enlace exacto encontrado';
  }else{
    appleSearch.href = `https://music.apple.com/us/search?term=${q}`;
    appleLinkLabel.textContent = 'Buscar release ↗';
    if(appleDestinationStatus) appleDestinationStatus.textContent = 'Búsqueda preparada';
  }

  const deezer = candidates.find(x => x.source === 'deezer' && x.exactUrl);
  if(deezer && deezerOpen){
    deezerOpen.href = deezer.exactUrl;
    deezerOpen.classList.remove('disabled');
    deezerOpen.textContent = 'Abrir ↗';
    if(deezerDestinationStatus) deezerDestinationStatus.textContent = 'Enlace exacto encontrado';
  }else if(deezerOpen){
    deezerOpen.href = `https://www.deezer.com/search/${q}`;
    deezerOpen.classList.remove('disabled');
    deezerOpen.textContent = 'Buscar ↗';
    if(deezerDestinationStatus) deezerDestinationStatus.textContent = 'Búsqueda preparada';
  }
}

function showRelease(release, candidates, code, type){
  titleEl.textContent = release.title || 'Sin título';
  artistEl.textContent = release.artist || 'Artista desconocido';
  barcodeEl.textContent = type === 'upc' ? (release.upc || code) : (release.isrc || code);
  dateEl.textContent = release.date || '—';
  tracksEl.textContent = release.tracks || '—';
  countryEl.textContent = release.country || '—';

  const tracks = Number(release.tracks);
  if(tracks === 1) typeEl.textContent = 'Single';
  else if(tracks > 1 && tracks <= 6) typeEl.textContent = 'EP / Release';
  else if(tracks > 6) typeEl.textContent = 'Álbum';
  else typeEl.textContent = type === 'isrc' ? 'Grabación / Release' : 'Release';

  coverArt.hidden = true;
  coverFallback.hidden = false;
  const art = release.artwork || '';
  if(art){
    coverArt.src = art;
    coverArt.onload = () => {
      coverArt.hidden = false;
      coverFallback.hidden = true;
    };
  }else{
    const mb = candidates.find(x => x.source === 'musicbrainz' && x.releaseId);
    if(mb){
      const url = `https://coverartarchive.org/release/${mb.releaseId}/front-500`;
      coverArt.src = url;
      coverArt.onload = () => {
        coverArt.hidden = false;
        coverFallback.hidden = true;
      };
    }
  }

  const confidence = agreementScore(candidates);
  confidenceBadge.textContent = confidence.label;
  confidenceBadge.className = `confidence-badge ${confidence.cls}`;
  sourceCount.textContent = `${candidates.length} fuente${candidates.length===1?'':'s'} con resultado`;

  buildStoreLinks(release, candidates);
  lastResolvedRelease = {release, candidates, code, type};

  step2.classList.add('active');
  result.hidden = false;
  result.scrollIntoView({behavior:'smooth', block:'start'});
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMessage();
  result.hidden = true;
  resetSources();

  const code = normalizeCode(input.value);
  input.value = code;
  const type = detectCodeType(code);

  if(!type){
    showMessage('Introduce un UPC válido de 12–14 dígitos o un ISRC válido de 12 caracteres.');
    return;
  }

  setLoading(true);

  try{
    // Primary direct identifier queries run in parallel.
    const [appleResult, deezerResult, mbResult] = await Promise.all([
      type === 'upc' ? appleLookupUPC(code) : Promise.resolve(null),
      deezerLookup(code, type),
      musicBrainzLookup(code, type)
    ]);

    let candidates = [];
    if(appleResult){
      candidates.push(appleResult);
      setSourceState('apple','found','Resultado directo encontrado');
    }else{
      setSourceState('apple', type === 'upc' ? 'miss' : 'pending',
        type === 'upc' ? 'Sin resultado por UPC' : 'Esperando metadata…');
    }

    if(deezerResult){
      candidates.push(deezerResult);
      setSourceState('deezer','found','Resultado directo encontrado');
    }else{
      setSourceState('deezer','miss','Sin resultado directo');
    }

    if(mbResult){
      candidates.push(mbResult);
      setSourceState('musicbrainz','found','Metadata encontrada');
    }else{
      setSourceState('musicbrainz','miss','Sin resultado');
    }

    // ISRC: use metadata from Deezer/MB to cross-check Apple via text search.
    if(type === 'isrc' && !appleResult){
      const seed = chooseBest(candidates, code, type);
      if(seed?.title && seed?.artist){
        const appleTextResult = await appleSearchMetadata(seed.title, seed.artist);
        if(appleTextResult){
          candidates.push(appleTextResult);
          setSourceState('apple','found','Coincidencia por artista + título');
        }else{
          setSourceState('apple','miss','Sin coincidencia fiable');
        }
      }else{
        setSourceState('apple','miss','Sin metadata para contrastar');
      }
    }

    if(!candidates.length){
      showMessage('Ninguna de las fuentes consultadas encontró este código. Esto puede ocurrir con lanzamientos muy recientes o catálogos todavía no indexados.', 'neutral');
      return;
    }

    const best = chooseBest(candidates, code, type);
    showRelease(best, candidates, code, type);
  }catch(error){
    showMessage(error.message || 'Ocurrió un error al consultar las fuentes.');
  }finally{
    setLoading(false);
  }
});

document.getElementById('searchAgainBtn').addEventListener('click', () => {
  result.hidden = true;
  step2.classList.remove('active');
  step3.classList.remove('active');
  lastResolvedRelease = null;
  input.value = '';
  input.focus();
  clearMessage();
  resetSources();
  window.scrollTo({top:0, behavior:'smooth'});
});

document.getElementById('importReleaseBtn').addEventListener('click', () => {
  if(!lastResolvedRelease) return;
  step3.classList.add('active');
  showMessage('La coincidencia está lista. En la siguiente fase conectaremos “Importar” con la base de datos de RELEA para que aparezca automáticamente en tu catálogo.', 'success');
});


function validHttpUrl(value){
  try{
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  }catch(e){
    return false;
  }
}

function openManualEditor(platform=''){
  manualEditingPlatform = platform;
  manualPlatformTitle.textContent = platform ? `Agregar URL de ${platform}` : 'Agregar plataforma';
  manualPlatformName.value = platform || '';
  manualPlatformName.readOnly = Boolean(platform);
  manualPlatformUrl.value = manualPlatformLinks[platform] || '';
  manualPlatformMessage.hidden = true;
  manualEditor.hidden = false;
  manualPlatformUrl.focus();
}

function closeManualEditor(){
  manualEditor.hidden = true;
  manualEditingPlatform = '';
  manualPlatformName.readOnly = false;
}

document.getElementById('addManualPlatformBtn')?.addEventListener('click', () => openManualEditor(''));

document.querySelectorAll('[data-edit-platform]').forEach(btn => {
  btn.addEventListener('click', () => openManualEditor(btn.dataset.editPlatform || ''));
});

document.getElementById('closeManualEditor')?.addEventListener('click', closeManualEditor);

document.getElementById('saveManualPlatform')?.addEventListener('click', () => {
  const name = manualPlatformName.value.trim();
  const url = manualPlatformUrl.value.trim();

  if(!name){
    manualPlatformMessage.textContent = 'Escribe el nombre de la plataforma.';
    manualPlatformMessage.className = 'manual-platform-message error';
    manualPlatformMessage.hidden = false;
    return;
  }

  if(!validHttpUrl(url)){
    manualPlatformMessage.textContent = 'Pega una URL válida que empiece por http:// o https://';
    manualPlatformMessage.className = 'manual-platform-message error';
    manualPlatformMessage.hidden = false;
    return;
  }

  manualPlatformLinks[name] = url;

  const existingButton = [...document.querySelectorAll('[data-edit-platform]')]
    .find(btn => btn.dataset.editPlatform === name);

  if(existingButton){
    const card = existingButton.closest('.destination-card');
    const open = card?.querySelector('.destination-open');
    const status = card?.querySelector('.destination-status');

    if(open){
      open.href = url;
      open.textContent = 'Abrir ↗';
      open.classList.remove('disabled');
    }
    if(status) status.textContent = 'URL agregada manualmente';
  }else{
    const grid = document.getElementById('platformDestinationGrid');
    const card = document.createElement('div');
    card.className = 'destination-card custom-destination';
    card.innerHTML = `
      <div class="destination-brand">
        <div class="platform-fallback-logo">${name.slice(0,2).toUpperCase()}</div>
        <div><strong>${name}</strong><span class="destination-status">URL agregada manualmente</span></div>
      </div>
      <div class="destination-actions">
        <a class="destination-open" href="${url}" target="_blank" rel="noopener">Abrir ↗</a>
        <button class="destination-edit" type="button" data-edit-platform="${name}">Editar</button>
      </div>
    `;
    grid.appendChild(card);
    card.querySelector('[data-edit-platform]').addEventListener('click', () => openManualEditor(name));
  }

  manualPlatformMessage.textContent = 'URL guardada en esta búsqueda.';
  manualPlatformMessage.className = 'manual-platform-message success';
  manualPlatformMessage.hidden = false;

  setTimeout(closeManualEditor, 650);
});
