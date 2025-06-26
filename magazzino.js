async function cerca() {
  const input = document.getElementById('codice-input').value.trim();
  const risultatoDiv = document.getElementById('risultato');
  const forseCercaviDiv = document.getElementById('forse-cercavi');
  const stessoScaffaleDiv = document.getElementById('stesso-scaffale');

  risultatoDiv.innerHTML = '';
  forseCercaviDiv.innerHTML = '';
  stessoScaffaleDiv.innerHTML = '';

  try {
    const response = await fetch('magazzino.csv');
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const csvText = await response.text();

    console.log('CSV grezzo:', csvText.slice(0, 500)); // Mostra le prime righe

    const righe = csvText.split('\n').filter(r => r.trim() !== '');
    console.log('Righe CSV:', righe.length);

    const dati = righe.map(r => r.split(';'))
      .filter(campi => {
        const valido = campi.length === 3;
        if (!valido) console.warn('Riga scartata (non 3 campi):', campi);
        return valido;
      })
      .map(([codice, descrizione, scaffale]) => ({
        codice: codice.trim(),
        descrizione: descrizione.trim(),
        scaffale: scaffale.trim()
      }));

    console.log('Dati letti:', dati.length, dati);

    const risultato = dati.find(r => r.codice === input);

    if (risultato) {
      risultatoDiv.innerHTML = `<h2>Risultato</h2><p><strong>${risultato.codice}</strong>: ${risultato.descrizione} &mdash; scaffale ${risultato.scaffale}</p>`;
    } else {
      risultatoDiv.innerHTML = `<p>Nessun risultato esatto trovato.</p>`;
    }

    const codiciSimili = dati.filter(r => {
      return (
        distanzaCodici(r.codice, input) <= 2 ||
        r.codice.startsWith(input + '-')
      );
    }).filter(r => r.codice !== input);

    if (codiciSimili.length > 0) {
      forseCercaviDiv.innerHTML = `<h2>Forse cercavi</h2><ul>` + codiciSimili
        .map(r => `<li><strong>${r.codice}</strong>: ${r.descrizione}</li>`)
        .join('') + '</ul>';
    }

    if (risultato) {
      const stessiScaffale = dati.filter(r =>
        r.scaffale === risultato.scaffale && r.codice !== risultato.codice
      );
      if (stessiScaffale.length > 0) {
        stessoScaffaleDiv.innerHTML = `<h2>Nello stesso scaffale</h2><ul>` + stessiScaffale
          .map(r => `<li><strong>${r.codice}</strong>: ${r.descrizione}</li>`)
          .join('') + '</ul>';
      }
    }

  } catch (error) {
    console.error('Errore durante il fetch o il parsing del CSV:', error);
    risultatoDiv.innerHTML = `<p>Errore nel caricamento dei dati.</p>`;
  }
}

function distanzaCodici(a, b) {
  const numA = a.replace(/[^0-9]/g, '');
  const numB = b.replace(/[^0-9]/g, '');
  if (numA.length !== numB.length) return Infinity;
  let diff = 0;
  for (let i = 0; i < numA.length; i++) {
    if (numA[i] !== numB[i]) diff++;
  }
  return diff;
}