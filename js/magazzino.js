// Assicurati che jsQR sia incluso via script HTML esterno oppure già disponibile globalmente
document.addEventListener('DOMContentLoaded', () => {
  function initQRScanner() {
    if (typeof cv === 'undefined' || !cv || !cv.QRCodeDetector) {
      console.error("❌ OpenCV.js non è disponibile o non è stato caricato correttamente.");
      return;
    }

    if (cv.getBuildInformation) {
      console.log("✅ OpenCV pronto");
    }

    const qrFileInput = document.getElementById("qr-file-input");
    if (qrFileInput) {
      qrFileInput.addEventListener("change", handleQRScan);
    }
  }

  if (typeof cv !== 'undefined' && cv['onRuntimeInitialized']) {
    // Se già inizializzato
    initQRScanner();
  } else if (typeof cv !== 'undefined') {
    // Se non ancora inizializzato
    cv['onRuntimeInitialized'] = initQRScanner;
  } else {
    console.error("❌ cv non definito: assicurati che OpenCV sia incluso da HTML");
  }

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

  const scanBtn = document.getElementById("scan-btn");
  if (scanBtn) {
    scanBtn.addEventListener("click", () => {
      const fileInput = document.getElementById("qr-file-input");
      fileInput.click();
    });
  }

  function splitCSVLine(line) {
    // Divide sui separatori "," che NON sono fra virgolette
    const re = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/;
    return line.split(re);
  }
  function unquote(s) {
    if (!s) return "";
    s = s.trim();
    return (s.startsWith('"') && s.endsWith('"'))
      ? s.slice(1, -1).replace(/""/g, '"')
      : s;
  }

  async function fetchCSV() {
    const res = await fetch(`magazzino.csv?t=${Date.now()}`, { cache: "no-store" });
    const raw = await res.text();

    // pulizia: BOM, CRLF, righe vuote
    const clean = raw.replace(/^\uFEFF/, "").replace(/\r/g, "");
    const lines = clean.split("\n").filter(l => l.trim() !== "");
    if (lines.length === 0) return [];

    // header → mappiamo per nome (resiste a virgole extra e colonne disallineate)
    const headerCells = splitCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    let idxCod = headerCells.indexOf("codice");
    let idxDesc = headerCells.indexOf("descrizione");
    let idxSca = headerCells.indexOf("scaffale");

    // fallback: se i nomi non sono presenti, prendi le prime tre colonne
    if (idxCod < 0 || idxDesc < 0 || idxSca < 0) {
      idxCod = 0; idxDesc = 1; idxSca = 2;
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCSVLine(lines[i]);

      // ignora righe completamente vuote
      if (!cells.some(c => c && c.trim() !== "")) continue;

      const codice = unquote(cells[idxCod]  ?? "");
      const descr  = unquote(cells[idxDesc] ?? "");
      const scaff  = unquote(cells[idxSca]  ?? "");

      // requisito minimo: deve esserci il codice
      if (!codice.trim()) continue;

      rows.push({
        codice: codice.trim(),
        descrizione: descr.trim(),
        scaffale: scaff.trim()
      });
    }

    return rows;
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
      tdDescrizione.style.width = "100%";
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
      const h3 = document.createElement("h3");
      h3.textContent = "Risultato esatto";
      div.appendChild(h3);
      const tabellaEsatto = creaTabella([risultato]);
      div.appendChild(tabellaEsatto);

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
    btn.textContent = "Aggiorna dati";
  }

  async function handleQRScan(e) {
    const input = document.getElementById("codice-input");
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(event) {
      console.log("File caricato:", file.name);
      console.log("Tipo MIME:", file.type);
      try {
        const imageBitmap = await createImageBitmap(file);
        console.log("Bitmap creata:", imageBitmap);

        const canvas = document.createElement("canvas");
        canvas.width = imageBitmap.width;
        canvas.height = imageBitmap.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(imageBitmap, 0, 0);
        console.log("Disegnato su canvas");

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        console.log("ImageData estratto");

        // Conversione a Mat per OpenCV
        const mat = cv.matFromImageData(imageData);
        const gray = new cv.Mat();
        cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);

        const qrDetector = new cv.QRCodeDetector();
        const points = new cv.Mat();
        const straightQR = new cv.Mat();

        const result = qrDetector.detectAndDecode(gray);
        if (result) {
          console.log("Codice QR rilevato:", result);
          input.value = result;
          cerca();
        } else {
          console.warn("QR non riconosciuto");
          alert("Codice QR non riconosciuto.");
        }

        // cleanup
        mat.delete(); gray.delete(); qrDetector.delete(); points.delete(); straightQR.delete();
      } catch (err) {
        console.error("Errore durante la scansione:", err);
        alert("Errore durante la scansione.");
      }
    };
    reader.readAsDataURL(file);
  }
});