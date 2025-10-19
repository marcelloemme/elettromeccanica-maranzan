// API Endpoint
const API_URL = 'https://script.google.com/macros/s/AKfycbyp2a0ue4xesDlzfRWsaXrkPZxVgzk175a7ld5UQaVrdP-UD6s06MSP8JtnzjTsW9R9/exec';

// Elementi DOM
const titolo = document.getElementById('titolo-codice');
const detailCodice = document.getElementById('detail-codice');
const detailDescrizione = document.getElementById('detail-descrizione');
const detailScaffale = document.getElementById('detail-scaffale');

const btnModifica = document.getElementById('btn-modifica');
const btnElimina = document.getElementById('btn-elimina');
const btnMagazzino = document.getElementById('btn-magazzino');

const popupModifica = document.getElementById('popup-modifica');
const formModifica = document.getElementById('form-modifica');
const editCodice = document.getElementById('edit-codice');
const editDescrizione = document.getElementById('edit-descrizione');
const editScaffale = document.getElementById('edit-scaffale');
const popupAnnulla = document.getElementById('popup-annulla');

const popupConfermaModifica = document.getElementById('popup-conferma-modifica');
const popupRiepilogoModifica = document.getElementById('popup-riepilogo-modifica');
const popupConfermaAnnulla = document.getElementById('popup-conferma-annulla');
const popupConfermaSalva = document.getElementById('popup-conferma-salva');

const popupConfermaElimina = document.getElementById('popup-conferma-elimina');
const popupRiepilogoElimina = document.getElementById('popup-riepilogo-elimina');
const popupEliminaAnnulla = document.getElementById('popup-elimina-annulla');
const popupEliminaConferma = document.getElementById('popup-elimina-conferma');

const loadingOverlay = document.getElementById('loading-overlay');
const appMain = document.querySelector('.app');

// Stato
let ricambioCorrente = null;

// Init
(async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const codice = urlParams.get('codice');

  if (!codice) {
    alert('Codice ricambio mancante');
    window.location.href = '/magazzino.html';
    return;
  }

  await caricaRicambio(codice);
  setupEventListeners();

  loadingOverlay.classList.add('hidden');
  appMain.style.opacity = '1';
  appMain.style.transition = 'opacity 0.3s ease';
})();

// Carica ricambio
async function caricaRicambio(codice) {
  try {
    const res = await fetch(`${API_URL}?action=getRicambio&codice=${encodeURIComponent(codice)}`, {
      redirect: 'follow'
    });
    const data = await res.json();

    if (data.error) {
      throw new Error(data.error);
    }

    ricambioCorrente = data.ricambio;
    renderDettaglio();
  } catch (err) {
    console.error('Errore caricamento ricambio:', err);
    alert('Errore: ' + err.message);
    window.location.href = '/magazzino.html';
  }
}

// Render dettaglio
function renderDettaglio() {
  const r = ricambioCorrente;

  titolo.textContent = `Ricambio ${r.Codice}`;
  detailCodice.textContent = r.Codice;
  detailDescrizione.textContent = r.Descrizione || '-';
  detailScaffale.textContent = r.Scaffale || '-';
}

// Setup event listeners
function setupEventListeners() {
  btnModifica.addEventListener('click', apriModifica);
  btnElimina.addEventListener('click', apriConfermaElimina);
  btnMagazzino.addEventListener('click', () => window.location.href = '/magazzino.html');

  popupAnnulla.addEventListener('click', () => popupModifica.classList.add('hidden'));
  formModifica.addEventListener('submit', handleSubmitModifica);

  popupConfermaAnnulla.addEventListener('click', () => popupConfermaModifica.classList.add('hidden'));
  popupConfermaSalva.addEventListener('click', salvaModifiche);

  popupEliminaAnnulla.addEventListener('click', () => popupConfermaElimina.classList.add('hidden'));
  popupEliminaConferma.addEventListener('click', eliminaRicambio);
}

// Apri popup modifica
function apriModifica() {
  const r = ricambioCorrente;

  editCodice.value = r.Codice;
  editDescrizione.value = r.Descrizione || '';
  editScaffale.value = r.Scaffale || '';

  popupModifica.classList.remove('hidden');
}

// Handle submit modifica
function handleSubmitModifica(e) {
  e.preventDefault();

  const dati = {
    codice: editCodice.value.trim(),
    descrizione: editDescrizione.value.trim(),
    scaffale: editScaffale.value.trim()
  };

  mostraPopupConfermaModifica(dati);
}

// Mostra popup conferma modifiche
function mostraPopupConfermaModifica(dati) {
  popupRiepilogoModifica.innerHTML = `
    <p><strong>Codice:</strong> ${dati.codice}</p>
    <p><strong>Descrizione:</strong> ${dati.descrizione}</p>
    <p><strong>Scaffale:</strong> ${dati.scaffale}</p>
  `;

  popupConfermaModifica.classList.remove('hidden');

  popupConfermaSalva.onclick = () => salvaModifiche(dati);
}

// Salva modifiche
async function salvaModifiche(dati) {
  popupConfermaSalva.disabled = true;
  popupConfermaSalva.textContent = 'Salvataggio...';

  try {
    const res = await fetch(`${API_URL}?action=updateRicambio`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'updateRicambio',
        codice: dati.codice,
        descrizione: dati.descrizione,
        scaffale: dati.scaffale
      })
    });

    const result = await res.json();

    if (result.success) {
      popupConfermaModifica.classList.add('hidden');
      popupModifica.classList.add('hidden');

      // Ricarica i dati
      await caricaRicambio(dati.codice);

      alert('Modifiche salvate con successo!');

      popupConfermaSalva.disabled = false;
      popupConfermaSalva.textContent = 'Conferma';
    } else {
      alert('Errore: ' + (result.error || 'Errore sconosciuto'));
      popupConfermaSalva.disabled = false;
      popupConfermaSalva.textContent = 'Conferma';
    }
  } catch (err) {
    alert('Errore di connessione: ' + err.message);
    popupConfermaSalva.disabled = false;
    popupConfermaSalva.textContent = 'Conferma';
  }
}

// Apri conferma eliminazione
function apriConfermaElimina() {
  const r = ricambioCorrente;

  popupRiepilogoElimina.innerHTML = `
    <p><strong>Codice:</strong> ${r.Codice}</p>
    <p><strong>Descrizione:</strong> ${r.Descrizione}</p>
    <p><strong>Scaffale:</strong> ${r.Scaffale}</p>
  `;

  popupConfermaElimina.classList.remove('hidden');
}

// Elimina ricambio
async function eliminaRicambio() {
  popupEliminaConferma.disabled = true;
  popupEliminaConferma.textContent = 'Eliminazione...';

  try {
    const res = await fetch(`${API_URL}?action=deleteRicambio`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'deleteRicambio',
        codice: ricambioCorrente.Codice
      })
    });

    const result = await res.json();

    if (result.success) {
      alert('Ricambio eliminato con successo!');
      window.location.href = '/magazzino.html';
    } else {
      alert('Errore: ' + (result.error || 'Errore sconosciuto'));
      popupEliminaConferma.disabled = false;
      popupEliminaConferma.textContent = 'Elimina';
    }
  } catch (err) {
    alert('Errore di connessione: ' + err.message);
    popupEliminaConferma.disabled = false;
    popupEliminaConferma.textContent = 'Elimina';
  }
}
