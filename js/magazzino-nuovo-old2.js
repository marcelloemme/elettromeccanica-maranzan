// API Endpoint
const API_URL = 'https://script.google.com/macros/s/AKfycbyp2a0ue4xesDlzfRWsaXrkPZxVgzk175a7ld5UQaVrdP-UD6s06MSP8JtnzjTsW9R9/exec';

// Elementi DOM
const formNuovo = document.getElementById('form-nuovo');
const codiceInput = document.getElementById('codice');
const descrizioneInput = document.getElementById('descrizione');
const scaffaleInput = document.getElementById('scaffale');
const btnAnnulla = document.getElementById('btn-annulla');
const btnSubmit = formNuovo.querySelector('button[type="submit"]');

const popupConferma = document.getElementById('popup-conferma');
const popupRiepilogo = document.getElementById('popup-riepilogo');
const popupAnnullaConferma = document.getElementById('popup-annulla-conferma');
const popupConfermaSalva = document.getElementById('popup-conferma-salva');

const toast = document.getElementById('toast');
const counter = document.getElementById('counter');

// Stato
let inserimentiCount = 0;
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
  window.location.href = '/private.html';
});

formNuovo.addEventListener('submit', handleSubmit);
popupAnnullaConferma.addEventListener('click', () => popupConferma.classList.add('hidden'));

// Validazione real-time duplicati
codiceInput.addEventListener('input', () => {
  const codice = codiceInput.value.trim().toLowerCase();
  if (codice && codiciEsistenti.has(codice)) {
    codiceInput.setCustomValidity('Codice già esistente');
    codiceInput.reportValidity();
  } else {
    codiceInput.setCustomValidity('');
  }
});

// Handle submit
function handleSubmit(e) {
  e.preventDefault();

  const dati = {
    codice: codiceInput.value.trim(),
    descrizione: descrizioneInput.value.trim(),
    scaffale: scaffaleInput.value.trim()
  };

  // Validazione duplicati client-side
  if (codiciEsistenti.has(dati.codice.toLowerCase())) {
    showToast('❌ Codice già esistente', 'error');
    codiceInput.focus();
    codiceInput.select();
    return;
  }

  // Mostra popup conferma
  popupRiepilogo.innerHTML = `
    <p><strong>Codice:</strong> ${dati.codice}</p>
    <p><strong>Descrizione:</strong> ${dati.descrizione}</p>
    <p><strong>Scaffale:</strong> ${dati.scaffale}</p>
  `;

  popupConferma.classList.remove('hidden');

  // Salva dati per conferma
  popupConfermaSalva.onclick = () => salvaRicambio(dati);
}

// Salva ricambio
async function salvaRicambio(dati) {
  popupConfermaSalva.disabled = true;
  popupConfermaSalva.textContent = 'Salvataggio...';
  btnSubmit.disabled = true;

  try {
    const res = await fetch(`${API_URL}?action=addRicambio`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'addRicambio',
        codice: dati.codice,
        descrizione: dati.descrizione,
        scaffale: dati.scaffale
      })
    });

    const result = await res.json();

    if (result.success) {
      // Chiudi popup
      popupConferma.classList.add('hidden');

      // Aggiorna cache locale
      codiciEsistenti.add(dati.codice.toLowerCase());

      // Invalida cache magazzino per forzare refresh
      localStorage.removeItem('magazzino_cache');
      localStorage.removeItem('magazzino_cache_timestamp');

      // Incrementa contatore
      inserimentiCount++;
      counter.textContent = `${inserimentiCount} inserit${inserimentiCount === 1 ? 'o' : 'i'}`;

      // Toast success
      showToast(`✓ ${dati.codice} aggiunto`, 'success');

      // Reset form
      formNuovo.reset();

      // Auto-focus per inserimento veloce
      setTimeout(() => {
        codiceInput.focus();
      }, 100);

      popupConfermaSalva.disabled = false;
      popupConfermaSalva.textContent = 'Conferma';
      btnSubmit.disabled = false;
    } else {
      showToast('❌ ' + (result.error || 'Errore sconosciuto'), 'error');
      popupConfermaSalva.disabled = false;
      popupConfermaSalva.textContent = 'Conferma';
      btnSubmit.disabled = false;
    }
  } catch (err) {
    showToast('❌ Errore di connessione', 'error');
    popupConfermaSalva.disabled = false;
    popupConfermaSalva.textContent = 'Conferma';
    btnSubmit.disabled = false;
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
