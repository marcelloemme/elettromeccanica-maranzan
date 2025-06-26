function cerca() {
  const codice = document.getElementById("codice-input").value.trim();
  if (!codice) return;

  fetch("magazzino.csv")
    .then((res) => res.text())
    .then((text) => {
      const righe = text.trim().split("\n");
      const intestazioni = righe[0].split(",");
      const dati = righe.slice(1).map((r) => {
        const valori = r.split(",");
        return {
          codice: valori[0]?.trim().replace(/"/g, ""),
          descrizione: valori[1]?.trim().replace(/"/g, ""),
          scaffale: valori[2]?.trim().replace(/"/g, ""),
        };
      });

      console.log("Codice cercato:", codice);
      console.log("Dati letti:", dati);

      const risultati = dati.filter((r) => r.codice === codice);

      const suggeriti = dati.filter(
        (r) => suggerimentiCodice(codice).includes(r.codice) && r.codice !== codice
      ).slice(0, 10);

      const risultatoBox = document.getElementById("risultato");
      const forseBox = document.getElementById("forse-cercavi");
      const stessoBox = document.getElementById("stesso-scaffale");

      risultatoBox.innerHTML = "";
      forseBox.innerHTML = "";
      stessoBox.innerHTML = "";

      if (risultati.length > 0) {
        const r = risultati[0];
        risultatoBox.innerHTML = `<h3>Risultato</h3><p><strong>${r.codice}</strong>: ${r.descrizione} —  scaffale ${r.scaffale}</p>`;

        const altri = dati.filter((d) => d.scaffale === r.scaffale && d.codice !== r.codice);
        if (altri.length > 0) {
          stessoBox.innerHTML = `<h3>Nello stesso scaffale</h3><ul>` +
            altri.map((a) => `<li>${a.codice}: ${a.descrizione}</li>`).join("") + "</ul>";
        }
      } else {
        risultatoBox.innerHTML = "<p>Nessun risultato esatto trovato.</p>";
      }

      if (suggeriti.length > 0) {
        forseBox.innerHTML = `<h3>Forse cercavi</h3><ul>` +
          suggeriti.map((s) => `<li>${s.codice}: ${s.descrizione} (scaffale ${s.scaffale})</li>`).join("") + "</ul>";
      }
    })
    .catch((err) => {
      console.error("Errore durante il fetch o il parsing del CSV:", err);
    });
}

function suggerimentiCodice(codiceBase) {
  const varianti = new Set();
  const base = codiceBase.split("-")[0];

  // Una cifra diversa
  for (let i = 0; i < base.length; i++) {
    for (let d = 0; d <= 9; d++) {
      if (base[i] !== d.toString()) {
        varianti.add(base.slice(0, i) + d + base.slice(i + 1));
      }
    }
  }

  // Aggiunta di suffissi -1, -2, ..., -9
  for (let i = 1; i <= 9; i++) {
    varianti.add(`${base}-${i}`);
  }

  return Array.from(varianti);
} 