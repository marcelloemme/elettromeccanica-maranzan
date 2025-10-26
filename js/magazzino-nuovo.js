// API Endpoint
const API_URL = 'https://script.google.com/macros/s/AKfycbxfDB-Pj3j0QcV8_cbbHP-M34phJZ0WpgFbkXCyPcOISuA-C_xb5jYqoLTISH_7V8vf/exec';

// Elementi DOM
const formNuovo = document.getElementById('form-nuovo');
const codiceInput = document.getElementById('codice');
const descrizioneInput = document.getElementById('descrizione');
const scaffaleInput = document.getElementById('scaffale');
const btnAnnulla = document.getElementById('btn-annulla');

const codaContainer = document.getElementById('coda-container');
const codaLista = document.getElementById('coda-lista');
const btnSvuotaCoda = document.getElementById('btn-svuota-coda');
const btnSalvaTutto = document.getElementById('btn-salva-tutto');

const popupConferma = document.getElementById('popup-conferma');
const popupCount = document.getElementById('popup-count');
const popupAnnullaConferma = document.getElementById('popup-annulla-conferma');
const popupConfermaSalva = document.getElementById('popup-conferma-salva');

const toast = document.getElementById('toast');
const counter = document.getElementById('counter');

// Stato
let coda = [];
let codiciEsistenti = new Set();

// Carica cache per validazione duplicati
function caricaCacheCodici() {
  try {
    const cached = localStorage.getItem('magazzino_cache');
    if (!cached) return;

    const ricambi = JSON.parse(cached);
    codiciEsistenti = new Set(ricambi.map(r => r.codice.toLowerCase()));
    console.log('Cache caricata:', codiciEsistenti.size, 'codici');
  } catch (e) {
    console.warn('Errore caricamento cache:', e);
  }
}

// Init
caricaCacheCodici();
codiceInput.focus();

// Event listeners
btnAnnulla.addEventListener('click', () => {
  if (coda.length > 0) {
    if (confirm('Hai ' + coda.length + ' ricambi in coda. Vuoi davvero uscire senza salvare?')) {
      window.location.href = '/private.html';
    }
  } else {
    window.location.href = '/private.html';
  }
});

formNuovo.addEventListener('submit', aggiungiAllaCoda);
btnSvuotaCoda.addEventListener('click', svuotaCoda);
btnSalvaTutto.addEventListener('click', confermaSalvataggio);
popupAnnullaConferma.addEventListener('click', () => popupConferma.classList.add('hidden'));
popupConfermaSalva.addEventListener('click', salvaTutto);

// Validazione real-time duplicati
codiceInput.addEventListener('input', () => {
  const codice = codiceInput.value.trim().toLowerCase();

  // Check in cache
  if (codice && codiciEsistenti.has(codice)) {
    codiceInput.setCustomValidity('Codice già esistente nel magazzino');
    return;
  }

  // Check in coda
  const inCoda = coda.some(r => r.codice.toLowerCase() === codice);
  if (codice && inCoda) {
    codiceInput.setCustomValidity('Codice già in coda');
    return;
  }

  codiceInput.setCustomValidity('');
});

// Aggiungi alla coda
function aggiungiAllaCoda(e) {
  e.preventDefault();

  const codice = codiceInput.value.trim();
  const descrizione = descrizioneInput.value.trim();
  const scaffale = scaffaleInput.value.trim();

  // Validazione duplicati
  if (codiciEsistenti.has(codice.toLowerCase())) {
    showToast('❌ Codice già esistente nel magazzino', 'error');
    codiceInput.focus();
    codiceInput.select();
    return;
  }

  const inCoda = coda.some(r => r.codice.toLowerCase() === codice.toLowerCase());
  if (inCoda) {
    showToast('❌ Codice già in coda', 'error');
    codiceInput.focus();
    codiceInput.select();
    return;
  }

  // Aggiungi alla coda
  coda.push({ codice, descrizione, scaffale });

  // Mostra toast
  showToast('✓ ' + codice + ' aggiunto alla coda', 'success');

  // Aggiorna UI
  aggiornaUI();

  // Reset form e focus
  formNuovo.reset();
  codiceInput.focus();
}

// Aggiorna UI
function aggiornaUI() {
  // Contatore
  counter.textContent = coda.length + ' in coda';

  // Mostra/nascondi container coda
  if (coda.length > 0) {
    codaContainer.classList.remove('hidden');
  } else {
    codaContainer.classList.add('hidden');
  }

  // Renderizza lista
  if (coda.length === 0) {
    codaLista.innerHTML = '<p class="empty-queue">Nessun ricambio in coda</p>';
    return;
  }

  codaLista.innerHTML = coda.map((r, index) => `
    <div class="coda-item">
      <div class="coda-item-content">
        <div class="coda-item-codice">${r.codice}</div>
        <div class="coda-item-desc">${r.descrizione}</div>
        <div class="coda-item-scaff">${r.scaffale}</div>
      </div>
      <button type="button" class="coda-item-remove" onclick="rimuoviDaCoda(${index})" title="Rimuovi">×</button>
    </div>
  `).join('');
}

// Rimuovi dalla coda
function rimuoviDaCoda(index) {
  const ricambio = coda[index];
  coda.splice(index, 1);
  showToast('✓ ' + ricambio.codice + ' rimosso dalla coda', 'success');
  aggiornaUI();
}

// Svuota coda
function svuotaCoda() {
  if (confirm('Vuoi davvero svuotare la coda (' + coda.length + ' ricambi)?')) {
    coda = [];
    aggiornaUI();
    showToast('✓ Coda svuotata', 'success');
  }
}

// Conferma salvataggio
function confermaSalvataggio() {
  if (coda.length === 0) {
    showToast('❌ Nessun ricambio in coda', 'error');
    return;
  }

  popupCount.textContent = coda.length;
  popupConferma.classList.remove('hidden');
}

// Salva tutto (batch insert)
async function salvaTutto() {
  popupConfermaSalva.disabled = true;
  popupConfermaSalva.textContent = 'Salvataggio...';
  btnSalvaTutto.disabled = true;

  try {
    // Timeout 25s (Google Apps Script ha timeout 30s)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    const res = await fetch(`${API_URL}?action=batchAddRicambi`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'batchAddRicambi',
        ricambi: coda
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Verifica status HTTP
    if (!res.ok) {
      const errorText = await res.text();
      console.error('HTTP Error:', res.status, errorText);
      throw new Error(`HTTP ${res.status}: ${errorText.substring(0, 100)}`);
    }

    const result = await res.json();

    if (result.success) {
      // Chiudi popup
      popupConferma.classList.add('hidden');

      // Aggiorna cache locale aggiungendo i nuovi ricambi (invece di invalidare)
      // Questo garantisce che i ricambi siano visibili SUBITO al prossimo accesso
      const cached = cacheManager.get('magazzino') || [];
      const nuoviRicambi = coda.map(r => ({
        codice: r.codice,
        descrizione: r.descrizione,
        scaffale: r.scaffale
      }));

      // Aggiungi nuovi ricambi alla cache esistente e riordina per codice
      const cacheAggiornata = [...nuoviRicambi, ...cached]
        .sort((a, b) => a.codice.localeCompare(b.codice));

      cacheManager.set('magazzino', cacheAggiornata);
      console.log(`[Magazzino] Cache aggiornata: +${nuoviRicambi.length} ricambi (totale: ${cacheAggiornata.length})`);

      // Triggera aggiornamento database GitHub (bypassa throttle)
      triggerDatabaseUpdateNow();

      // Toast success
      showToast('✓ ' + result.count + ' ricambi salvati con successo!', 'success');

      // Svuota coda
      coda = [];
      aggiornaUI();

      // Reset e focus
      codiceInput.focus();

      popupConfermaSalva.disabled = false;
      popupConfermaSalva.textContent = 'Conferma';
      btnSalvaTutto.disabled = false;
    } else {
      showToast('❌ ' + (result.error || 'Errore sconosciuto'), 'error');
      if (result.details) {
        console.error('Dettagli errori:', result.details);
      }
      popupConfermaSalva.disabled = false;
      popupConfermaSalva.textContent = 'Conferma';
      btnSalvaTutto.disabled = false;
    }
  } catch (err) {
    // Differenzia tra timeout e altri errori
    if (err.name === 'AbortError') {
      showToast('⏱️ Timeout - Verifica se dati salvati', 'error');
      console.error('Timeout dopo 25s:', err);
    } else {
      showToast('❌ Errore: ' + err.message, 'error');
      console.error('Errore salvaTutto:', err);
    }

    popupConfermaSalva.disabled = false;
    popupConfermaSalva.textContent = 'Conferma';
    btnSalvaTutto.disabled = false;
  }
}

// Toast notification
function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// Triggera aggiornamento database (bypassa throttle)
function triggerDatabaseUpdateNow() {
  const LAST_TRIGGER_KEY = 'magazzino_last_update_trigger';

  try {
    // Reset throttle per permettere trigger immediato
    localStorage.removeItem(LAST_TRIGGER_KEY);

    // Triggera workflow
    fetch("https://aggiorna.marcellomaranzan.workers.dev/")
      .then(() => {
        // Salva nuovo timestamp
        localStorage.setItem(LAST_TRIGGER_KEY, Date.now().toString());
        console.log('Database update triggered (dopo inserimento batch)');
      })
      .catch(err => {
        console.warn('Database update failed:', err);
      });
  } catch (err) {
    console.warn('Errore trigger database update:', err);
  }
}

// Esponi funzione globale per rimuoviDaCoda
window.rimuoviDaCoda = rimuoviDaCoda;
