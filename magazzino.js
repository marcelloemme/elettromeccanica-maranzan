async function cerca() {
  const codiceCercato = document.getElementById("codice-input").value.trim();
  console.log("Codice cercato:", codiceCercato);

  try {
    const response = await fetch("magazzino.csv");
    const csvText = await response.text();

    const righe = csvText.trim().split("\n");
    righe.shift(); // rimuove intestazione

    const dati = righe
      .map(riga => {
        const campi = riga.split(","); // <== USA LA VIRGOLA
        if (campi.length !== 3) {
          console.warn("Riga scartata (non 3 campi):", riga);
          return null;
        }
        return {
          codice: campi[0].trim(),
          descrizione: campi[1].trim(),
          scaffale: campi[2].trim()
        };
      })
      .filter(Boolean);

    console.log("Dati letti:", dati);

    const risultato = dati.find(item => item.codice === codiceCercato);

    const divRisultato = document.getElementById("risultato");
    const divStessoScaffale = document.getElementById("stesso-scaffale");
    const divForseCercavi = document.getElementById("forse-cercavi");

    divRisultato.innerHTML = "";
    divStessoScaffale.innerHTML = "";
    divForseCercavi.innerHTML = "";

    if (risultato) {
      divRisultato.innerHTML = `<h2>Risultato</h2><p><strong>${risultato.codice}</strong>: ${risultato.descrizione} — scaffale ${risultato.scaffale}</p>`;
    } else {
      divRisultato.innerHTML = `<p>Nessun risultato esatto trovato.</p>`;
    }

    // Suggerimenti simili
    const suggeriti = dati.filter(item => {
      if (item.codice === codiceCercato) return false;
      // stesse prime 6 cifre
      if (codiceCercato.length >= 6 && item.codice.startsWith(codiceCercato)) return true;
      if (item.codice.startsWith(codiceCercato + "-")) return true;
      // distanza di 1 cifra
      return distanzaCodici(item.codice, codiceCercato) === 1;
    });

    if (suggeriti.length > 0) {
      divForseCercavi.innerHTML = `<h2>Forse cercavi</h2><ul>` +
        suggeriti.map(item => `<li>${item.codice}: ${item.descrizione}</li>`).join("") +
        `</ul>`;
    }

    // Stesso scaffale
    if (risultato) {
      const stessi = dati.filter(item =>
        item.scaffale === risultato.scaffale && item.codice !== risultato.codice
      );
      if (stessi.length > 0) {
        divStessoScaffale.innerHTML = `<h2>Nello stesso scaffale</h2><ul>` +
          stessi.map(item => `<li>${item.codice}: ${item.descrizione}</li>`).join("") +
          `</ul>`;
      }
    }

  } catch (errore) {
    console.error("Errore durante il fetch o il parsing del CSV:", errore);
  }
}

function distanzaCodici(a, b) {
  if (a.length !== b.length) return Infinity;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff;
}