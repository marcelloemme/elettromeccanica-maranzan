// API Endpoint
const API_URL = 'https://script.google.com/macros/s/AKfycbxdsZtism0HvHXBo2ZwmYaf1jEV69FNqVCLZM4Lfs2diP8AO7KbEV7jbAAmpdrGouDoGg/exec';

// Elementi DOM
const form = document.getElementById('form-nuova');
const dataConsegnaInput = document.getElementById('data-consegna');
const clienteInput = document.getElementById('cliente');
const telefonoInput = document.getElementById('telefono');
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

  // Carica clienti per autocomplete
  await loadClienti();

  // Carica e mostra prossimo numero
  await mostraProssimoNumero();

  // Aggiungi primo attrezzo
  addAttrezzo();
})();

// Mostra prossimo numero nel titolo
async function mostraProssimoNumero() {
  try {
    const res = await fetch(`${API_URL}?action=getRiparazioni`);
    const data = await res.json();
    const riparazioni = data.riparazioni || [];

    const anno = new Date().getFullYear() % 100;
    const annoCorrente = riparazioni.filter(r => r.Numero.startsWith(`${anno}/`));
    const prossimoProgressivo = annoCorrente.length + 1;
    const prossimoNumero = `${anno}/${String(prossimoProgressivo).padStart(4, '0')}`;

    document.querySelector('.header h1').textContent = `Nuova Riparazione ${prossimoNumero}`;
  } catch (err) {
    console.error('Errore caricamento numero:', err);
  }
}

// Carica lista clienti
async function loadClienti() {
  try {
    const res = await fetch(`${API_URL}?action=getClienti`);
    const data = await res.json();
    clienti = data.clienti || [];
  } catch (err) {
    console.error('Errore caricamento clienti:', err);
    clienti = [];
  }
}

// Autocomplete cliente
clienteInput.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();

  if (query.length < 2) {
    autocompleteList.classList.remove('show');
    return;
  }

  const matches = clienti.filter(c =>
    c.nome.toLowerCase().includes(query)
  );

  if (matches.length === 0) {
    autocompleteList.classList.remove('show');
    return;
  }

  autocompleteList.innerHTML = matches.map(c => `
    <div class="autocomplete-item" data-nome="${c.nome}" data-telefono="${c.telefono}">
      ${c.nome} - ${c.telefono}
    </div>
  `).join('');

  autocompleteList.classList.add('show');

  // Event listeners per i suggerimenti
  document.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('click', () => {
      clienteInput.value = item.dataset.nome;
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
  const telefono = telefonoInput.value.trim();

  // Raccogli attrezzi
  const attrezzi = [];
  document.querySelectorAll('.attrezzo-item').forEach(item => {
    const marca = item.querySelector('[data-field="marca"]').value.trim();
    const note = item.querySelector('[data-field="note"]').value.trim();
    if (marca) {
      attrezzi.push({ marca, note });
    }
  });

  if (attrezzi.length === 0) {
    alert('Aggiungi almeno un attrezzo');
    return;
  }

  // Mostra popup conferma
  mostraPopupConferma({ dataConsegna, cliente, telefono, attrezzi });
});

// Mostra popup conferma
function mostraPopupConferma(dati) {
  const { dataConsegna, cliente, telefono, attrezzi } = dati;

  const dataFormattata = new Date(dataConsegna + 'T00:00:00').toLocaleDateString('it-IT');
  const attrezziHtml = attrezzi.map((a, i) => `
    <p><strong>Attrezzo ${i + 1}:</strong> ${a.marca}${a.note ? ` (${a.note})` : ''}</p>
  `).join('');

  popupRiepilogo.innerHTML = `
    <p><strong>Data consegna:</strong> ${dataFormattata}</p>
    <p><strong>Cliente:</strong> ${cliente}</p>
    <p><strong>Telefono:</strong> ${telefono}</p>
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
