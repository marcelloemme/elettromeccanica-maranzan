// Google Apps Script - DEBUG COMPLETO
const SHEET_NAME = 'Magazzino';

function doGet(e) {
  const action = e.parameter.action;
  try {
    if (action === 'getRicambi') return getRicambi();
    if (action === 'getRicambio') return getRicambio(e.parameter.codice);
    if (action === 'testInserimento') return testInserimento();
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
  const data = sheet.getDataRange().getValues();
  const ricambi = [];

  for (let i = 1; i < data.length; i++) {
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
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
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

// TEST DIAGNOSTICO - chiamalo visitando: ...exec?action=testInserimento
function testInserimento() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

  Logger.log('=== TEST INSERIMENTO ===');

  // Prova 1: Scrivi direttamente alla riga 1401
  Logger.log('Test 1: Scrivo "TEST-1401" alla riga 1401');
  sheet.getRange(1401, 1).setValue('TEST-1401');

  // Verifica immediata
  const verifica1401 = sheet.getRange(1401, 1).getValue();
  Logger.log('Verifica riga 1401: "' + verifica1401 + '"');

  // Controlla riga 2035
  const verifica2035 = sheet.getRange(2035, 1).getValue();
  Logger.log('Verifica riga 2035: "' + verifica2035 + '"');

  // Prova 2: Inserisci fisicamente una nuova riga dopo la 1400
  Logger.log('Test 2: Inserisco fisicamente nuova riga dopo 1400');
  const ultimaRigaConCodice = trovaUltimaRigaConCodice();
  Logger.log('Ultima riga con codice: ' + ultimaRigaConCodice);

  sheet.insertRowAfter(ultimaRigaConCodice);
  const nuovaRiga = ultimaRigaConCodice + 1;
  Logger.log('Riga inserita: ' + nuovaRiga);

  sheet.getRange(nuovaRiga, 1).setValue('TEST-INSERT');
  sheet.getRange(nuovaRiga, 2).setValue('Test inserimento fisico');

  const verificaInsert = sheet.getRange(nuovaRiga, 1).getValue();
  Logger.log('Verifica riga inserita (' + nuovaRiga + '): "' + verificaInsert + '"');

  return createResponse({
    success: true,
    ultimaRigaConCodice: ultimaRigaConCodice,
    verificaRiga1401: verifica1401,
    verificaRiga2035: verifica2035,
    verificaRigaInserita: verificaInsert,
    message: 'Guarda il log e il foglio per vedere dove sono finiti i dati'
  });
}

function trovaUltimaRigaConCodice() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const allData = sheet.getDataRange().getValues();

  let ultimaRigaConCodice = 1;
  for (let i = 1; i < allData.length; i++) {
    const codiceStr = allData[i][0] ? allData[i][0].toString().trim() : '';
    if (codiceStr !== '') {
      ultimaRigaConCodice = i + 1;
    }
  }

  return ultimaRigaConCodice;
}

function addRicambio(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

  if (!data.codice || data.codice.trim() === '') {
    return createResponse({ error: 'Codice obbligatorio' });
  }

  const nuovoCodice = data.codice.trim();
  const nuovaDescrizione = data.descrizione ? data.descrizione.trim() : '';
  const nuovoScaffale = data.scaffale ? data.scaffale.trim() : '';

  Logger.log('=== INSERIMENTO RICAMBIO ===');
  Logger.log('Codice: ' + nuovoCodice);

  const allData = sheet.getDataRange().getValues();
  Logger.log('DataRange: ' + allData.length + ' righe');

  let ultimaRigaConCodice = 1;

  for (let i = 1; i < allData.length; i++) {
    const codiceStr = allData[i][0] ? allData[i][0].toString().trim() : '';

    if (codiceStr === nuovoCodice) {
      return createResponse({ error: 'Codice gia esistente' });
    }

    if (codiceStr !== '') {
      ultimaRigaConCodice = i + 1;
    }
  }

  Logger.log('Ultima riga con codice: ' + ultimaRigaConCodice);

  // METODO ALTERNATIVO: Inserisci fisicamente una nuova riga
  sheet.insertRowAfter(ultimaRigaConCodice);
  const rigaDiInserimento = ultimaRigaConCodice + 1;

  Logger.log('Riga fisica inserita: ' + rigaDiInserimento);

  sheet.getRange(rigaDiInserimento, 1).setValue(nuovoCodice);
  sheet.getRange(rigaDiInserimento, 2).setValue(nuovaDescrizione);
  sheet.getRange(rigaDiInserimento, 3).setValue(nuovoScaffale);

  // Verifica
  const verificaCodice = sheet.getRange(rigaDiInserimento, 1).getValue();
  Logger.log('Verifica codice alla riga ' + rigaDiInserimento + ': "' + verificaCodice + '"');

  // Controlla se per caso è finito alla 2035
  const check2035 = sheet.getRange(2035, 1).getValue();
  Logger.log('Verifica riga 2035: "' + check2035 + '"');

  return createResponse({
    success: true,
    message: 'Ricambio aggiunto alla riga ' + rigaDiInserimento,
    row: rigaDiInserimento
  });
}

function updateRicambio(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    const codiceEsistente = values[i][0] ? values[i][0].toString().trim() : '';
    if (codiceEsistente === data.codice) {
      const row = i + 1;
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
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    const codiceEsistente = values[i][0] ? values[i][0].toString().trim() : '';
    if (codiceEsistente === data.codice) {
      const row = i + 1;
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
