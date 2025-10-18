// API Endpoint
const API_URL = 'https://script.google.com/macros/s/AKfycbxdsZtism0HvHXBo2ZwmYaf1jEV69FNqVCLZM4Lfs2diP8AO7KbEV7jbAAmpdrGouDoGg/exec';

// Elementi DOM
const searchInput = document.getElementById('search-cliente');
const toggleBtns = document.querySelectorAll('.toggle-btn');
const tbody = document.getElementById('tbody-riparazioni');
const emptyMessage = document.getElementById('empty-message');
const loadingOverlay = document.getElementById('loading-overlay');
const appMain = document.querySelector('.app');

// Stato
let tutteRiparazioni = [];
let filtroAttivo = 'tutti'; // 'tutti' | 'incompleti'
let searchQuery = '';

// Init
(async () => {
  await caricaRiparazioni();
  setupEventListeners();

  // Nascondi loading
  loadingOverlay.classList.add('hidden');
  appMain.style.opacity = '1';
  appMain.style.transition = 'opacity 0.3s ease';
})();

// Carica riparazioni da API
async function caricaRiparazioni() {
  try {
    const res = await fetch(`${API_URL}?action=getRiparazioni`, {
      redirect: 'follow'
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const data = await res.json();
    tutteRiparazioni = data.riparazioni || [];
    console.log('Riparazioni caricate:', tutteRiparazioni.length);

    renderTabella();
  } catch (err) {
    console.error('Errore caricamento riparazioni:', err);
    tutteRiparazioni = [];
    renderTabella();
  }
}

// Setup event listeners
function setupEventListeners() {
  // Toggle filtri
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filtroAttivo = btn.dataset.filter;
      renderTabella();
    });
  });

  // Ricerca cliente (con debounce)
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderTabella();
    }, 300);
  });
}

// Filtra riparazioni
function filtraRiparazioni() {
  let filtrate = [...tutteRiparazioni];

  // Filtro completato/incompleti
  if (filtroAttivo === 'incompleti') {
    filtrate = filtrate.filter(r => !r.Completato);
  }

  // Filtro ricerca cliente
  if (searchQuery) {
    filtrate = filtrate.filter(r =>
      r.Cliente && r.Cliente.toLowerCase().includes(searchQuery)
    );
  }

  return filtrate;
}

// Render tabella
function renderTabella() {
  const riparazioni = filtraRiparazioni();

  if (riparazioni.length === 0) {
    tbody.innerHTML = '';
    emptyMessage.classList.remove('hidden');
    return;
  }

  emptyMessage.classList.add('hidden');

  tbody.innerHTML = riparazioni.map(r => {
    const data = formatData(r['Data Consegna']);
    const attrezzi = formatAttrezzi(r.Attrezzi);
    const stato = r.Completato ?
      '<span class="badge completato-si">Completato</span>' :
      '<span class="badge completato-no">In corso</span>';

    return `
      <tr onclick="apriDettaglio('${r.Numero}')">
        <td><strong>${r.Numero}</strong></td>
        <td>${data}</td>
        <td class="hide-mobile">${r.Telefono || '-'}</td>
        <td class="attrezzi-cell">${attrezzi}</td>
        <td>${stato}</td>
      </tr>
    `;
  }).join('');
}

// Formatta data
function formatData(dataStr) {
  if (!dataStr) return '-';

  try {
    // Gestisce sia ISO (YYYY-MM-DD) che formato IT
    const data = new Date(dataStr);
    const giorno = String(data.getDate()).padStart(2, '0');
    const mese = String(data.getMonth() + 1).padStart(2, '0');
    const anno = data.getFullYear();

    // Desktop: GG/MM/AAAA, Mobile: GG/MM
    const isMobile = window.innerWidth <= 768;
    return isMobile ? `${giorno}/${mese}` : `${giorno}/${mese}/${anno}`;
  } catch (err) {
    return dataStr;
  }
}

// Formatta attrezzi
function formatAttrezzi(attrezziJson) {
  if (!attrezziJson || attrezziJson.length === 0) return '-';

  try {
    const attrezzi = typeof attrezziJson === 'string' ? JSON.parse(attrezziJson) : attrezziJson;

    // Mostra solo le marche, separate da virgola
    const marche = attrezzi.map(a => a.marca).filter(m => m).join(', ');
    return marche || '-';
  } catch (err) {
    console.error('Errore parsing attrezzi:', err);
    return '-';
  }
}

// Apri dettaglio scheda
function apriDettaglio(numero) {
  window.location.href = `/riparazioni-dettaglio.html?numero=${encodeURIComponent(numero)}`;
}

// Ricarica quando si torna alla pagina (per vedere modifiche)
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    caricaRiparazioni();
  }
});
