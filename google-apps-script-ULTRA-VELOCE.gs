// Google Apps Script - Magazzino CRUD ULTRA VELOCE
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

// ULTRA VELOCE: usa appendRow (aggiunge in fondo, poi ordini offline)
function addRicambio(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

  if (!data.codice || data.codice.trim() === '') {
    return createResponse({ error: 'Codice obbligatorio' });
  }

  const nuovoCodice = data.codice.trim();
  const nuovaDescrizione = data.descrizione ? data.descrizione.trim() : '';
  const nuovoScaffale = data.scaffale ? data.scaffale.trim() : '';

  // SOLO controllo duplicati server-side come fallback
  // (il client dovrebbe già validare usando cache)
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const codici = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

    for (let i = 0; i < codici.length; i++) {
      const codiceStr = codici[i][0] ? codici[i][0].toString().trim() : '';
      if (codiceStr === nuovoCodice) {
        return createResponse({ error: 'Codice gia esistente' });
      }
    }
  }

  // appendRow è MOLTO più veloce di insertRowAfter
  sheet.appendRow([nuovoCodice, nuovaDescrizione, nuovoScaffale]);

  return createResponse({
    success: true,
    message: 'Ricambio aggiunto',
    codice: nuovoCodice
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
