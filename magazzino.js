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
    const csvText = await response.text();
    const righe = csvText.split('\n').filter(r => r.trim() !== '');
    const dati = righe.map(r => {
      const [codice, descrizione, scaffale] = r.split(';');
      return { codice: codice.trim(), descrizione: descrizione.trim(), scaffale: scaffale.trim() };
    });

    console.log('Dati letti:', dati);

    const risultato = dati.find(r => r.codice === input);

    // Mostra risultato esatto
    if (risultato) {
      risultatoDiv.innerHTML = `<h2>Risultato</h2><p><strong>${risultato.codice}</strong>: ${risultato.descrizione} &mdash; scaffale ${risultato.scaffale}</p>`;
    } else {
      risultatoDiv.innerHTML = `<p>Nessun risultato esatto trovato.</p>`;
    }

    // Forse cercavi: varianti e codici simili
    const codiciSimili = dati.filter(r => {
      return (
        distanzaCodici(r.codice, input) <= 2 || // massimo 2 differenze tra cifre
        r.codice.startsWith(input + '-')        // es. 123406 -> 123406-1
      );
    }).filter(r => r.codice !== input);

    if (codiciSimili.length > 0) {
      forseCercaviDiv.innerHTML = `<h2>Forse cercavi</h2><ul>` + codiciSimili
        .map(r => `<li><strong>${r.codice}</strong>: ${r.descrizione}</li>`)
        .join('') + '</ul>';
    }

    // Nello stesso scaffale
    if (risultato) {
      const stessiScaffale = dati.filter(r => r.scaffale === risultato.scaffale && r.codice !== risultato.codice);
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

// Calcola quante cifre sono diverse (solo tra parti numeriche)
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