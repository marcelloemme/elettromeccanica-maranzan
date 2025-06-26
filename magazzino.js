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
        if (valori.length < 3) return null; // Salta righe incomplete
        return {
          codice: valori[0].trim().replace(/\r|\s/g, ""),
          descrizione: valori[1].trim().replace(/\r|\s/g, " "),
          scaffale: valori[2].trim().replace(/\r|\s/g, "")
        };
      }).filter(Boolean); // Rimuove i null

      console.log("Dati letti:", dati);

      const risultati = dati.filter((r) => r.codice === codice);
      const suggeriti = dati
        .filter((r) => r.codice.includes(codice) && r.codice !== codice)
        .slice(0, 5);

      const risultatoBox = document.getElementById("risultato");
      const forseBox = document.getElementById("forse-cercavi");
      const stessoBox = document.getElementById("stesso-scaffale");

      risultatoBox.innerHTML = "";
      forseBox.innerHTML = "";
      stessoBox.innerHTML = "";

      if (risultati.length > 0) {
        const r = risultati[0];
        risultatoBox.innerHTML = `<h3>Risultato</h3><p><strong>${r.codice}</strong>: ${r.descrizione} — scaffale ${r.scaffale}</p>`;

        const altri = dati.filter(
          (d) => d.scaffale === r.scaffale && d.codice !== r.codice
        );
        if (altri.length > 0) {
          stessoBox.innerHTML =
            "<h3>Nello stesso scaffale</h3><ul>" +
            altri.map((a) => `<li>${a.codice}: ${a.descrizione}</li>`).join("") +
            "</ul>";
        }
      } else {
        risultatoBox.innerHTML = "<p>Nessun risultato esatto trovato.</p>";
      }

      if (suggeriti.length > 0) {
        forseBox.innerHTML =
          "<h3>Forse cercavi</h3><ul>" +
          suggeriti.map((s) => `<li>${s.codice}: ${s.descrizione} (scaffale ${s.scaffale})</li>`).join("") +
          "</ul>";
      }
    })
    .catch((err) => {
      console.error("Errore durante il fetch o il parsing del CSV:", err);
    });
}