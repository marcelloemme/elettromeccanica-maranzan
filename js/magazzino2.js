(() => {
  const inputEl = document.getElementById('codice-input');
  const topResultsEl = document.getElementById('top-results');
  const suggestionsEl = document.getElementById('suggestions');
  const keypad = document.querySelector('.keypad');

  let DATA = [];
  let LAST_QUERY = "";

  // ---------- Utils ----------
  const normalize = s => (s || "").trim();
  const basePart = code => normalize(code).replace(/-\d+$/,"");

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

  async function loadCSV(){
    try{
      const res = await fetch(`magazzino.csv?t=${Date.now()}`, { cache:'no-store' });
      const text = await res.text();
      DATA = parseCSV(text);
    }catch(e){
      console.error("Errore caricamento CSV:", e);
      DATA = [];
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
      <tr>
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

    if (!q) return;

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

  // Debounce leggero
  let debounceTimer;
  function onInputChange(){
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

  // Init
  (async () => {
    await loadCSV();
    // (volendo: mostrare i primi 10 globali all'avvio)
    // const first10 = DATA.slice(0,10);
    // topResultsEl.innerHTML = `<h3>Primi 10</h3>${renderTable(first10)}`;
  })();
})();