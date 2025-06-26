async function cerca() {
  const codiceInput = document.getElementById("codice-input").value.trim();
  console.log("Codice cercato:", codiceInput);

  try {
    const response = await fetch("magazzino.csv");
    const text = await response.text();

    const righe = text.trim().split("\n");
    const intestazioni = righe[0].split(",").map(h => h.trim().toLowerCase());
    const dati = righe.slice(1).map(riga => {
      const valori = riga.split(",").map(v => v.trim());
      const oggetto = {};
      intestazioni.forEach((intestazione, i) => {
        oggetto[intestazione] = valori[i];
      });
      return oggetto;
    });

    console.log("Dati letti:", dati);

    const risultato = dati.find(item => item.codice === codiceInput);
    const risultatoDiv = document.getElementById("risultato");
    const stessoScaffaleDiv = document.getElementById("stesso-scaffale");
    const forseCercaviDiv = document.getElementById("forse-cercavi");

    risultatoDiv.innerHTML = "";
    stessoScaffaleDiv.innerHTML = "";
    forseCercaviDiv.innerHTML = "";

    if (risultato) {
      risultatoDiv.innerHTML = `<h2>Risultato</h2><p><strong>${risultato.codice}</strong>: ${risultato.descrizione} — scaffale ${risultato.scaffale}</p>`;

      // Mostra altri codici nello stesso scaffale
      const stessi = dati.filter(item => item.scaffale === risultato.scaffale && item.codice !== risultato.codice);
      if (stessi.length > 0) {
        stessoScaffaleDiv.innerHTML = "<h2>Nello stesso scaffale</h2><ul>" +
          stessi.map(item => `<li>${item.codice}: ${item.descrizione}</li>`).join('') +
          "</ul>";
      }

      // Suggerimenti “forse cercavi”
      const base = risultato.codice.split("-")[0];
      const suggerimenti = dati.filter(item => {
        const codiceBase = item.codice.split("-")[0];
        return (
          item.codice !== risultato.codice &&
          (
            codiceBase === base || distanzaHamming(item.codice, codiceInput) === 1
          )
        );
      });

      if (suggerimenti.length > 0) {
        forseCercaviDiv.innerHTML = "<h2>Forse cercavi</h2><ul>" +
          suggerimenti.map(item => `<li>${item.codice}: ${item.descrizione}</li>`).join('') +
          "</ul>";
      }

    } else {
      risultatoDiv.innerHTML = "<p>Nessun risultato esatto trovato.</p>";
    }

  } catch (error) {
    console.error("Errore durante il fetch o il parsing del CSV:", error);
  }
}

// Distanza di Hamming: quanti caratteri sono diversi tra due stringhe
function distanzaHamming(a, b) {
  if (a.length !== b.length) return Infinity;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff++;
  }
  return diff;
}