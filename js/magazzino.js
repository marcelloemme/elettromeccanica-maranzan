(() => {
  const inputEl = document.getElementById('codice-input');
  const topResultsEl = document.getElementById('top-results');
  const suggestionsEl = document.getElementById('suggestions');
  const keypad = document.querySelector('.keypad');
  const cameraBtn = document.getElementById('camera-button');
  const fileInput = document.getElementById('qr-file-input');
  const bodyEl = document.querySelector('body.touch-app') || document.body;

  let DATA = [];
  let LAST_QUERY = null; // null invece di "" per mostrare il messaggio iniziale
  let SHELVES = []; // elenco scaffali normalizzati, ordinati
  let placeholderTimer = null;

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

  function parseCSV(text){
    const lines = text.split(/\r?\n/);
    const out = [];
    for (let i=0;i<lines.length;i++){
      let line = lines[i].trim();
      if (!line) continue;
      if (i===0 && /^codice/i.test(line)) continue; // salta intestazione
      const raw = line.split(',');
      if (raw.length < 3) continue;                  // usa solo prime 3 colonne
      const codice = normalize(raw[0]);
      const descrizione = normalize(raw[1]);
      const scaffale = normalize(raw[2]);
      if (!codice || !descrizione || !scaffale) continue; // salta righe incomplete/virgole extra
      out.push({ codice, descrizione, scaffale });
    }
    return out;
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

  function waitForOpenCVReady(){
    return new Promise((resolve, reject) => {
      // If OpenCV is already loaded (cv.Mat exists), resolve immediately
      if (window.cv && cv.Mat) return resolve();
      const start = Date.now();
      const interval = setInterval(() => {
        if (window.cv && cv.Mat){
          clearInterval(interval);
          resolve();
        } else if (Date.now() - start > 10000) {
          clearInterval(interval);
          reject(new Error('OpenCV non pronto (timeout)'));
        }
      }, 50);
    });
  }

  async function loadCSV(){
    try{
      const res = await fetch(`/magazzino.csv?t=${Date.now()}`, { cache:'no-store' });
      const text = await res.text();
      DATA = parseCSV(text);
      buildShelves();
    }catch(e){
      console.error("Errore caricamento CSV:", e);
      DATA = [];
    }

    // Salva in cache centralizzata (separato dal try/catch principale)
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
      topResultsEl.innerHTML = '<div style="padding:6px 8px; font-size:18px;">Digita per iniziare la ricerca del codice. Visualizza il contenuto degli scaffali con il formato A01.</div>';
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

  async function decodeQRFromFile(file){
    if (!file) return null;
    await waitForOpenCVReady();

    const imgURL = URL.createObjectURL(file);
    try{
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const loaded = new Promise((res, rej) => {
        img.onload = () => res();
        img.onerror = (e) => rej(e);
      });
      img.src = imgURL;
      await loaded;

      // Riduci per performance se molto grande
      const maxSide = 1280;
      let { width, height } = img;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      const cw = Math.max(1, Math.round(width * scale));
      const ch = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);

      const src = cv.imread(canvas);
      const detector = new cv.QRCodeDetector();

      // Try 1: original
      let points = new cv.Mat();
      let straight = new cv.Mat();
      let result = detector.detectAndDecode(src, points, straight);
      points.delete(); straight.delete();

      // If not found, preprocess (grayscale + equalize + light blur)
      if (!result || !result.trim().length) {
        let gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // Contrast boost (prefer CLAHE if available, else equalizeHist)
        let enhanced = new cv.Mat();
        if (cv.createCLAHE) {
          try {
            const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
            clahe.apply(gray, enhanced);
            clahe.delete();
          } catch (_) {
            cv.equalizeHist(gray, enhanced);
          }
        } else {
          cv.equalizeHist(gray, enhanced);
        }

        // Light denoise to reduce JPEG artifacts
        let blurred = new cv.Mat();
        cv.GaussianBlur(enhanced, blurred, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

        points = new cv.Mat();
        straight = new cv.Mat();
        result = detector.detectAndDecode(blurred, points, straight);

        // Cleanup intermats
        gray.delete(); enhanced.delete(); blurred.delete();
        points.delete(); straight.delete();
      }

      // Last try: adaptive threshold (binary) which sometimes helps on low-contrast prints
      if (!result || !result.trim().length) {
        let gray2 = new cv.Mat();
        cv.cvtColor(src, gray2, cv.COLOR_RGBA2GRAY);
        let bin = new cv.Mat();
        cv.adaptiveThreshold(
          gray2,
          bin,
          255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          cv.THRESH_BINARY,
          31,
          2
        );
        points = new cv.Mat();
        straight = new cv.Mat();
        result = detector.detectAndDecode(bin, points, straight);
        gray2.delete(); bin.delete();
        points.delete(); straight.delete();
      }

      src.delete();
      detector.delete();

      if (result && typeof result === 'string' && result.trim().length) {
        return result.trim();
      }
      return null;
    } finally {
      URL.revokeObjectURL(imgURL);
    }
  }

  // Hook emoji fotocamera -> input file
  if (cameraBtn && fileInput){
    cameraBtn.addEventListener('click', () => {
      if (navigator.vibrate) navigator.vibrate(10);
      fileInput.click();
    });
    cameraBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' '){
        e.preventDefault();
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try{
        const code = await decodeQRFromFile(file);
        if (code){
          inputEl.value = code;
          updateResults();
        } else {
          console.warn('QR non riconosciuto');
          const prevPh = inputEl.getAttribute('placeholder') || '';
          // Clear any previous timer to avoid races
          if (placeholderTimer) {
            clearTimeout(placeholderTimer);
            placeholderTimer = null;
          }
          // Aggiunge stato di errore (gestito dal CSS)
          inputEl.classList.add('error');
          inputEl.setAttribute('placeholder', 'QR non riconosciuto.');
          // Dopo 2.5s ripristina placeholder e stato
          placeholderTimer = setTimeout(() => {
            inputEl.classList.remove('error');
            inputEl.setAttribute('placeholder', prevPh || 'Codice ricambio');
            placeholderTimer = null;
          }, 2500);
        }
      } catch(err){
        console.error('Errore durante la scansione QR:', err);
      } finally {
        // reset per poter ricaricare lo stesso file se serve
        fileInput.value = '';
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
      console.debug('[swipe] start', sx, sy);
    }, { passive: true });

    swipeRoot.addEventListener('touchend', (e) => {
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      console.debug('[swipe] end', t.clientX, t.clientY, 'dx=', dx, 'dy=', dy);

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

  // Carica CSV in background (non bloccante)
  async function loadCSVBackground() {
    try {
      await loadCSV();
      updateResults();  // Re-render con dati freschi
    } catch (e) {
      console.warn('Background CSV update fallito (non critico):', e);
    }
  }

  // Aggiorna database GitHub in background (con throttle)
  async function triggerDatabaseUpdate() {
    const THROTTLE_DURATION = 10 * 60 * 1000; // 10 minuti (ridotto spam GitHub)
    const LAST_TRIGGER_KEY = 'magazzino_last_update_trigger';

    try {
      const lastTrigger = localStorage.getItem(LAST_TRIGGER_KEY);
      const now = Date.now();

      // Controlla se è passato abbastanza tempo dall'ultimo trigger
      if (lastTrigger) {
        const elapsed = now - parseInt(lastTrigger);
        if (elapsed < THROTTLE_DURATION) {
          console.log(`Database update skipped (ultimo trigger: ${Math.round(elapsed / 1000)}s fa)`);
          return;
        }
      }

      // Triggera il workflow
      await fetch("https://aggiorna.marcellomaranzan.workers.dev/");

      // Salva timestamp del trigger
      localStorage.setItem(LAST_TRIGGER_KEY, now.toString());
      console.log('Database update triggered');
    } catch (err) {
      // Fallback silenzioso: continua con il CSV in cache
    }
  }

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

      // 2. Triggera aggiornamenti in background (non bloccanti)
      triggerDatabaseUpdate();  // GitHub workflow (throttled 10 min)
      loadCSVBackground();      // CSV refresh silenzioso

      return;
    }

    // 3. Fallback: nessuna cache, carica da rete
    triggerDatabaseUpdate();
    await loadCSV();

    const savedTheme = getSavedTheme();
    if (savedTheme === 'dark' || savedTheme === 'light') {
      applyTheme(savedTheme);
    }

    updateResults();
  })();
})();