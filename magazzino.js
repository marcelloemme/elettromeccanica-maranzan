function cerca() {
  const codice = document.getElementById("codice-input").value.trim();
  if (!codice) return;

  console.log("Codice cercato:", codice);

  fetch("magazzino.csv")
    .then((res) => res.text())
    .then((text) => {
      const righe = text.trim().split("\n");
      const intestazioni = righe[0].split(",");
      const dati = righe.slice(1)
        .map((r) => r.split(","))
        .filter((v) => v.length >= 3)
        .map((valori) => {
          return {
            codice: valori[0].trim().replace(/^"|"$/g, ""),
            descrizione: valori[1].trim().replace(/^"|"$/g, ""),
            scaffale: valori[2].trim().replace(/^"|"$/g, "")
          };
        });

      console.log("Dati letti:", dati.map(d => d.codice));

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
        risultatoBox.innerHTML = `<h2>Risultato</h2><p><strong>${r.codice}</strong>: ${r.descrizione} — scaffale ${r.scaffale}</p>`;
        const altri = dati.filter((d) => d.scaffale === r.scaffale && d.codice !== r.codice);
        if (altri.length > 0) {
          stessoBox.innerHTML = "<h3>Nello stesso scaffale</h3><ul>" +
            altri.map((a) => `<li>${a.codice}: ${a.descrizione}</li>`).join("") +
            "</ul>";
        }
      } else {
        risultatoBox.innerHTML = "<p>Nessun risultato esatto trovato.</p>";
      }

      if (suggeriti.length > 0) {
        forseBox.innerHTML = "<h3>Forse cercavi</h3><ul>" +
          suggeriti.map((s) => `<li>${s.codice}: ${s.descrizione} (scaffale ${s.scaffale})</li>`).join("") +
          "</ul>";
      }
    });
}
