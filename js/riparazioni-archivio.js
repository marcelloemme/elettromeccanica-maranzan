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

// Init (ottimizzato con cache)
(async () => {
  // 1. Prova cache prima per mostrare dati istantaneamente
  const cached = cacheManager.get('riparazioni');
  if (cached && cached.length > 0) {
    tutteRiparazioni = cached;
    renderTabella();

    // Nascondi loading
    loadingOverlay.classList.add('hidden');
    appMain.style.opacity = '1';
    appMain.style.transition = 'opacity 0.3s ease';

    setupEventListeners();

    // 2. Aggiorna in background per avere dati freschi
    caricaRiparazioniBackground();
    return;
  }

  // 3. Fallback: nessuna cache, carica da API
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

    // Salva in cache centralizzata
    cacheManager.set('riparazioni', tutteRiparazioni);

    renderTabella();
  } catch (err) {
    console.error('Errore caricamento riparazioni:', err);
    tutteRiparazioni = [];
    renderTabella();
  }
}

// Setup event listeners
function setupEventListeners() {
  // Burger menu -> torna a /private
  const burgerMenu = document.getElementById('burger-menu');
  if (burgerMenu) {
    burgerMenu.addEventListener('click', () => {
      if (navigator.vibrate) navigator.vibrate(10);
      window.location.href = '/private.html';
    });
    burgerMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (navigator.vibrate) navigator.vibrate(10);
        window.location.href = '/private.html';
      }
    });
  }

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
    // Prova diverse varianti del nome campo
    const dataConsegna = r['Data Consegna'] || r['Data consegna'] || r.DataConsegna || r['Data'];
    const data = formatData(dataConsegna);
    const stato = r.Completato ?
      '<span class="badge completato-si">Completato</span>' :
      '<span class="badge completato-no">In corso</span>';

    return `
      <tr onclick="apriDettaglio('${r.Numero}')">
        <td class="td-numero"><strong>${r.Numero}</strong></td>
        <td class="td-data">${data}</td>
        <td class="td-cliente">${r.Cliente || '-'}</td>
        <td class="td-stato">${stato}</td>
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

// Apri dettaglio scheda
function apriDettaglio(numero) {
  window.location.href = `/html/riparazioni-dettaglio.html?numero=${encodeURIComponent(numero)}`;
}

// Ricarica quando si torna alla pagina (per vedere modifiche)
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    caricaRiparazioni();
  }
});

// Carica riparazioni in background (aggiornamento silenzioso)
async function caricaRiparazioniBackground() {
  try {
    await caricaRiparazioni();
  } catch (err) {
    console.warn('Aggiornamento background fallito (non critico):', err);
  }
}
