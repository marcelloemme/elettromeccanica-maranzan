document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('codice-input').addEventListener('keypress', e => {
    if (e.key === 'Enter') cerca();
  });

  document.getElementById('mostra-alfabetico').addEventListener('click', () => {
    resetContenuto();
    renderRisultati(datiGlobali.slice().sort((a, b) =>
      a.descrizione.localeCompare(b.descrizione)), 'lista-tutti', 'Tutti i ricambi (A–Z)');
  });

  document.getElementById('mostra-scaffale').addEventListener('click', () => {
    resetContenuto();
    renderRisultati(datiGlobali.slice().sort((a, b) =>
      a.scaffale.localeCompare(b.scaffale)), 'lista-scaffale', 'Tutti i ricambi per scaffale');
  });
});

let datiGlobali = [];

async function cerca() {
  const codice = document.getElementById('codice-input').value.trim();
  resetContenuto();

  try {
    const res = await fetch('magazzino.csv');
    const text = await res.text();
    const rows = text.trim().split('\n').slice(1);
    const dati = rows
      .map(r => r.split(','))
      .filter(campi => campi.length === 3)
      .map(([codice, descrizione, scaffale]) => ({
        codice: codice.trim(),
        descrizione: descrizione.trim(),
        scaffale: scaffale.trim()
      }));

    datiGlobali = dati;

    const trovato = dati.find(d => d.codice === codice);

    if (trovato) {
      renderRisultati([trovato], 'risultato', 'Risultato');

      const stessoScaffale = dati.filter(d =>
        d.scaffale === trovato.scaffale && d.codice !== trovato.codice);
      renderRisultati(stessoScaffale, 'stesso-scaffale', 'Nello stesso scaffale');

      const forseCercavi = suggerisciCodiciSimili(codice, dati).filter(d => d.codice !== trovato.codice);
      renderRisultati(forseCercavi, 'forse-cercavi', 'Forse cercavi');

    } else {
      document.getElementById('risultato').innerHTML = '<p>Nessun risultato esatto trovato.</p>';
      const suggeriti = suggerisciCodiciSimili(codice, dati);
      renderRisultati(suggeriti, 'forse-cercavi', 'Forse cercavi');
    }
  } catch (e) {
    console.error('Errore durante il fetch o il parsing del CSV:', e);
  }
}

function suggerisciCodiciSimili(codiceInserito, dati) {
  return dati.filter(item => {
    const codiceBase = codiceInserito.split('-')[0];
    const itemBase = item.codice.split('-')[0];

    const differenze = contaDifferenze(codiceInserito, item.codice);
    const stessoPrefisso = itemBase === codiceBase && item.codice !== codiceInserito;

    return differenze <= 2 || stessoPrefisso;
  });
}

function contaDifferenze(a, b) {
  const len = Math.max(a.length, b.length);
  let count = 0;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) count++;
  }
  return count;
}

function renderRisultati(risultati, containerId, titolo) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  if (risultati.length === 0) return;

  const heading = document.createElement('h2');
  heading.textContent = titolo;
  container.appendChild(heading);

  const table = document.createElement('table');
  table.classList.add('tabella-risultati');

  risultati.forEach(item => {
    const row = document.createElement('tr');

    const codiceCell = document.createElement('td');
    codiceCell.className = 'codice';
    codiceCell.textContent = item.codice;

    const descrizioneCell = document.createElement('td');
    descrizioneCell.className = 'descrizione';
    descrizioneCell.textContent = item.descrizione;

    const scaffaleCell = document.createElement('td');
    scaffaleCell.className = 'scaffale';
    scaffaleCell.textContent = `scaffale ${item.scaffale}`;

    row.appendChild(codiceCell);
    row.appendChild(descrizioneCell);
    row.appendChild(scaffaleCell);
    table.appendChild(row);
  });

  container.appendChild(table);
}

function resetContenuto() {
  ['risultato', 'forse-cercavi', 'stesso-scaffale', 'lista-tutti', 'lista-scaffale'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}