// API Endpoint
const API_URL = 'https://script.google.com/macros/s/AKfycbxdsZtism0HvHXBo2ZwmYaf1jEV69FNqVCLZM4Lfs2diP8AO7KbEV7jbAAmpdrGouDoGg/exec';

// Elementi DOM
const form = document.getElementById('form-nuova');
const dataConsegnaInput = document.getElementById('data-consegna');
const clienteInput = document.getElementById('cliente');
const indirizzoInput = document.getElementById('indirizzo');
const telefonoInput = document.getElementById('telefono');
const ddtInput = document.getElementById('ddt');
const attrezziContainer = document.getElementById('attrezzi-container');
const addAttrezzoBtn = document.getElementById('add-attrezzo');
const btnAnnulla = document.getElementById('btn-annulla');
const autocompleteList = document.getElementById('autocomplete-list');

const popupConferma = document.getElementById('popup-conferma');
const popupRiepilogo = document.getElementById('popup-riepilogo');
const popupAnnulla = document.getElementById('popup-annulla');
const popupConfermaBtn = document.getElementById('popup-conferma-btn');

const popupSuccesso = document.getElementById('popup-successo');
const popupSuccessoMsg = document.getElementById('popup-successo-msg');
const popupOk = document.getElementById('popup-ok');

// Stato
let clienti = [];
let attrezziCount = 0;

// Init
(async () => {
  // Imposta data di oggi come default
  const oggi = new Date().toISOString().split('T')[0];
  dataConsegnaInput.value = oggi;

  // Aggiungi primo attrezzo subito
  addAttrezzo();

  // Mostra form immediatamente con numero placeholder
  const anno = new Date().getFullYear() % 100;
  document.querySelector('.header h1').textContent = `Nuova Riparazione ${anno}/????`;

  // Nascondi loading e mostra form SUBITO
  const loadingOverlay = document.getElementById('loading-overlay');
  const appMain = document.querySelector('.app');

  loadingOverlay.classList.add('hidden');
  appMain.style.opacity = '1';
  appMain.style.transition = 'opacity 0.3s ease';

  // Burger menu -> torna all'archivio
  const burgerMenu = document.getElementById('burger-menu');
  if (burgerMenu) {
    burgerMenu.addEventListener('click', () => {
      if (navigator.vibrate) navigator.vibrate(10);
      window.location.href = '/html/riparazioni-archivio.html';
    });
    burgerMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (navigator.vibrate) navigator.vibrate(10);
        window.location.href = '/html/riparazioni-archivio.html';
      }
    });
  }

  // Carica dati in background
  loadClientiCached();
  mostraProssimoNumero();
})();

// Mostra prossimo numero nel titolo (ottimizzato - endpoint leggero)
async function mostraProssimoNumero() {
  try {
    const res = await fetch(`${API_URL}?action=getNextNumero`, {
      redirect: 'follow'
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const data = await res.json();
    const prossimoNumero = data.nextNumero;

    console.log('Prossimo numero:', prossimoNumero);
    document.querySelector('.header h1').textContent = `Nuova Riparazione ${prossimoNumero}`;
  } catch (err) {
    console.error('Errore caricamento numero:', err);
    // Fallback: mostra placeholder
    const anno = new Date().getFullYear() % 100;
    const fallbackNumero = `${anno}/????`;
    document.querySelector('.header h1').textContent = `Nuova Riparazione ${fallbackNumero}`;
  }
}

// Carica lista clienti con cache
async function loadClientiCached() {
  // Prova a caricare dalla cache
  const cached = cacheManager.get('clienti');
  if (cached) {
    clienti = cached;
    // Aggiorna in background senza bloccare
    loadClienti();
    return;
  }

  // Altrimenti carica da API
  await loadClienti();
}

// Carica lista clienti da API
async function loadClienti() {
  try {
    const res = await fetch(`${API_URL}?action=getClienti`, {
      redirect: 'follow'
    });
    const data = await res.json();
    clienti = data.clienti || [];

    // Salva in cache centralizzata
    cacheManager.set('clienti', clienti);
  } catch (err) {
    console.error('Errore caricamento clienti:', err);
    clienti = [];
  }
}

// Normalizza stringa (rimuove accenti e caratteri speciali)
function normalizeString(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Rimuove accenti
    .replace(/[^a-z0-9\s]/g, ''); // Rimuove caratteri speciali
}

// Calcola score di rilevanza
function calculateRelevance(nome, query) {
  const nomeNorm = normalizeString(nome);
  const queryNorm = normalizeString(query);

  // Match esatto (100 punti)
  if (nomeNorm === queryNorm) return 100;

  // Inizia con query (90 punti)
  if (nomeNorm.startsWith(queryNorm)) return 90;

  // Contiene query completa (80 punti)
  if (nomeNorm.includes(queryNorm)) return 80;

  // Match multi-parola: tutte le parole della query sono nel nome
  const queryWords = queryNorm.split(/\s+/).filter(w => w.length > 0);
  const allWordsMatch = queryWords.every(word => nomeNorm.includes(word));

  if (allWordsMatch) {
    // Conta quante parole matchano all'inizio (più punti se matchano dall'inizio)
    const startsMatches = queryWords.filter(word => {
      const words = nomeNorm.split(/\s+/);
      return words.some(w => w.startsWith(word));
    }).length;
    return 60 + (startsMatches * 5);
  }

  return 0;
}

// Autocomplete cliente MIGLIORATO
clienteInput.addEventListener('input', (e) => {
  const query = e.target.value.trim();

  if (query.length < 2) {
    autocompleteList.classList.remove('show');
    return;
  }

  // Filtra e calcola score per ogni cliente
  const matches = clienti
    .map(c => ({
      ...c,
      score: calculateRelevance(c.nome, query)
    }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score) // Ordina per rilevanza
    .slice(0, 10); // Massimo 10 risultati

  if (matches.length === 0) {
    autocompleteList.classList.remove('show');
    return;
  }

  autocompleteList.innerHTML = matches.map(c => `
    <div class="autocomplete-item" data-nome="${c.nome}" data-telefono="${c.telefono}" data-indirizzo="${c.indirizzo || ''}">
      ${c.nome} - ${c.telefono}${c.indirizzo ? ' - ' + c.indirizzo : ''}
    </div>
  `).join('');

  autocompleteList.classList.add('show');

  // Event listeners per i suggerimenti
  document.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('click', () => {
      clienteInput.value = item.dataset.nome;
      indirizzoInput.value = item.dataset.indirizzo || '';
      telefonoInput.value = item.dataset.telefono;
      autocompleteList.classList.remove('show');
    });
  });
});

// Chiudi autocomplete quando click fuori
document.addEventListener('click', (e) => {
  if (!e.target.closest('.form-group')) {
    autocompleteList.classList.remove('show');
  }
});

// Aggiungi attrezzo
function addAttrezzo() {
  attrezziCount++;
  const div = document.createElement('div');
  div.className = 'attrezzo-item';
  div.dataset.index = attrezziCount;
  div.innerHTML = `
    <div class="attrezzo-header">
      <span class="attrezzo-label">Attrezzo ${attrezziCount}</span>
      <button type="button" class="btn-remove" onclick="removeAttrezzo(${attrezziCount})">×</button>
    </div>
    <input type="text" placeholder="Marca/Modello" data-field="marca" required />
    <input type="text" placeholder="Dotazione (es: batteria, caricabatterie)" data-field="dotazione" />
    <input type="text" placeholder="Note (difetto/problema)" data-field="note" />
  `;
  attrezziContainer.appendChild(div);
}

function removeAttrezzo(index) {
  const item = document.querySelector(`[data-index="${index}"]`);
  if (item) item.remove();

  // Rinumera gli attrezzi
  document.querySelectorAll('.attrezzo-item').forEach((el, i) => {
    el.querySelector('.attrezzo-label').textContent = `Attrezzo ${i + 1}`;
  });
}

addAttrezzoBtn.addEventListener('click', addAttrezzo);

// Submit form
form.addEventListener('submit', (e) => {
  e.preventDefault();

  // Raccogli dati
  const dataConsegna = dataConsegnaInput.value;
  const cliente = clienteInput.value.trim();
  const indirizzo = indirizzoInput.value.trim();
  const telefono = telefonoInput.value.trim();
  const ddt = ddtInput.checked;

  // Raccogli attrezzi
  const attrezzi = [];
  document.querySelectorAll('.attrezzo-item').forEach(item => {
    const marca = item.querySelector('[data-field="marca"]').value.trim();
    const dotazione = item.querySelector('[data-field="dotazione"]').value.trim();
    const note = item.querySelector('[data-field="note"]').value.trim();
    if (marca) {
      attrezzi.push({ marca, dotazione, note });
    }
  });

  if (attrezzi.length === 0) {
    alert('Aggiungi almeno un attrezzo');
    return;
  }

  // Mostra popup conferma
  mostraPopupConferma({ dataConsegna, cliente, indirizzo, telefono, ddt, attrezzi });
});

// Mostra popup conferma
function mostraPopupConferma(dati) {
  const { dataConsegna, cliente, indirizzo, telefono, ddt, attrezzi } = dati;

  const dataFormattata = new Date(dataConsegna + 'T00:00:00').toLocaleDateString('it-IT');
  const attrezziHtml = attrezzi.map((a, i) => {
    let dettagli = a.marca;
    if (a.dotazione) dettagli += ` - ${a.dotazione}`;
    if (a.note) dettagli += ` (${a.note})`;
    return `<p><strong>Attrezzo ${i + 1}:</strong> ${dettagli}</p>`;
  }).join('');

  popupRiepilogo.innerHTML = `
    <p><strong>Data consegna:</strong> ${dataFormattata}</p>
    <p><strong>Cliente:</strong> ${cliente}</p>
    ${indirizzo ? `<p><strong>Indirizzo:</strong> ${indirizzo}</p>` : ''}
    <p><strong>Telefono:</strong> ${telefono}</p>
    <p><strong>Documento di Trasporto:</strong> ${ddt ? 'Sì' : 'No'}</p>
    ${attrezziHtml}
  `;

  popupConferma.classList.remove('hidden');

  // Salva dati per conferma
  popupConfermaBtn.onclick = () => inviaRiparazione(dati);
}

// Invia riparazione
async function inviaRiparazione(dati) {
  popupConfermaBtn.disabled = true;
  popupConfermaBtn.textContent = 'Invio...';

  try {
    const res = await fetch(`${API_URL}?action=createRiparazione`, {
      method: 'POST',
      body: JSON.stringify(dati)
    });

    const result = await res.json();

    if (result.success) {
      // Invalida cache riparazioni per aggiornare archivio
      cacheManager.invalidate('riparazioni');
      // Invalida cache clienti per aggiornare autocomplete
      cacheManager.invalidate('clienti');

      popupConferma.classList.add('hidden');
      popupSuccessoMsg.textContent = `Riparazione ${result.numero} creata con successo!`;
      popupSuccesso.classList.remove('hidden');
    } else {
      alert('Errore: ' + (result.error || 'Errore sconosciuto'));
      popupConfermaBtn.disabled = false;
      popupConfermaBtn.textContent = 'Conferma';
    }
  } catch (err) {
    alert('Errore di connessione: ' + err.message);
    popupConfermaBtn.disabled = false;
    popupConfermaBtn.textContent = 'Conferma';
  }
}

// Popup annulla
popupAnnulla.addEventListener('click', () => {
  popupConferma.classList.add('hidden');
  popupConfermaBtn.disabled = false;
  popupConfermaBtn.textContent = 'Conferma';
});

// Popup OK (successo) - ricarica pagina per nuovo inserimento
popupOk.addEventListener('click', () => {
  window.location.reload();
});

// Bottone annulla - torna a /private senza conferma
btnAnnulla.addEventListener('click', () => {
  window.location.href = '/private.html';
});
