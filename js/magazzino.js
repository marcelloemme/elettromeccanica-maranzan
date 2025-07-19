// Assicurati che jsQR sia incluso via script HTML esterno oppure già disponibile globalmente
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

  const scanBtn = document.getElementById("scan-btn");
  if (scanBtn) {
    scanBtn.addEventListener("click", () => {
      const fileInput = document.getElementById("qr-file-input");
      fileInput.click();
    });
  }

  const qrFileInput = document.getElementById("qr-file-input");
  let cvReady = false;
  if (qrFileInput) {
    qrFileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async function(event) {
        console.log("File caricato:", file.name);
        console.log("Tipo MIME:", file.type);
        try {
          if (!cvReady) {
            console.log("Caricamento di OpenCV.js...");
            await new Promise((resolve, reject) => {
              const script = document.createElement('script');
              script.src = 'https://docs.opencv.org/4.5.5/opencv.js';
              script.onload = () => {
                cv['onRuntimeInitialized'] = () => {
                  console.log("OpenCV.js pronto");
                  cvReady = true;
                  resolve();
                };
              };
              script.onerror = reject;
              document.body.appendChild(script);
            });
          }

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
          const decodedText = new cv.String();
          const points = new cv.Mat();
          const straightQR = new cv.Mat();

          const success = qrDetector.detectAndDecode(gray, decodedText, points, straightQR);
          if (success) {
            console.log("Codice QR rilevato:", decodedText.string);
            input.value = decodedText.string;
            cerca();
          } else {
            console.warn("QR non riconosciuto");
            alert("Codice QR non riconosciuto.");
          }

          // cleanup
          mat.delete(); gray.delete(); qrDetector.delete(); points.delete(); straightQR.delete(); decodedText.delete();
        } catch (err) {
          console.error("Errore durante la scansione:", err);
          alert("Errore durante la scansione.");
        }
      };
      reader.readAsDataURL(file);
    });
  }

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
});