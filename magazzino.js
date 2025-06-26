async function cerca() {
  const codiceCercato = document.getElementById("codice-input").value.trim();
  console.log("Codice cercato:", codiceCercato);

  try {
    const dati = await caricaDatiCSV();

    const risultato = dati.find(item => item.codice === codiceCercato);

    const divRisultato = document.getElementById("risultato");
    const divStessoScaffale = document.getElementById("stesso-scaffale");
    const divForseCercavi = document.getElementById("forse-cercavi");
    const divElenco = document.getElementById("elenco-completo");

    divRisultato.innerHTML = "";
    divStessoScaffale.innerHTML = "";
    divForseCercavi.innerHTML = "";
    divElenco.innerHTML = "";

    if (risultato) {
      divRisultato.innerHTML = `<h2>Risultato</h2><p><strong>${risultato.codice}</strong>: ${risultato.descrizione} — scaffale ${risultato.scaffale}</p>`;
    } else {
      divRisultato.innerHTML = `<p>Nessun risultato esatto trovato.</p>`;
    }

    const suggeriti = dati.filter(item => {
      if (item.codice === codiceCercato) return false;
      if (codiceCercato.length >= 6 && item.codice.startsWith(codiceCercato)) return true;
      if (item.codice.startsWith(codiceCercato + "-")) return true;
      return distanzaCodici(item.codice, codiceCercato) <= 1;
    });

    if (suggeriti.length > 0) {
      divForseCercavi.innerHTML = `<h2>Forse cercavi</h2><ul>` +
        suggeriti.map(item => `<li>${item.codice}: ${item.descrizione}</li>`).join("") +
        `</ul>`;
    }

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
    console.error("Errore nella ricerca:", errore);
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

async function caricaDatiCSV() {
  const response = await fetch("magazzino.csv");
  const testo = await response.text();
  const righe = testo.trim().split("\n").slice(1); // rimuovi intestazione
  return righe
    .map(riga => riga.split(","))
    .filter(campi => campi.length === 3)
    .map(campi => ({
      codice: campi[0].trim(),
      descrizione: campi[1].trim(),
      scaffale: campi[2].trim()
    }));
}

async function mostraTuttoAZ() {
  const dati = await caricaDatiCSV();
  const ordinati = dati.sort((a, b) => a.codice.localeCompare(b.codice));

  // Pulisce i risultati precedenti
  document.getElementById("risultato").innerHTML = "";
  document.getElementById("forse-cercavi").innerHTML = "";
  document.getElementById("stesso-scaffale").innerHTML = "";

  mostraElenco(ordinati);
}

async function mostraPerScaffale() {
  const dati = await caricaDatiCSV();
  const ordinati = dati.sort((a, b) => a.scaffale.localeCompare(b.scaffale));

  // Pulisce i risultati precedenti
  document.getElementById("risultato").innerHTML = "";
  document.getElementById("forse-cercavi").innerHTML = "";
  document.getElementById("stesso-scaffale").innerHTML = "";

  mostraElenco(ordinati);
}

// Attiva invio con tasto Enter
document.getElementById("codice-input").addEventListener("keyup", function(event) {
  if (event.key === "Enter") {
    cerca();
  }
});

// Ricerca automatica se c'è ?codice=... nell’URL
window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const codice = params.get("codice");
  if (codice) {
    document.getElementById("codice-input").value = codice;
    cerca();
  }
});