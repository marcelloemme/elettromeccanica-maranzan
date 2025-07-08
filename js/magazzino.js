document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById("codice-input");
  const cercaBtn = document.getElementById("cerca-btn");
  const mostraAZBtn = document.getElementById("mostraAZ");
  const mostraScaffaleBtn = document.getElementById("mostraScaffale");
  const aggiornaBtn = document.getElementById("aggiorna-btn");

  cercaBtn.addEventListener("click", cerca);
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") cerca();
  });
  mostraAZBtn.addEventListener("click", mostraTuttoAZ);
  mostraScaffaleBtn.addEventListener("click", mostraPerScaffale);
  aggiornaBtn.addEventListener("click", avviaAggiornamento);

  async function fetchCSV() {
    const response = await fetch(`magazzino.csv?t=${Date.now()}`);
    const text = await response.text();
    const lines = text.trim().split("\n").slice(1);

    return lines.map(line => {
      const fields = line.split(",");
      if (fields.length !== 3) return null;
      const [codice, descrizione, scaffale] = fields.map(f => f.trim());
      return { codice, descrizione, scaffale };
    }).filter(Boolean);
  }

  function resetContenuto() {
    document.getElementById("risultato").innerHTML = "";
    document.getElementById("forse-cercavi").innerHTML = "";
    document.getElementById("stesso-scaffale").innerHTML = "";
    document.getElementById("tutti-risultati").innerHTML = "";
  }

  function creaTabella(dati) {
    const table = document.createElement("table");
    table.style.marginTop = "1em";
    table.style.marginBottom = "1em";
    table.style.marginLeft = "0.2em";
    table.style.marginRight = "0.2em";
    table.style.borderCollapse = "collapse";

    dati.forEach(item => {
      const tr = document.createElement("tr");

      const tdCodice = document.createElement("td");
      tdCodice.textContent = item.codice;
      tdCodice.style.textAlign = "left";
      tdCodice.style.paddingRight = "1em";

      const tdDescrizione = document.createElement("td");
      tdDescrizione.textContent = item.descrizione;
      tdDescrizione.style.textAlign = "left";
      tdDescrizione.style.paddingRight = "1em";

      const tdScaffale = document.createElement("td");
      tdScaffale.textContent = item.scaffale;
      tdScaffale.style.textAlign = "right";
      tdScaffale.style.whiteSpace = "nowrap";
      tdScaffale.classList.add("colonna-scaffale");

      tr.appendChild(tdCodice);
      tr.appendChild(tdDescrizione);
      tr.appendChild(tdScaffale);
      table.appendChild(tr);
    });

    return table;
  }

  function codiciSimili(inputCodice, dati) {
    const base = inputCodice.replace(/-\d+$/, "");
    return dati.filter(item => {
      const baseItem = item.codice.replace(/-\d+$/, "");
      if (base === item.codice) return false;
      if (item.codice.startsWith(base + "-")) return true;

      if (base.length !== baseItem.length) return false;
      let differenze = 0;
      for (let i = 0; i < base.length; i++) {
        if (base[i] !== baseItem[i]) differenze++;
        if (differenze > 2) return false;
      }
      return differenze > 0 && differenze <= 2;
    });
  }

  async function cerca() {
    resetContenuto();
    const codiceInput = document.getElementById("codice-input").value.trim();

    const dati = await fetchCSV();
    const risultato = dati.find(item => item.codice === codiceInput);

    if (risultato) {
      const div = document.getElementById("risultato");
      const h2 = document.createElement("h2");
      h2.textContent = "Risultato";
      const p = document.createElement("p");
      p.innerHTML = `<u>${risultato.codice}</u>: ${risultato.descrizione} — <span class="colonna-scaffale">${risultato.scaffale}</span>`;
      div.appendChild(p);
      div.appendChild(p);

      const stesso = dati
        .filter(item => item.scaffale === risultato.scaffale && item.codice !== risultato.codice)
        .slice(0, 10);

      if (stesso.length > 0) {
        const sezione = document.getElementById("stesso-scaffale");
        const h3 = document.createElement("h3");
        h3.textContent = "Nello stesso scaffale";
        sezione.appendChild(h3);
        sezione.appendChild(creaTabella(stesso));
      }
    } else {
      document.getElementById("risultato").textContent = "Nessun risultato esatto trovato.";
    }

    const suggeriti = codiciSimili(codiceInput, dati).slice(0, 10);
    if (suggeriti.length > 0) {
      const sezione = document.getElementById("forse-cercavi");
      const h3 = document.createElement("h3");
      h3.textContent = "Forse cercavi";
      sezione.appendChild(h3);
      sezione.appendChild(creaTabella(suggeriti));
    }
  }

  async function mostraTuttoAZ() {
    resetContenuto();
    const dati = await fetchCSV();
    const ordinati = [...dati].sort((a, b) => a.codice.localeCompare(b.codice));

    const sezione = document.getElementById("tutti-risultati");
    const h3 = document.createElement("h3");
    h3.textContent = "Tutti i codici (A-Z)";
    sezione.appendChild(h3);
    sezione.appendChild(creaTabella(ordinati));
  }

  async function mostraPerScaffale() {
    resetContenuto();
    const dati = await fetchCSV();
    const ordinati = [...dati].sort((a, b) => {
      if (a.scaffale === b.scaffale) return a.codice.localeCompare(b.codice);
      return a.scaffale.localeCompare(b.scaffale);
    });

    const sezione = document.getElementById("tutti-risultati");
    const h3 = document.createElement("h3");
    h3.textContent = "Tutti i codici (per scaffale)";
    sezione.appendChild(h3);
    sezione.appendChild(creaTabella(ordinati));
  }

  async function avviaAggiornamento() {
    const btn = document.getElementById("aggiorna-btn");
    btn.disabled = true;
    btn.textContent = "Aggiornamento in corso...";

    try {
      const res = await fetch("https://aggiorna.marcellomaranzan.workers.dev/");
      const text = await res.text();
      alert(text);
    } catch (err) {
      alert("Errore durante l'aggiornamento.");
    }

    btn.disabled = false;
    btn.textContent = "Aggiorna";
  }
});