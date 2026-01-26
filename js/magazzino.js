(() => {
  // API Endpoint (stesso di magazzino-dettaglio e magazzino-nuovo)
  const API_URL = 'https://script.google.com/macros/s/AKfycbzgXCGMef3UX9GEaS8inOXE7TKz00fbj69ZZqxJgjiWz2GT07GGjAQRGElEdxx9HESS/exec';

  const inputEl = document.getElementById('codice-input');
  const topResultsEl = document.getElementById('top-results');
  const suggestionsEl = document.getElementById('suggestions');
  const keypad = document.querySelector('.keypad');
  const burgerMenu = document.getElementById('burger-menu');
  const bodyEl = document.querySelector('body.touch-app') || document.body;

  let DATA = [];
  let LAST_QUERY = null; // null invece di "" per mostrare il messaggio iniziale
  let SHELVES = []; // elenco scaffali normalizzati, ordinati

  const THEME_KEY = 'themeOverride'; // 'dark' | 'light'
  function applyTheme(mode){
    if (!bodyEl) return;
    bodyEl.classList.remove('theme-dark', 'theme-light');
    if (mode === 'dark') bodyEl.classList.add('theme-dark');
    else if (mode === 'light') bodyEl.classList.add('theme-light');
  }
  function setTheme(mode){
    try { localStorage.setItem(THEME_KEY, mode); } catch(_) {}
    applyTheme(mode);
  }
  function getSavedTheme(){
    try { return localStorage.getItem(THEME_KEY); } catch(_) { return null; }
  }

  // ---------- Utils ----------
  const normalize = s => (s || "").trim();
  const basePart = code => normalize(code).replace(/-\d+$/,"");

  // Riconoscimento e normalizzazione scaffale (es. A01, B8, Z12)
  function normalizeShelfToken(s){
    if (!s) return null;
    const m = String(s).trim().match(/^([A-Za-z])\s*0*(\d{1,2})$/);
    if (!m) return null;
    const letter = m[1].toUpperCase();
    const num = parseInt(m[2], 10); // rimuove zeri iniziali
    if (isNaN(num)) return null;
    return `${letter}${num}`; // forma normalizzata
  }

  function isShelfQuery(q){
    return normalizeShelfToken(q) !== null;
  }

  // ---- Scaffali: costruzione elenco e util ----
  function buildShelves(){
    const set = new Set();
    for (const it of DATA){
      const n = normalizeShelfToken(it.scaffale);
      if (n) set.add(n);
    }
    SHELVES = Array.from(set).sort((a,b) => {
      // a = "A1", b = "B12"
      const [aL, aN] = [a[0], parseInt(a.slice(1),10)];
      const [bL, bN] = [b[0], parseInt(b.slice(1),10)];
      if (aL !== bL) return aL.localeCompare(bL);
      return aN - bN;
    });
  }

  function formatShelf(nrm){
    // nrm = "A1" => "A01"
    if (!nrm) return '';
    const L = nrm[0];
    const N = nrm.slice(1);
    const num = String(parseInt(N,10)).padStart(2,'0');
    return `${L}${num}`;
  }

  function shelfIndex(nrm){
    return SHELVES.indexOf(nrm);
  }

  function gotoShelf(delta){
    const q = normalize(inputEl.value);
    const cur = normalizeShelfToken(q);
    if (!SHELVES.length) return;

    let i = (cur ? SHELVES.indexOf(cur) : -1);
    if (i === -1){
      // prova ad agganciarti alla lettera corrente; se non c'è, inizia dal primo
      const letter = cur ? cur[0] : null;
      const base = letter ? SHELVES.findIndex(s => s[0] === letter) : -1;
      i = base !== -1 ? base : 0;
    }

    i = (i + delta + SHELVES.length) % SHELVES.length;
    const next = SHELVES[i];
    inputEl.value = formatShelf(next);
    updateResults();
  }

  // Carica dati da API Google Apps Script
  async function loadFromAPI(){
    try {
      const res = await fetch(`${API_URL}?action=getRicambi`, {
        redirect: 'follow',
        cache: 'no-store'
      });
      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Converti formato API in formato interno (lowercase keys)
      DATA = (data.ricambi || []).map(r => ({
        codice: r.Codice || '',
        descrizione: r.Descrizione || '',
        scaffale: r.Scaffale || ''
      }));

      buildShelves();
    } catch(e) {
      console.error("Errore caricamento da API:", e);
      DATA = [];
    }

    // Salva in cache centralizzata
    try {
      if (typeof window.cacheManager !== 'undefined' && DATA.length > 0) {
        window.cacheManager.set('magazzino', DATA);
      }
    } catch (e) {
      console.warn('Impossibile salvare cache magazzino:', e);
    }
  }

  function similarCodes(query, dati, alreadySet){
    const q = normalize(query);
    const baseQ = basePart(q);
    if (!q) return [];
    return dati.filter(item => {
      if (alreadySet.has(item.codice)) return false;
      if (basePart(item.codice) === baseQ && item.codice !== q) return true; // stessi base + suffisso
      const bItem = basePart(item.codice);
      if (baseQ.length === bItem.length && baseQ.length > 0){
        let diff = 0;
        for (let i=0;i<baseQ.length;i++){
          if (baseQ[i] !== bItem[i]) diff++;
          if (diff>2) return false;
        }
        return diff>0 && diff<=2;
      }
      return false;
    }).slice(0,15);
  }

  function renderTable(rows){
    if (!rows || rows.length===0) return '';
    const trs = rows.map(r => `
      <tr onclick="window.location.href='/html/magazzino-dettaglio.html?codice=${encodeURIComponent(r.codice)}'" style="cursor: pointer;">
        <td class="td-codice">${r.codice}</td>
        <td class="td-desc">${r.descrizione}</td>
        <td class="td-scaffale">${r.scaffale}</td>
      </tr>
    `).join('');
    return `<table class="table">${trs}</table>`;
  }

  function updateResults(){
    const q = normalize(inputEl.value);
    if (q === LAST_QUERY) return;
    LAST_QUERY = q;

    topResultsEl.innerHTML = '';
    suggestionsEl.innerHTML = '';

    // Mostra messaggio iniziale quando l'input è vuoto
    if (!q) {
      topResultsEl.innerHTML = '<div style="padding:6px 8px; font-size:18px;">Digita per iniziare la ricerca del codice. Visualizza il contenuto degli scaffali con il formato A01. Visualizzando uno scaffale, scorri a destra o a sinistra per passare agli altri scaffali. Scorri dall\'alto verso il basso per aggiornare i dati.</div>';
      return;
    }

    // Se l'input sembra uno scaffale (A01, B8, ecc.), mostra i pezzi di quello scaffale
    const shelfNorm = normalizeShelfToken(q);
    if (shelfNorm){
      // normalizza lo scaffale dei dati a lettera+numero (senza zeri) e confronta
      const matches = DATA.filter(item => normalizeShelfToken(item.scaffale) === shelfNorm)
                          .sort((a,b) => a.codice.localeCompare(b.codice));
      const title = `Scaffale ${shelfNorm.replace(/([A-Z])(\d+)/, (__, L, N) => `${L}${String(N).padStart(2,'0')}`)}`;
      topResultsEl.innerHTML = matches.length
        ? `<h3>${title}</h3>${renderTable(matches.slice(0, 50))}`
        : `<h3>${title}</h3><div style="padding:6px 8px;">Nessun pezzo in questo scaffale.</div>`;
      // niente "forse cercavi" in modalità scaffale per tenere l'interfaccia pulita
      return;
    }

    // Altrimenti, comportamento attuale: prefisso di codice pezzo
    const top = DATA.filter(item => item.codice.startsWith(q)).slice(0,10);
    topResultsEl.innerHTML = top.length
      ? `<h3>Risultati</h3>${renderTable(top)}`
      : `<h3>Risultati</h3><div style="padding:6px 8px;">Nessun risultato con questo prefisso.</div>`;

    const already = new Set(top.map(x=>x.codice));
    const maybe = similarCodes(q, DATA, already);
    if (maybe.length){
      suggestionsEl.innerHTML = `<h3>Forse cercavi</h3>${renderTable(maybe)}`;
    }
  }

  // Hook burger menu -> torna a /private
  if (burgerMenu){
    burgerMenu.addEventListener('click', () => {
      if (navigator.vibrate) navigator.vibrate(10);
      window.location.href = '/private.html';
    });
    burgerMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        if (navigator.vibrate) navigator.vibrate(10);
        window.location.href = '/private.html';
      }
    });
  }

  // Debounce leggero
  let debounceTimer;
  function onInputChange(){
    inputEl.classList.remove('error');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updateResults, 60);
  }

  // ---------- Eventi ----------
  inputEl.addEventListener('input', onInputChange);

  // Keypad: niente focus sull'input => non compare la tastiera iOS
  keypad.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.key');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    const key = btn.getAttribute('data-key');

    // Feedback aptico (Android); su iOS Safari in genere non funziona, ma non fa danni
    if (navigator.vibrate) navigator.vibrate(10);

    if (action === 'backspace'){
      inputEl.value = '';
      updateResults();
      return;
    }
    if (key){
      inputEl.value += key;
      updateResults();
    }
  });

  // ---- Swipe orizzontale sulla keypad per toggle dark/light ----
  if (keypad) {
    let kx = 0, ky = 0, kSwiped = false;
    const THEME_SWIPE_MIN_X = 30;
    const THEME_SWIPE_MAX_Y = 40;

    keypad.addEventListener('touchstart', (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      kSwiped = false;
      kx = t.clientX; ky = t.clientY;
    }, { passive: true });

    keypad.addEventListener('touchend', (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - kx;
      const dy = t.clientY - ky;
      if (Math.abs(dx) >= THEME_SWIPE_MIN_X && Math.abs(dy) <= THEME_SWIPE_MAX_Y) {
        e.preventDefault();
        e.stopPropagation();
        kSwiped = true;
        const isDark = bodyEl && bodyEl.classList.contains('theme-dark');
        setTheme(isDark ? 'light' : 'dark');
      }
    }, { passive: false });

    // Evita che un gesto di swipe scateni anche un click sul tasto
    keypad.addEventListener('click', (e) => {
      if (kSwiped) {
        e.stopPropagation();
        e.preventDefault();
      }
      kSwiped = false;
    }, true);
  }

  // ---- Swipe per navigare scaffali (solo quando l'input è uno scaffale) ----
  const swipeRoot =
    document.getElementById('results-area') ||
    document.querySelector('.app') ||
    document.querySelector('.contenitore') ||
    document.body;

  // PARAMETRI PIÙ PERMISSIVI PER LO SWIPE
  const SWIPE_MIN_X = 25;   // Ridotto da 50 a 25: movimenti più corti
  const SWIPE_MAX_Y = 100;  // Aumentato da 60 a 100: più tolleranza verticale

  if (swipeRoot){
    let sx = 0, sy = 0;
    swipeRoot.addEventListener('touchstart', (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      sx = t.clientX; sy = t.clientY;
    }, { passive: true });

    swipeRoot.addEventListener('touchend', (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;

      // CONDIZIONE PIÙ PERMISSIVA: anche diagonali leggere vengono accettate
      if (Math.abs(dx) >= SWIPE_MIN_X && Math.abs(dy) <= SWIPE_MAX_Y){
        // Determina lo scaffale corrente (può non essere esatto)
        const q = normalize(inputEl.value);
        const cur = normalizeShelfToken(q);

        if (!cur || SHELVES.length === 0){
          return; // niente elenco scaffali disponibile
        }

        let i = SHELVES.indexOf(cur);
        if (i === -1){
          // snap al primo scaffale con stessa lettera; se non esiste, al primo globale
          const letter = cur[0];
          const base = SHELVES.findIndex(s => s[0] === letter);
          i = base !== -1 ? base : 0;
        }

        // direzione swipe: sinistra => +1 (prossimo), destra => -1 (precedente)
        const delta = dx < 0 ? +1 : -1;
        i = (i + delta + SHELVES.length) % SHELVES.length;
        const next = SHELVES[i];
        inputEl.value = formatShelf(next);
        updateResults();
      }
    }, { passive: true });
  }

  // Carica dati da API in background (non bloccante)
  async function loadFromAPIBackground() {
    try {
      await loadFromAPI();
      updateResults();  // Re-render con dati freschi
    } catch (e) {
      console.warn('Background API update fallito (non critico):', e);
    }
  }

  // ---- Pull-to-refresh: swipe down dalla cima per forzare aggiornamento ----
  let refreshing = false;
  const PULL_THRESHOLD = 90; // pixel da trascinare per attivare refresh
  let pullStartY = 0;
  let pullCurrentY = 0;
  let isPulling = false;

  // Crea indicatore visivo per pull-to-refresh
  const refreshIndicator = document.createElement('div');
  refreshIndicator.id = 'refresh-indicator';
  refreshIndicator.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 60px;
    padding-top: env(safe-area-inset-top, 0px);
    background: linear-gradient(180deg, rgba(0,123,255,0.9) 0%, rgba(0,123,255,0) 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 14px;
    font-weight: 600;
    transform: translateY(-100%);
    transition: transform 0.2s ease-out;
    z-index: 9999;
    pointer-events: none;
  `;
  refreshIndicator.innerHTML = '↓ Trascina per aggiornare';
  document.body.appendChild(refreshIndicator);

  const resultsArea = document.querySelector('.app') || document.body;

  resultsArea.addEventListener('touchstart', (e) => {
    // Attiva pull-to-refresh solo se siamo in cima alla pagina
    const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;

    if (scrollTop === 0 && !refreshing) {
      pullStartY = e.touches[0].clientY;
      isPulling = true;
    }
  }, { passive: true });

  resultsArea.addEventListener('touchmove', (e) => {
    if (!isPulling || refreshing) return;

    pullCurrentY = e.touches[0].clientY;
    const pullDistance = pullCurrentY - pullStartY;
    const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;

    // Mostra indicatore solo se swipe verso il basso (accetta scrollTop negativo per rubber band iOS)
    if (pullDistance > 0 && scrollTop <= 0) {
      const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
      const translateY = -100 + (progress * 100);
      refreshIndicator.style.transform = `translateY(${translateY}%)`;

      // Aggiorna testo in base alla distanza trascinata
      if (pullDistance >= PULL_THRESHOLD) {
        if (refreshIndicator.innerHTML !== '↑ Rilascia per aggiornare') {
          refreshIndicator.innerHTML = '↑ Rilascia per aggiornare';
        }
      } else {
        if (refreshIndicator.innerHTML !== '↓ Trascina per aggiornare') {
          refreshIndicator.innerHTML = '↓ Trascina per aggiornare';
        }
      }
    }
  }, { passive: true });

  resultsArea.addEventListener('touchend', async (e) => {
    if (!isPulling || refreshing) return;

    const pullDistance = pullCurrentY - pullStartY;
    const scrollTop = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;

    isPulling = false;

    // Se trascinato abbastanza, attiva refresh (accetta scrollTop negativo per rubber band iOS)
    if (pullDistance >= PULL_THRESHOLD && scrollTop <= 0) {
      refreshing = true;
      refreshIndicator.innerHTML = '⟳ Aggiornamento...';
      refreshIndicator.style.transform = 'translateY(0)';

      try {
        // 1. Invalida cache locale
        window.cacheManager?.invalidate('magazzino');

        // 2. Ricarica da API (ora immediato, niente workflow GitHub!)
        await loadFromAPI();
        updateResults();

        refreshIndicator.innerHTML = '✓ Aggiornato!';
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {
        console.error('[PTR] Errore durante refresh:', e);
        refreshIndicator.innerHTML = '✗ Errore';
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      refreshing = false;
    }

    // Nascondi indicatore
    refreshIndicator.style.transform = 'translateY(-100%)';
    pullCurrentY = 0;
  }, { passive: true });

  // Nota: iOS PWA non calcola env(safe-area-inset-bottom) all'avvio.
  // Il tastierino parte leggermente troppo in alto ma si sistema al primo
  // scroll/interaction. Questo è un limite noto di iOS PWA.

  // Init (ottimizzato cache-first)
  (async () => {
    // 1. Prova cache prima per mostrare dati istantaneamente
    const cached = window.cacheManager?.get('magazzino');

    if (cached && cached.length > 0) {
      // Cache valida → mostra SUBITO
      DATA = cached;
      buildShelves();

      const savedTheme = getSavedTheme();
      if (savedTheme === 'dark' || savedTheme === 'light') {
        applyTheme(savedTheme);
      }

      updateResults();

      // 2. Aggiorna in background da API (non bloccante)
      loadFromAPIBackground();

      return;
    }

    // 3. Fallback: nessuna cache, carica da API
    await loadFromAPI();

    const savedTheme = getSavedTheme();
    if (savedTheme === 'dark' || savedTheme === 'light') {
      applyTheme(savedTheme);
    }

    updateResults();
  })();
})();
