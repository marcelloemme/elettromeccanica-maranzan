// API Endpoint
const API_URL = 'https://script.google.com/macros/s/AKfycbxdsZtism0HvHXBo2ZwmYaf1jEV69FNqVCLZM4Lfs2diP8AO7KbEV7jbAAmpdrGouDoGg/exec';

// Elementi DOM
const searchInput = document.getElementById('search-cliente');
const filterIncorso = document.getElementById('filter-incorso');
const filterCompletato = document.getElementById('filter-completato');
const countIncorso = document.getElementById('count-incorso');
const countCompletato = document.getElementById('count-completato');
const tbody = document.getElementById('tbody-riparazioni');
const emptyMessage = document.getElementById('empty-message');
const loadingOverlay = document.getElementById('loading-overlay');
const appMain = document.querySelector('.app');
const dataDalInput = document.getElementById('data-dal');
const dataAlInput = document.getElementById('data-al');
const btnMostraTutto = document.getElementById('btn-mostra-tutto');

// Stato
let tutteRiparazioni = [];
let filtroIncorso = false; // Se true, mostra solo in corso
let filtroCompletato = false; // Se true, mostra solo completate
let searchQuery = '';
let dataDal = null; // Data inizio filtro (Date object o null)
let dataAl = null;  // Data fine filtro (Date object o null)
let isPulsanteAttivoMostraTutte = false; // Stato pulsante toggle

// Stato ordinamento
let sortColumn = 'numero'; // Default: ordina per numero
let sortDirection = 'desc'; // Default: decrescente

// Init (ottimizzato con cache)
(async () => {
  // 1. Prova cache prima per mostrare dati istantaneamente
  const cached = cacheManager.get('riparazioni');
  if (cached && cached.length > 0) {
    tutteRiparazioni = cached;

    // Imposta filtro date DOPO aver caricato i dati
    impostaFiltroDateDefault();
    renderTabella();
    scrollToScheda();

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

  // Imposta filtro date DOPO aver caricato i dati
  impostaFiltroDateDefault();
  renderTabella();
  scrollToScheda();

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

    // NON chiamare renderTabella() qui - viene chiamato da init
  } catch (err) {
    console.error('Errore caricamento riparazioni:', err);
    tutteRiparazioni = [];
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

  // Bottone + (nuovo) -> vai a riparazioni-nuovo
  const btnNuovo = document.getElementById('btn-nuovo');
  if (btnNuovo) {
    btnNuovo.addEventListener('click', () => {
      if (navigator.vibrate) navigator.vibrate(10);
      window.location.href = '/html/riparazioni-nuovo.html';
    });
    btnNuovo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (navigator.vibrate) navigator.vibrate(10);
        window.location.href = '/html/riparazioni-nuovo.html';
      }
    });
  }

  // Ordinamento colonne
  document.querySelectorAll('.th-sortable').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.dataset.sort;
      if (sortColumn === column) {
        // Stesso header: inverte direzione
        sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
      } else {
        // Nuovo header: imposta colonna e reset a decrescente
        sortColumn = column;
        sortDirection = 'desc';
      }
      // Aggiorna classe active
      document.querySelectorAll('.th-sortable').forEach(t => t.classList.remove('active'));
      th.classList.add('active');
      renderTabella();
    });
  });

  // Filtri stato (multi-selezione)
  filterIncorso.addEventListener('click', () => {
    filtroIncorso = !filtroIncorso;
    filterIncorso.classList.toggle('active', filtroIncorso);
    renderTabella();
  });

  filterCompletato.addEventListener('click', () => {
    filtroCompletato = !filtroCompletato;
    filterCompletato.classList.toggle('active', filtroCompletato);
    renderTabella();
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

  // Input date con formattazione automatica
  setupDateInput(dataDalInput);
  setupDateInput(dataAlInput);

  // Bottone "Tutte in corso" / "Tutte" (toggle)
  btnMostraTutto.addEventListener('click', toggleMostraTutte);
}

// Filtra riparazioni
function filtraRiparazioni() {
  let filtrate = [...tutteRiparazioni];

  // Filtro stato (multi-selezione)
  // - Nessuno selezionato = mostra tutto
  // - Solo incorso = mostra solo in corso
  // - Solo completato = mostra solo completate
  // - Entrambi = mostra tutto
  if (filtroIncorso && !filtroCompletato) {
    filtrate = filtrate.filter(r => !r.Completato);
  } else if (!filtroIncorso && filtroCompletato) {
    filtrate = filtrate.filter(r => r.Completato);
  }
  // Se entrambi o nessuno: mostra tutto (nessun filtro)

  // Filtro ricerca cliente
  if (searchQuery) {
    filtrate = filtrate.filter(r =>
      r.Cliente && r.Cliente.toLowerCase().includes(searchQuery)
    );
  }

  // Filtro date
  if (dataDal || dataAl) {
    filtrate = filtrate.filter(r => {
      const dataConsegna = r['Data Consegna'] || r['Data consegna'] || r.DataConsegna;
      if (!dataConsegna) return false;

      const dataRip = parseDataItaliana(dataConsegna);
      if (!dataRip) return false;

      // Controlla range
      if (dataDal && dataRip < dataDal) return false;
      if (dataAl && dataRip > dataAl) return false;

      return true;
    });
  }

  return filtrate;
}

// Aggiorna contatori filtri
function aggiornaContatori() {
  // Applica solo filtri data e ricerca (ignora i filtri stato)
  let riparazioniFiltrate = [...tutteRiparazioni];

  // Filtro ricerca cliente
  if (searchQuery) {
    riparazioniFiltrate = riparazioniFiltrate.filter(r =>
      r.Cliente && r.Cliente.toLowerCase().includes(searchQuery)
    );
  }

  // Filtro date
  if (dataDal || dataAl) {
    riparazioniFiltrate = riparazioniFiltrate.filter(r => {
      const dataConsegna = r['Data Consegna'] || r['Data consegna'] || r.DataConsegna;
      if (!dataConsegna) return false;

      const dataRip = parseDataItaliana(dataConsegna);
      if (!dataRip) return false;

      if (dataDal && dataRip < dataDal) return false;
      if (dataAl && dataRip > dataAl) return false;

      return true;
    });
  }

  // Conta in corso e completate
  const numIncorso = riparazioniFiltrate.filter(r => !r.Completato).length;
  const numCompletate = riparazioniFiltrate.filter(r => r.Completato).length;

  // Aggiorna testo contatori
  countIncorso.textContent = `(${numIncorso})`;
  countCompletato.textContent = `(${numCompletate})`;
}

// Render tabella
function renderTabella() {
  const riparazioni = filtraRiparazioni();

  // Aggiorna contatori
  aggiornaContatori();

  if (riparazioni.length === 0) {
    tbody.innerHTML = '';
    emptyMessage.classList.remove('hidden');
    return;
  }

  emptyMessage.classList.add('hidden');

  // Ordina in base alla colonna selezionata
  ordinaRiparazioni(riparazioni);

  tbody.innerHTML = riparazioni.map(r => {
    // Data inserimento (consegna)
    const dataConsegna = r['Data Consegna'] || r['Data consegna'] || r.DataConsegna || r['Data'];
    const dataIns = formatData(dataConsegna);

    // Data completamento
    const dataCompletamento = r['Data Completamento'] || r['Data completamento'] || r.DataCompletamento;
    const dataCom = dataCompletamento ? formatData(dataCompletamento) : '-';

    // Su mobile mostra solo emoji, su desktop mostra badge con testo
    const isMobile = window.innerWidth <= 768;
    const stato = r.Completato ?
      (isMobile ? '<span class="badge completato-si">🟢</span>' : '<span class="badge completato-si">Completato</span>') :
      (isMobile ? '<span class="badge completato-no">🔴</span>' : '<span class="badge completato-no">In corso</span>');

    return `
      <tr onclick="apriDettaglio('${r.Numero}')">
        <td class="td-numero"><strong>${r.Numero}</strong></td>
        <td class="td-data-ins">${dataIns}</td>
        <td class="td-data-com">${dataCom}</td>
        <td class="td-cliente">${r.Cliente || '-'}</td>
        <td class="td-stato">${stato}</td>
      </tr>
    `;
  }).join('');
}

// Ordina riparazioni in base a sortColumn e sortDirection
function ordinaRiparazioni(riparazioni) {
  const dir = sortDirection === 'desc' ? -1 : 1;

  riparazioni.sort((a, b) => {
    let cmp = 0;

    switch (sortColumn) {
      case 'numero':
        // Formato: "26/0001" -> anno=26, prog=0001
        const parseNumero = (num) => {
          const match = String(num).match(/^(\d+)\/(\d+)$/);
          if (!match) return { anno: 0, prog: 0 };
          return { anno: parseInt(match[1], 10), prog: parseInt(match[2], 10) };
        };
        const aNum = parseNumero(a.Numero);
        const bNum = parseNumero(b.Numero);
        if (aNum.anno !== bNum.anno) {
          cmp = aNum.anno - bNum.anno;
        } else {
          cmp = aNum.prog - bNum.prog;
        }
        break;

      case 'data-ins':
        const dataInsA = a['Data Consegna'] || a['Data consegna'] || a.DataConsegna || '';
        const dataInsB = b['Data Consegna'] || b['Data consegna'] || b.DataConsegna || '';
        const dateA = dataInsA ? new Date(dataInsA).getTime() : 0;
        const dateB = dataInsB ? new Date(dataInsB).getTime() : 0;
        cmp = dateA - dateB;
        break;

      case 'data-com':
        // Completate con data in cima, senza data sempre in fondo (indipendente da direzione)
        const dataComA = a['Data Completamento'] || a['Data completamento'] || a.DataCompletamento || '';
        const dataComB = b['Data Completamento'] || b['Data completamento'] || b.DataCompletamento || '';
        const hasA = !!dataComA;
        const hasB = !!dataComB;
        if (hasA && !hasB) return -1; // A ha data, B no -> A sempre prima
        if (!hasA && hasB) return 1;  // B ha data, A no -> B sempre prima
        if (!hasA && !hasB) return 0; // Entrambi senza data
        // Entrambi hanno data: ordina per data
        const dateComA = new Date(dataComA).getTime();
        const dateComB = new Date(dataComB).getTime();
        cmp = dateComA - dateComB;
        break;

      case 'cliente':
        const clienteA = (a.Cliente || '').toLowerCase();
        const clienteB = (b.Cliente || '').toLowerCase();
        cmp = clienteA.localeCompare(clienteB);
        break;

      case 'stato':
        // In corso (false) prima di Completato (true) in ordine decrescente
        // false = 0, true = 1 -> per avere "In corso" prima in desc: confronto inverso
        const statoA = a.Completato ? 1 : 0;
        const statoB = b.Completato ? 1 : 0;
        cmp = statoA - statoB;
        break;
    }

    return cmp * dir;
  });
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

// Scrolla alla scheda specificata nel parametro scrollTo
function scrollToScheda() {
  const urlParams = new URLSearchParams(window.location.search);
  const scrollTo = urlParams.get('scrollTo');
  if (!scrollTo) return;

  // Trova la riga con quel numero
  const righe = tbody.querySelectorAll('tr');
  for (const riga of righe) {
    const tdNumero = riga.querySelector('.td-numero strong');
    if (tdNumero && tdNumero.textContent === scrollTo) {
      // Scrolla la riga al centro della viewport
      riga.scrollIntoView({ behavior: 'instant', block: 'center' });
      // Evidenzia brevemente la riga
      riga.classList.add('highlight-row');
      setTimeout(() => riga.classList.remove('highlight-row'), 1500);
      break;
    }
  }
}

// Ricarica quando si torna alla pagina (per vedere modifiche)
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    caricaRiparazioni();
  }
});

// Ri-renderizza quando si ridimensiona (rotazione mobile)
window.addEventListener('resize', () => {
  renderTabella();
});

// Carica riparazioni in background (aggiornamento silenzioso)
async function caricaRiparazioniBackground() {
  try {
    await caricaRiparazioni();
  } catch (err) {
    console.warn('Aggiornamento background fallito (non critico):', err);
  }
}

// ===== GESTIONE FILTRO DATE =====

// Imposta filtro date default (dalla più vecchia non completata a oggi)
function impostaFiltroDateDefault() {
  const oggi = new Date();

  // Filtra solo riparazioni in corso (non completate)
  const riparazioniInCorso = tutteRiparazioni.filter(r => !r.Completato);

  let dataInizio;

  if (riparazioniInCorso.length > 0) {
    // Trova la data più vecchia tra le riparazioni in corso
    let dataMinima = null;

    riparazioniInCorso.forEach(r => {
      const dataConsegna = r['Data Consegna'] || r['Data consegna'] || r.DataConsegna;
      if (!dataConsegna) return;

      const dataRip = parseDataItaliana(dataConsegna);
      if (!dataRip) return;

      if (!dataMinima || dataRip < dataMinima) {
        dataMinima = dataRip;
      }
    });

    dataInizio = dataMinima || new Date(2025, 9, 15); // Fallback: 15 ottobre 2025
  } else {
    // Nessuna riparazione in corso -> fallback data minima assoluta
    dataInizio = new Date(2025, 9, 15); // 15 ottobre 2025
  }

  // Imposta variabili stato
  dataDal = dataInizio;
  dataAl = oggi;

  // Imposta valori input
  dataDalInput.value = formatDateToInput(dataInizio);
  dataAlInput.value = formatDateToInput(oggi);

  // Pulsante parte NON attivo
  isPulsanteAttivoMostraTutte = false;
  btnMostraTutto.classList.remove('active');
  btnMostraTutto.textContent = 'Tutte in corso';
}

// Toggle pulsante "Tutte in corso" / "Tutte"
function toggleMostraTutte() {
  const oggi = new Date();

  if (isPulsanteAttivoMostraTutte) {
    // Era attivo -> disattiva e torna al default
    isPulsanteAttivoMostraTutte = false;
    btnMostraTutto.classList.remove('active');
    btnMostraTutto.textContent = 'Tutte in corso';

    // Ripristina forbice default (più vecchia non completata → oggi)
    const riparazioniInCorso = tutteRiparazioni.filter(r => !r.Completato);
    let dataInizio;

    if (riparazioniInCorso.length > 0) {
      let dataMinima = null;
      riparazioniInCorso.forEach(r => {
        const dataConsegna = r['Data Consegna'] || r['Data consegna'] || r.DataConsegna;
        if (!dataConsegna) return;
        const dataRip = parseDataItaliana(dataConsegna);
        if (!dataRip) return;
        if (!dataMinima || dataRip < dataMinima) {
          dataMinima = dataRip;
        }
      });
      dataInizio = dataMinima || new Date(2025, 9, 15);
    } else {
      dataInizio = new Date(2025, 9, 15);
    }

    dataDal = dataInizio;
    dataAl = oggi;

    dataDalInput.value = formatDateToInput(dataInizio);
    dataAlInput.value = formatDateToInput(oggi);
  } else {
    // Era disattivo -> attiva e mostra tutto (15 ottobre 2025 → oggi)
    isPulsanteAttivoMostraTutte = true;
    btnMostraTutto.classList.add('active');
    btnMostraTutto.textContent = 'Tutte';

    // Imposta forbice completa
    const dataMinAssoluta = new Date(2025, 9, 15); // 15 ottobre 2025
    dataDal = dataMinAssoluta;
    dataAl = oggi;

    dataDalInput.value = formatDateToInput(dataMinAssoluta);
    dataAlInput.value = formatDateToInput(oggi);
  }

  renderTabella();
}

// Formatta Date object in stringa GG/MM/AAAA o GG/MM/AA (mobile) per input
function formatDateToInput(date) {
  const giorno = String(date.getDate()).padStart(2, '0');
  const mese = String(date.getMonth() + 1).padStart(2, '0');
  const anno = date.getFullYear();

  // Su mobile usa formato breve GG/MM/AA
  const isMobile = window.innerWidth <= 768;
  const annoFormattato = isMobile ? String(anno).slice(-2) : anno;

  return `${giorno}/${mese}/${annoFormattato}`;
}

// Parse data italiana (GG/MM/AAAA o YYYY-MM-DD) in Date object
function parseDataItaliana(dataStr) {
  if (!dataStr) return null;

  try {
    // Formato ISO (YYYY-MM-DD)
    if (dataStr.includes('-')) {
      return new Date(dataStr);
    }

    // Formato italiano (GG/MM/AAAA)
    const [giorno, mese, anno] = dataStr.split('/').map(Number);
    if (!giorno || !mese || !anno) return null;
    return new Date(anno, mese - 1, giorno); // mese è zero-indexed
  } catch {
    return null;
  }
}

// Setup input data con formattazione automatica
function setupDateInput(input) {
  let previousValue = '';

  input.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, ''); // Solo numeri

    const isMobile = window.innerWidth <= 768;
    const maxLength = isMobile ? 6 : 8; // GGMMAA su mobile, GGMMAAAA su desktop

    // Limita cifre in base al dispositivo
    if (value.length > maxLength) {
      value = value.slice(0, maxLength);
    }

    // Formatta GG/MM/AA (mobile) o GG/MM/AAAA (desktop)
    let formatted = '';
    if (value.length > 0) {
      formatted += value.slice(0, 2); // GG
    }
    if (value.length >= 3) {
      formatted += '/' + value.slice(2, 4); // MM
    }
    if (value.length >= 5) {
      formatted += '/' + value.slice(4, maxLength); // AA o AAAA
    }

    e.target.value = formatted;
    previousValue = formatted;

    // Aggiorna filtro quando data completa
    const lengthCompleta = isMobile ? 8 : 10; // GG/MM/AA = 8, GG/MM/AAAA = 10
    if (formatted.length === lengthCompleta) {
      aggiornaFiltroDate();
    } else if (formatted.length === 0) {
      // Se cancellato tutto, rimuovi filtro
      aggiornaFiltroDate();
    }
  });

  // Gestisci backspace per cancellare anche le "/"
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && e.target.value.endsWith('/')) {
      e.preventDefault();
      e.target.value = e.target.value.slice(0, -1);
      aggiornaFiltroDate();
    }
  });
}

// Aggiorna variabili filtro date da input
function aggiornaFiltroDate() {
  const dalStr = dataDalInput.value;
  const alStr = dataAlInput.value;

  // Parse data "Dal" - accetta GG/MM/AAAA (10) o GG/MM/AA (8)
  if (dalStr.length === 10 || dalStr.length === 8) {
    const [g, m, a] = dalStr.split('/').map(Number);
    // Se anno a 2 cifre, converti in 4 cifre (assumendo 2000+)
    const annoCompleto = a < 100 ? 2000 + a : a;
    dataDal = new Date(annoCompleto, m - 1, g);
  } else {
    dataDal = null;
  }

  // Parse data "Al" - accetta GG/MM/AAAA (10) o GG/MM/AA (8)
  if (alStr.length === 10 || alStr.length === 8) {
    const [g, m, a] = alStr.split('/').map(Number);
    // Se anno a 2 cifre, converti in 4 cifre (assumendo 2000+)
    const annoCompleto = a < 100 ? 2000 + a : a;
    dataAl = new Date(annoCompleto, m - 1, g);
  } else {
    dataAl = null;
  }

  // Se l'utente ha modificato manualmente le date, spegni il pulsante se era attivo
  if (isPulsanteAttivoMostraTutte) {
    isPulsanteAttivoMostraTutte = false;
    btnMostraTutto.classList.remove('active');
    btnMostraTutto.textContent = 'Tutte in corso';
  }

  // Renderizza tabella con nuovo filtro
  renderTabella();
}
