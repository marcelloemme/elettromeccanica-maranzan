// Google Apps Script - Magazzino CRUD con BATCH INSERT
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
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
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
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
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
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
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

  return createResponse({
    success: true,
    message: daInserire.length + ' ricambi aggiunti',
    count: daInserire.length,
    startRow: rangeInizio
  });
}

// Single insert (fallback)
function addRicambio(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

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

  return createResponse({
    success: true,
    message: 'Ricambio aggiunto',
    row: rigaDiInserimento
  });
}

function updateRicambio(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
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
      return createResponse({ success: true, message: 'Ricambio aggiornato' });
    }
  }

  return createResponse({ error: 'Ricambio non trovato' });
}

function deleteRicambio(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return createResponse({ error: 'Ricambio non trovato' });
  }

  const codici = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let i = 0; i < codici.length; i++) {
    const codiceEsistente = codici[i][0] ? codici[i][0].toString().trim() : '';
    if (codiceEsistente === data.codice) {
      const row = i + 2;
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
