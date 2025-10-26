// Google Apps Script - Magazzino CRUD con BATCH INSERT
const SPREADSHEET_ID = '1wFamrwzFNNz5iHenqVpdAHb5Dhvv5xYx5XPimjax9As';
const SHEET_NAME = 'Magazzino';

function doGet(e) {
  const action = e.parameter.action;
  try {
    if (action === 'getRicambi') return getRicambi();
    if (action === 'getRicambio') return getRicambio(e.parameter.codice);
    return createResponse({ error: 'Azione non valida' });
  } catch (err) {
    return createResponse({ error: err.toString() });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    if (action === 'addRicambio') return addRicambio(data);
    if (action === 'batchAddRicambi') return batchAddRicambi(data);
    if (action === 'updateRicambio') return updateRicambio(data);
    if (action === 'deleteRicambio') return deleteRicambio(data);
    return createResponse({ error: 'Azione non valida' });
  } catch (err) {
    return createResponse({ error: err.toString() });
  }
}

function getRicambi() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return createResponse({ ricambi: [] });
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  const ricambi = [];

  for (let i = 0; i < data.length; i++) {
    const codiceStr = data[i][0] ? data[i][0].toString().trim() : '';
    if (codiceStr === '') continue;

    ricambi.push({
      Codice: codiceStr,
      Descrizione: data[i][1] ? data[i][1].toString().trim() : '',
      Scaffale: data[i][2] ? data[i][2].toString().trim() : ''
    });
  }

  return createResponse({ ricambi: ricambi });
}

function getRicambio(codice) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return createResponse({ error: 'Ricambio non trovato' });
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();

  for (let i = 0; i < data.length; i++) {
    const codiceEsistente = data[i][0] ? data[i][0].toString().trim() : '';
    if (codiceEsistente === codice) {
      return createResponse({
        ricambio: {
          Codice: codiceEsistente,
          Descrizione: data[i][1] ? data[i][1].toString().trim() : '',
          Scaffale: data[i][2] ? data[i][2].toString().trim() : ''
        }
      });
    }
  }

  return createResponse({ error: 'Ricambio non trovato' });
}

// BATCH INSERT: inserisce tutti i ricambi in una sola operazione
function batchAddRicambi(data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const ricambi = data.ricambi;

  if (!ricambi || ricambi.length === 0) {
    return createResponse({ error: 'Nessun ricambio da aggiungere' });
  }

  const lastRow = sheet.getLastRow();
  const codiciEsistenti = new Set();

  // Carica codici esistenti
  if (lastRow > 1) {
    const codici = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < codici.length; i++) {
      const codiceStr = codici[i][0] ? codici[i][0].toString().trim() : '';
      if (codiceStr !== '') {
        codiciEsistenti.add(codiceStr.toLowerCase());
      }
    }
  }

  // Trova ultima riga con codice (scorre al contrario per velocità)
  let ultimaRigaConCodice = 1;
  if (lastRow > 1) {
    const codici = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = codici.length - 1; i >= 0; i--) {
      const codiceStr = codici[i][0] ? codici[i][0].toString().trim() : '';
      if (codiceStr !== '') {
        ultimaRigaConCodice = i + 2;
        break;
      }
    }
  }

  // Valida tutti i ricambi e prepara dati
  const daInserire = [];
  const errori = [];

  for (let i = 0; i < ricambi.length; i++) {
    const r = ricambi[i];
    const codice = r.codice ? r.codice.trim() : '';
    const descrizione = r.descrizione ? r.descrizione.trim() : '';
    const scaffale = r.scaffale ? r.scaffale.trim() : '';

    if (!codice) {
      errori.push('Riga ' + (i + 1) + ': codice vuoto');
      continue;
    }

    if (codiciEsistenti.has(codice.toLowerCase())) {
      errori.push(codice + ': già esistente');
      continue;
    }

    // Aggiungi a set per evitare duplicati nella stessa batch
    codiciEsistenti.add(codice.toLowerCase());
    daInserire.push([codice, descrizione, scaffale]);
  }

  if (errori.length > 0) {
    return createResponse({
      error: 'Errori di validazione',
      details: errori
    });
  }

  if (daInserire.length === 0) {
    return createResponse({ error: 'Nessun ricambio valido da inserire' });
  }

  // Inserisci tutte le righe in una sola operazione
  sheet.insertRowsAfter(ultimaRigaConCodice, daInserire.length);

  const rangeInizio = ultimaRigaConCodice + 1;
  sheet.getRange(rangeInizio, 1, daInserire.length, 3).setValues(daInserire);

  // Traccia scaffali modificati per cartellini - BATCH OTTIMIZZATO
  try {
    const scaffaliModificati = new Set();
    for (let i = 0; i < daInserire.length; i++) {
      const scaffale = daInserire[i][2] ? daInserire[i][2].toString().trim().toUpperCase() : '';
      if (scaffale) scaffaliModificati.add(scaffale);
    }
    if (scaffaliModificati.size > 0) {
      aggiornaModificaScaffaliBatch_(Array.from(scaffaliModificati));
    }
  } catch(e) {
    Logger.log('⚠️ Errore tracking batch: ' + e.toString());
    // Ignora errori tracciamento per non bloccare API
  }

  return createResponse({
    success: true,
    message: daInserire.length + ' ricambi aggiunti',
    count: daInserire.length,
    startRow: rangeInizio
  });
}

// Single insert (fallback)
function addRicambio(data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);

  if (!data.codice || data.codice.trim() === '') {
    return createResponse({ error: 'Codice obbligatorio' });
  }

  const nuovoCodice = data.codice.trim();
  const nuovaDescrizione = data.descrizione ? data.descrizione.trim() : '';
  const nuovoScaffale = data.scaffale ? data.scaffale.trim() : '';

  const lastRow = sheet.getLastRow();

  // Controllo duplicati
  if (lastRow > 1) {
    const codici = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < codici.length; i++) {
      const codiceStr = codici[i][0] ? codici[i][0].toString().trim() : '';
      if (codiceStr === nuovoCodice) {
        return createResponse({ error: 'Codice gia esistente' });
      }
    }
  }

  // Trova ultima riga con codice
  let ultimaRigaConCodice = 1;
  if (lastRow > 1) {
    const codici = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = codici.length - 1; i >= 0; i--) {
      const codiceStr = codici[i][0] ? codici[i][0].toString().trim() : '';
      if (codiceStr !== '') {
        ultimaRigaConCodice = i + 2;
        break;
      }
    }
  }

  sheet.insertRowAfter(ultimaRigaConCodice);
  const rigaDiInserimento = ultimaRigaConCodice + 1;

  sheet.getRange(rigaDiInserimento, 1).setValue(nuovoCodice);
  sheet.getRange(rigaDiInserimento, 2).setValue(nuovaDescrizione);
  sheet.getRange(rigaDiInserimento, 3).setValue(nuovoScaffale);

  // Traccia scaffale modificato per cartellini
  try {
    if (nuovoScaffale) {
      aggiornaModificaScaffale_(nuovoScaffale.toUpperCase());
    }
  } catch(e) {
    // Ignora errori tracciamento per non bloccare API
  }

  return createResponse({
    success: true,
    message: 'Ricambio aggiunto',
    row: rigaDiInserimento
  });
}

function updateRicambio(data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return createResponse({ error: 'Ricambio non trovato' });
  }

  const codici = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let i = 0; i < codici.length; i++) {
    const codiceEsistente = codici[i][0] ? codici[i][0].toString().trim() : '';
    if (codiceEsistente === data.codice) {
      const row = i + 2;
      sheet.getRange(row, 1).setValue(data.codice.trim());
      sheet.getRange(row, 2).setValue(data.descrizione ? data.descrizione.trim() : '');
      sheet.getRange(row, 3).setValue(data.scaffale ? data.scaffale.trim() : '');

      // Traccia scaffale modificato per cartellini
      try {
        const scaffale = data.scaffale ? data.scaffale.trim().toUpperCase() : '';
        if (scaffale) {
          aggiornaModificaScaffale_(scaffale);
        }
      } catch(e) {
        // Ignora errori tracciamento per non bloccare API
      }

      return createResponse({ success: true, message: 'Ricambio aggiornato' });
    }
  }

  return createResponse({ error: 'Ricambio non trovato' });
}

function deleteRicambio(data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return createResponse({ error: 'Ricambio non trovato' });
  }

  const codici = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let i = 0; i < codici.length; i++) {
    const codiceEsistente = codici[i][0] ? codici[i][0].toString().trim() : '';
    if (codiceEsistente === data.codice) {
      const row = i + 2;

      // Traccia scaffale modificato PRIMA di eliminare la riga
      try {
        const scaffaleValue = sheet.getRange(row, 3).getValue();
        const scaffale = scaffaleValue ? scaffaleValue.toString().trim().toUpperCase() : '';
        if (scaffale) {
          aggiornaModificaScaffale_(scaffale);
        }
      } catch(e) {
        // Ignora errori tracciamento per non bloccare API
      }

      sheet.deleteRow(row);
      return createResponse({ success: true, message: 'Ricambio eliminato' });
    }
  }

  return createResponse({ error: 'Ricambio non trovato' });
}

function createResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * BATCH OTTIMIZZATO: Aggiorna multipli scaffali in una volta sola
 * Riduce letture/scritture da N chiamate a 1 sola
 */
function aggiornaModificaScaffaliBatch_(scaffaliArray) {
  if (!scaffaliArray || scaffaliArray.length === 0) return;

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Stato Stampe');

  // Se il foglio non esiste, crealo
  if (!sheet) {
    sheet = ss.insertSheet('Stato Stampe');
    sheet.appendRow(['Scaffale', 'Ultima Stampa', 'Ultima Modifica', 'Da Stampare']);
    sheet.setFrozenRows(1);
  }

  // 1️⃣ LETTURA (1 volta sola)
  const data = sheet.getDataRange().getValues();
  const now = new Date();

  // Mappa scaffale esistente → rowIndex
  const scaffaleToRow = new Map();
  for (let i = 1; i < data.length; i++) {
    scaffaleToRow.set(data[i][0], i);
  }

  // Prepara aggiornamenti e nuove righe
  const updates = []; // {row, values, colors}
  const newRows = [];

  for (const scaffale of scaffaliArray) {
    if (scaffaleToRow.has(scaffale)) {
      // Scaffale esistente: aggiorna
      const rowIndex = scaffaleToRow.get(scaffale);
      updates.push({
        row: rowIndex + 1,
        scaffale: scaffale
      });
    } else {
      // Scaffale nuovo: aggiungi
      newRows.push([scaffale, '', now, 'SI']);
    }
  }

  // 2️⃣ SCRITTURA batch esistenti - OPERAZIONI MULTIPLE IN BATCH
  if (updates.length > 0) {
    // Raggruppa le righe da aggiornare per fare batch operations
    updates.forEach(upd => {
      const row = upd.row;
      // Batch: aggiorna 2 celle insieme (colonne C e D)
      sheet.getRange(row, 3, 1, 2).setValues([[now, 'SI']]);
      sheet.getRange(row, 3, 1, 2).setBackgrounds([['#ffcccc', '#ffcccc']]);
      sheet.getRange(row, 4).setFontWeight('bold');
    });
  }

  // 3️⃣ INSERIMENTO batch nuovi
  if (newRows.length > 0) {
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, 4).setValues(newRows);

    // Colora le nuove righe - BATCH OPERATION
    const numNewRows = newRows.length;
    const redBackgrounds = Array(numNewRows).fill(['#ffffff', '#ffffff', '#ffcccc', '#ffcccc']);
    sheet.getRange(lastRow + 1, 1, numNewRows, 4).setBackgrounds(redBackgrounds);

    // Grassetto solo colonna D
    const fontWeights = Array(numNewRows).fill([null, null, null, 'bold']);
    sheet.getRange(lastRow + 1, 1, numNewRows, 4).setFontWeights(fontWeights);
  }

  // ⚡ SKIP RIORDINAMENTO NEL BATCH - si riordinerà al prossimo onEdit o stampa
  // Questo elimina l'operazione più lenta (sort di tutto il foglio)
}

/**
 * Aggiorna timestamp modifica per uno scaffale singolo
 * Usato da onEdit() e API singole (add/update/delete)
 */
function aggiornaModificaScaffale_(scaffale) {
  if (!scaffale) return;

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName('Stato Stampe');

  // Se il foglio non esiste, crealo (inizializzazione automatica)
  if (!sheet) {
    sheet = ss.insertSheet('Stato Stampe');
    sheet.appendRow(['Scaffale', 'Ultima Stampa', 'Ultima Modifica', 'Da Stampare']);
    sheet.setFrozenRows(1);
  }

  const data = sheet.getDataRange().getValues();
  const now = new Date();
  let found = false;

  // Cerca scaffale esistente
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === scaffale) {
      const rowNum = i + 1;

      // Aggiorna valori
      sheet.getRange(rowNum, 3).setValue(now); // Ultima Modifica
      sheet.getRange(rowNum, 4).setValue('SI'); // Da Stampare = SI

      // Evidenzia in rosso colonne C e D
      sheet.getRange(rowNum, 3).setBackground('#ffcccc'); // Rosso chiaro
      sheet.getRange(rowNum, 4).setBackground('#ffcccc').setFontWeight('bold');

      found = true;
      break;
    }
  }

  // Se scaffale non esiste, aggiungilo
  if (!found) {
    sheet.appendRow([scaffale, '', now, 'SI']);
    const lastRow = sheet.getLastRow();

    // Evidenzia in rosso la nuova riga (colonne C e D)
    sheet.getRange(lastRow, 3).setBackground('#ffcccc');
    sheet.getRange(lastRow, 4).setBackground('#ffcccc').setFontWeight('bold');

    // Riordina automaticamente dopo aver aggiunto nuovo scaffale
    if (lastRow > 2) {
      const range = sheet.getRange(2, 1, lastRow - 1, 4);
      range.sort({column: 1, ascending: true});
    }
  }
}
