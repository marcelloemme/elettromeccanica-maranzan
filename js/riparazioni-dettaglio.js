// API Endpoint
const API_URL = 'https://script.google.com/macros/s/AKfycbxdsZtism0HvHXBo2ZwmYaf1jEV69FNqVCLZM4Lfs2diP8AO7KbEV7jbAAmpdrGouDoGg/exec';

// Elementi DOM
const titolo = document.getElementById('titolo-numero');
const detailData = document.getElementById('detail-data');
const detailCliente = document.getElementById('detail-cliente');
const detailIndirizzo = document.getElementById('detail-indirizzo');
const detailTelefono = document.getElementById('detail-telefono');
const detailDdt = document.getElementById('detail-ddt');
const detailAttrezzi = document.getElementById('detail-attrezzi');
const detailStato = document.getElementById('detail-stato');
const detailDataCompletamento = document.getElementById('detail-data-completamento');
const detailGroupCompletamento = document.getElementById('detail-group-completamento');

const btnModifica = document.getElementById('btn-modifica');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnArchivio = document.getElementById('btn-archivio');

const popupModifica = document.getElementById('popup-modifica');
const formModifica = document.getElementById('form-modifica');
const editData = document.getElementById('edit-data');
const editCliente = document.getElementById('edit-cliente');
const editIndirizzo = document.getElementById('edit-indirizzo');
const editTelefono = document.getElementById('edit-telefono');
const editDdt = document.getElementById('edit-ddt');
const editAttrezziContainer = document.getElementById('edit-attrezzi-container');
const editAddAttrezzo = document.getElementById('edit-add-attrezzo');
const editCompletato = document.getElementById('edit-completato');
const popupAnnulla = document.getElementById('popup-annulla');

const popupConfermaModifica = document.getElementById('popup-conferma-modifica');
const popupRiepilogoModifica = document.getElementById('popup-riepilogo-modifica');
const popupConfermaAnnulla = document.getElementById('popup-conferma-annulla');
const popupConfermaSalva = document.getElementById('popup-conferma-salva');

const loadingOverlay = document.getElementById('loading-overlay');
const appMain = document.querySelector('.app');

// Stato
let riparazioneCorrente = null;
let tutteRiparazioni = [];
let editAttrezziCount = 0;

// Init
(async () => {
  // Ottieni numero dalla URL
  const urlParams = new URLSearchParams(window.location.search);
  const numero = urlParams.get('numero');

  if (!numero) {
    alert('Numero riparazione mancante');
    window.location.href = '/html/riparazioni-archivio.html';
    return;
  }

  // Prova a caricare da cache prima
  const cached = cacheManager.get('riparazioni');

  if (cached && cached.length > 0) {
    tutteRiparazioni = cached;
    // Cache valida trovata - mostra subito i dati
    const riparazioneTrovata = tutteRiparazioni.find(r => r.Numero === numero);
    if (riparazioneTrovata) {
      riparazioneCorrente = riparazioneTrovata;
      renderDettaglio();
      aggiornaNavigazione();

      loadingOverlay.classList.add('hidden');
      appMain.style.opacity = '1';
      appMain.style.transition = 'opacity 0.3s ease';

      setupEventListeners();

      // Aggiorna in background per avere dati freschi
      caricaTutteRiparazioni().then(() => {
        const riparazioneAggiornata = tutteRiparazioni.find(r => r.Numero === numero);
        if (riparazioneAggiornata) {
          riparazioneCorrente = riparazioneAggiornata;
          renderDettaglio();
          aggiornaNavigazione();
        }
      });

      return;
    }
  }

  // Nessuna cache o riparazione non trovata - carica da API
  await caricaTutteRiparazioni();
  await caricaRiparazione(numero);

  setupEventListeners();

  loadingOverlay.classList.add('hidden');
  appMain.style.opacity = '1';
  appMain.style.transition = 'opacity 0.3s ease';
})();

// Carica tutte le riparazioni (per navigazione prev/next)
async function caricaTutteRiparazioni() {
  try {
    const res = await fetch(`${API_URL}?action=getRiparazioni`, {
      redirect: 'follow'
    });
    const data = await res.json();
    tutteRiparazioni = data.riparazioni || [];

    // Ordina per numero (anno/numero decrescente: più recenti prima)
    tutteRiparazioni.sort((a, b) => {
      const [annoA, numA] = a.Numero.split('/').map(Number);
      const [annoB, numB] = b.Numero.split('/').map(Number);
      if (annoB !== annoA) return annoB - annoA; // Anno decrescente
      return numB - numA; // Numero decrescente
    });

    // Salva in cache centralizzata
    cacheManager.set('riparazioni', tutteRiparazioni);
  } catch (err) {
    console.error('Errore caricamento riparazioni:', err);
    tutteRiparazioni = [];
  }
}

// Carica singola riparazione
async function caricaRiparazione(numero) {
  try {
    // Se abbiamo già tutte le riparazioni, cerca lì prima
    if (tutteRiparazioni.length > 0) {
      const riparazioneTrovata = tutteRiparazioni.find(r => r.Numero === numero);
      if (riparazioneTrovata) {
        riparazioneCorrente = riparazioneTrovata;
        renderDettaglio();
        aggiornaNavigazione();
        return;
      }
    }

    // Altrimenti fai chiamata API specifica
    const res = await fetch(`${API_URL}?action=getRiparazione&numero=${encodeURIComponent(numero)}`, {
      redirect: 'follow'
    });
    const data = await res.json();

    if (data.error) {
      throw new Error(data.error);
    }

    riparazioneCorrente = data.riparazione;
    renderDettaglio();
    aggiornaNavigazione();
  } catch (err) {
    console.error('Errore caricamento riparazione:', err);
    alert('Errore: ' + err.message);
    window.location.href = '/html/riparazioni-archivio.html';
  }
}

// Render dettaglio
function renderDettaglio() {
  const r = riparazioneCorrente;

  titolo.textContent = `Riparazione ${r.Numero}`;
  detailData.textContent = formatData(r['Data Consegna'] || r['Data consegna'] || r.DataConsegna);
  detailCliente.textContent = r.Cliente || '-';
  detailIndirizzo.textContent = r.Indirizzo || '-';
  detailTelefono.textContent = r.Telefono || '-';
  detailDdt.textContent = r.DDT ? 'Sì' : 'No';

  // Attrezzi
  const attrezzi = typeof r.Attrezzi === 'string' ? JSON.parse(r.Attrezzi) : (r.Attrezzi || []);
  if (attrezzi.length > 0) {
    detailAttrezzi.innerHTML = attrezzi.map(a => `
      <div class="attrezzo-card">
        <h4>${a.marca || '-'}</h4>
        ${a.dotazione ? `<p><strong>Dotazione:</strong> ${a.dotazione}</p>` : ''}
        ${a.note ? `<p><strong>Note:</strong> ${a.note}</p>` : ''}
      </div>
    `).join('');
  } else {
    detailAttrezzi.innerHTML = '<p>Nessun attrezzo</p>';
  }

  // Stato
  const stato = r.Completato ?
    '<span class="badge completato-si">Completato</span>' :
    '<span class="badge completato-no">In corso</span>';
  detailStato.innerHTML = stato;

  // Data Completamento (mostra solo se completato e data presente)
  const dataCompletamento = r['Data Completamento'] || r['Data completamento'] || r.DataCompletamento;
  if (r.Completato && dataCompletamento) {
    detailDataCompletamento.textContent = formatData(dataCompletamento);
    detailGroupCompletamento.style.display = 'block';
  } else {
    detailGroupCompletamento.style.display = 'none';
  }
}

// Formatta data
function formatData(dataStr) {
  if (!dataStr) return '-';
  try {
    const data = new Date(dataStr);
    return data.toLocaleDateString('it-IT');
  } catch {
    return dataStr;
  }
}

// Aggiorna navigazione prev/next
function aggiornaNavigazione() {
  const indiceCorrente = tutteRiparazioni.findIndex(r => r.Numero === riparazioneCorrente.Numero);

  btnPrev.disabled = indiceCorrente <= 0;
  btnNext.disabled = indiceCorrente >= tutteRiparazioni.length - 1;

  btnPrev.style.opacity = btnPrev.disabled ? '0.3' : '1';
  btnNext.style.opacity = btnNext.disabled ? '0.3' : '1';
}

// Setup event listeners
function setupEventListeners() {
  btnModifica.addEventListener('click', apriModifica);
  btnArchivio.addEventListener('click', () => window.location.href = '/html/riparazioni-archivio.html');
  btnPrev.addEventListener('click', navigaPrev);
  btnNext.addEventListener('click', navigaNext);

  popupAnnulla.addEventListener('click', () => popupModifica.classList.add('hidden'));
  formModifica.addEventListener('submit', handleSubmitModifica);

  popupConfermaAnnulla.addEventListener('click', () => popupConfermaModifica.classList.add('hidden'));
  popupConfermaSalva.addEventListener('click', salvaModifiche);

  editAddAttrezzo.addEventListener('click', addAttrezzoEdit);
}

// Navigazione
function navigaPrev() {
  const indice = tutteRiparazioni.findIndex(r => r.Numero === riparazioneCorrente.Numero);
  if (indice > 0) {
    const prev = tutteRiparazioni[indice - 1];
    // Navigazione istantanea senza reload
    riparazioneCorrente = prev;
    renderDettaglio();
    aggiornaNavigazione();
    // Aggiorna URL senza reload
    window.history.pushState({}, '', `/html/riparazioni-dettaglio.html?numero=${encodeURIComponent(prev.Numero)}`);
  }
}

function navigaNext() {
  const indice = tutteRiparazioni.findIndex(r => r.Numero === riparazioneCorrente.Numero);
  if (indice < tutteRiparazioni.length - 1) {
    const next = tutteRiparazioni[indice + 1];
    // Navigazione istantanea senza reload
    riparazioneCorrente = next;
    renderDettaglio();
    aggiornaNavigazione();
    // Aggiorna URL senza reload
    window.history.pushState({}, '', `/html/riparazioni-dettaglio.html?numero=${encodeURIComponent(next.Numero)}`);
  }
}

// Apri popup modifica
function apriModifica() {
  const r = riparazioneCorrente;

  // Popola form
  const dataConsegna = r['Data Consegna'] || r['Data consegna'] || r.DataConsegna;
  // Converti data in formato YYYY-MM-DD per input type="date"
  if (dataConsegna) {
    const date = new Date(dataConsegna);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    editData.value = `${year}-${month}-${day}`;
  }
  editCliente.value = r.Cliente || '';
  editIndirizzo.value = r.Indirizzo || '';
  editTelefono.value = r.Telefono || '';
  editDdt.checked = r.DDT || false;
  editCompletato.checked = r.Completato || false;

  // Attrezzi
  editAttrezziContainer.innerHTML = '';
  editAttrezziCount = 0;

  const attrezzi = typeof r.Attrezzi === 'string' ? JSON.parse(r.Attrezzi) : (r.Attrezzi || []);
  if (attrezzi.length > 0) {
    attrezzi.forEach(a => addAttrezzoEdit(a.marca, a.dotazione, a.note));
  } else {
    addAttrezzoEdit();
  }

  popupModifica.classList.remove('hidden');
}

// Aggiungi attrezzo al form modifica
function addAttrezzoEdit(marca = '', dotazione = '', note = '') {
  editAttrezziCount++;
  const div = document.createElement('div');
  div.className = 'attrezzo-item';
  div.dataset.index = editAttrezziCount;
  div.innerHTML = `
    <div class="attrezzo-header">
      <span class="attrezzo-label">Attrezzo ${editAttrezziCount}</span>
      <button type="button" class="btn-remove" onclick="removeAttrezzoEdit(${editAttrezziCount})">×</button>
    </div>
    <input type="text" placeholder="Marca/Modello" data-field="marca" value="${marca}" required />
    <input type="text" placeholder="Dotazione" data-field="dotazione" value="${dotazione}" />
    <input type="text" placeholder="Note" data-field="note" value="${note}" />
  `;
  editAttrezziContainer.appendChild(div);
}

function removeAttrezzoEdit(index) {
  const item = editAttrezziContainer.querySelector(`[data-index="${index}"]`);
  if (item) item.remove();

  // Rinumera
  document.querySelectorAll('#edit-attrezzi-container .attrezzo-item').forEach((el, i) => {
    el.querySelector('.attrezzo-label').textContent = `Attrezzo ${i + 1}`;
  });
}

// Handle submit modifica
function handleSubmitModifica(e) {
  e.preventDefault();

  const dati = {
    numero: riparazioneCorrente.Numero,
    dataConsegna: editData.value,
    cliente: editCliente.value.trim(),
    indirizzo: editIndirizzo.value.trim(),
    telefono: editTelefono.value.trim(),
    ddt: editDdt.checked,
    completato: editCompletato.checked,
    attrezzi: []
  };

  // Raccogli attrezzi
  document.querySelectorAll('#edit-attrezzi-container .attrezzo-item').forEach(item => {
    const marca = item.querySelector('[data-field="marca"]').value.trim();
    const dotazione = item.querySelector('[data-field="dotazione"]').value.trim();
    const note = item.querySelector('[data-field="note"]').value.trim();
    if (marca) {
      dati.attrezzi.push({ marca, dotazione, note });
    }
  });

  if (dati.attrezzi.length === 0) {
    alert('Aggiungi almeno un attrezzo');
    return;
  }

  mostraPopupConfermaModifica(dati);
}

// Mostra popup conferma modifiche
function mostraPopupConfermaModifica(dati) {
  const dataFormattata = new Date(dati.dataConsegna + 'T00:00:00').toLocaleDateString('it-IT');
  const attrezziHtml = dati.attrezzi.map((a, i) => {
    let dettagli = a.marca;
    if (a.dotazione) dettagli += ` - ${a.dotazione}`;
    if (a.note) dettagli += ` (${a.note})`;
    return `<p><strong>Attrezzo ${i + 1}:</strong> ${dettagli}</p>`;
  }).join('');

  popupRiepilogoModifica.innerHTML = `
    <p><strong>Numero:</strong> ${dati.numero}</p>
    <p><strong>Data consegna:</strong> ${dataFormattata}</p>
    <p><strong>Cliente:</strong> ${dati.cliente}</p>
    ${dati.indirizzo ? `<p><strong>Indirizzo:</strong> ${dati.indirizzo}</p>` : ''}
    <p><strong>Telefono:</strong> ${dati.telefono}</p>
    <p><strong>Documento di Trasporto:</strong> ${dati.ddt ? 'Sì' : 'No'}</p>
    ${attrezziHtml}
    <p><strong>Stato:</strong> ${dati.completato ? 'Completato' : 'In corso'}</p>
  `;

  popupConfermaModifica.classList.remove('hidden');

  // Salva dati per conferma
  popupConfermaSalva.onclick = () => salvaModifiche(dati);
}

// Salva modifiche
async function salvaModifiche(dati) {
  popupConfermaSalva.disabled = true;
  popupConfermaSalva.textContent = 'Salvataggio...';

  try {
    const res = await fetch(`${API_URL}?action=updateRiparazione`, {
      method: 'POST',
      body: JSON.stringify(dati)
    });

    const result = await res.json();

    if (result.success) {
      popupConfermaModifica.classList.add('hidden');
      popupModifica.classList.add('hidden');

      // Invalida cache per forzare ricaricamento fresco al prossimo accesso archivio
      cacheManager.invalidate('riparazioni');

      // Aggiorna dati localmente senza ricaricare da API
      // (evita errore "scheda non trovata" se Google Sheets non è ancora aggiornato)
      riparazioneCorrente = {
        Numero: dati.numero,
        'Data Consegna': dati.dataConsegna,
        Cliente: dati.cliente,
        Indirizzo: dati.indirizzo,
        Telefono: dati.telefono,
        DDT: dati.ddt,
        Attrezzi: dati.attrezzi,
        Completato: dati.completato
      };

      // Aggiorna anche in tutteRiparazioni se presente
      const index = tutteRiparazioni.findIndex(r => r.Numero === dati.numero);
      if (index !== -1) {
        tutteRiparazioni[index] = riparazioneCorrente;
      }

      // Renderizza i dati aggiornati
      renderDettaglio();
      aggiornaNavigazione();

      alert('Modifiche salvate con successo!');

      // Reset pulsante conferma per prossime modifiche
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
