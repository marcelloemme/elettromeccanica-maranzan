// ===== CONFIGURAZIONE =====
const SPREADSHEET_ID = '122xQdmQb02UH6evZE382t0s6oRDIoiOhF5cYAAmEvY0'; // ID foglio Riparazioni
const SHEET_NAME_RIPARAZIONI = 'Riparazioni';
const SHEET_NAME_CLIENTI = 'Clienti';

// ===== FUNZIONI API =====

/**
 * Endpoint principale - gestisce tutte le richieste HTTP GET
 */
function doGet(e) {
  const action = e.parameter.action;

  try {
    switch(action) {
      case 'getRiparazioni':
        return getRiparazioni(e);
      case 'getNextNumero':
        return getNextNumero();
      case 'getClienti':
        return getClienti();
      case 'getRiparazione':
        return getRiparazione(e);
      default:
        return jsonResponse({ error: 'Azione non valida' }, 400);
    }
  } catch(error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

/**
 * Endpoint principale - gestisce tutte le richieste HTTP POST
 */
function doPost(e) {
  const action = e.parameter.action;

  try {
    const data = JSON.parse(e.postData.contents);

    switch(action) {
      case 'createRiparazione':
        return createRiparazione(data);
      case 'updateRiparazione':
        return updateRiparazione(data);
      default:
        return jsonResponse({ error: 'Azione non valida' }, 400);
    }
  } catch(error) {
    return jsonResponse({ error: error.toString() }, 500);
  }
}

// ===== RIPARAZIONI =====

/**
 * Ottiene tutte le riparazioni (con filtri opzionali)
 */
function getRiparazioni(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME_RIPARAZIONI);

  if (!sheet) {
    return jsonResponse({ error: 'Foglio Riparazioni non trovato' }, 404);
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return jsonResponse({ riparazioni: [] });
  }

  const headers = data[0];
  const rows = data.slice(1);

  // Converti in array di oggetti
  let riparazioni = rows.map(row => {
    let obj = {};
    headers.forEach((header, i) => {
      if (header === 'Attrezzi') {
        try {
          obj[header] = row[i] ? JSON.parse(row[i]) : [];
        } catch(err) {
          obj[header] = [];
        }
      } else if (header === 'Completato') {
        obj[header] = row[i] === true || row[i] === 'TRUE' || row[i] === true;
      } else {
        obj[header] = row[i] || '';
      }
    });
    return obj;
  });

  // Filtri opzionali
  const soloIncompleti = e.parameter.incompleti === 'true';
  const searchCliente = e.parameter.cliente;

  if (soloIncompleti) {
    riparazioni = riparazioni.filter(r => !r.Completato);
  }

  if (searchCliente) {
    const search = searchCliente.toLowerCase();
    riparazioni = riparazioni.filter(r =>
      r.Cliente && r.Cliente.toLowerCase().includes(search)
    );
  }

  // Ordina per numero decrescente (più recenti prima)
  riparazioni.sort((a, b) => {
    const extractProgressivo = (numero) => {
      const match = numero.match(/\/(\d+)$/);
      return match ? parseInt(match[1]) : 0;
    };
    return extractProgressivo(b.Numero) - extractProgressivo(a.Numero);
  });

  return jsonResponse({ riparazioni });
}

/**
 * Ottiene una singola riparazione per numero
 */
function getRiparazione(e) {
  const numero = e.parameter.numero;

  if (!numero) {
    return jsonResponse({ error: 'Numero riparazione mancante' }, 400);
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME_RIPARAZIONI);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const rowIndex = data.findIndex((row, i) => i > 0 && row[0] === numero);

  if (rowIndex === -1) {
    return jsonResponse({ error: 'Riparazione non trovata' }, 404);
  }

  const row = data[rowIndex];
  let riparazione = {};
  headers.forEach((header, i) => {
    if (header === 'Attrezzi') {
      try {
        riparazione[header] = row[i] ? JSON.parse(row[i]) : [];
      } catch(err) {
        riparazione[header] = [];
      }
    } else if (header === 'Completato') {
      riparazione[header] = row[i] === true || row[i] === 'TRUE';
    } else {
      riparazione[header] = row[i] || '';
    }
  });

  return jsonResponse({ riparazione });
}

/**
 * Crea una nuova riparazione
 */
function createRiparazione(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME_RIPARAZIONI);

  // Genera numero progressivo
  const anno = new Date().getFullYear();
  const ultimoProgressivo = getUltimoProgressivo(sheet, anno);
  const nuovoProgressivo = ultimoProgressivo + 1;
  const numero = `${anno % 100}/${String(nuovoProgressivo).padStart(4, '0')}`;

  // Prepara riga
  const now = new Date();
  const dataConsegna = data.dataConsegna || Utilities.formatDate(now, 'GMT+1', 'yyyy-MM-dd');
  const attrezziJson = JSON.stringify(data.attrezzi || []);

  const newRow = [
    numero,                    // A: Numero
    dataConsegna,              // B: Data Consegna
    data.cliente || '',        // C: Cliente
    data.telefono || '',       // D: Telefono
    attrezziJson,              // E: Attrezzi (JSON)
    false                      // F: Completato
  ];

  sheet.appendRow(newRow);

  // Aggiorna/aggiungi cliente se non esiste
  if (data.cliente && data.telefono) {
    updateOrAddCliente(data.cliente, data.telefono);
  }

  return jsonResponse({
    success: true,
    numero,
    message: `Riparazione ${numero} creata con successo`
  });
}

/**
 * Aggiorna una riparazione esistente
 */
function updateRiparazione(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME_RIPARAZIONI);
  const allData = sheet.getDataRange().getValues();

  const rowIndex = allData.findIndex((row, i) => i > 0 && row[0] === data.numero);

  if (rowIndex === -1) {
    return jsonResponse({ error: 'Riparazione non trovata' }, 404);
  }

  const attrezziJson = JSON.stringify(data.attrezzi || []);

  // Aggiorna campi (mantiene A - Numero, aggiorna B, C, D, E, F)
  sheet.getRange(rowIndex + 1, 2).setValue(data.dataConsegna || allData[rowIndex][1]);
  sheet.getRange(rowIndex + 1, 3).setValue(data.cliente || '');
  sheet.getRange(rowIndex + 1, 4).setValue(data.telefono || '');
  sheet.getRange(rowIndex + 1, 5).setValue(attrezziJson);
  sheet.getRange(rowIndex + 1, 6).setValue(data.completato === true);

  // Aggiorna cliente se modificato
  if (data.cliente && data.telefono) {
    updateOrAddCliente(data.cliente, data.telefono);
  }

  return jsonResponse({
    success: true,
    message: `Riparazione ${data.numero} aggiornata`
  });
}

// ===== CLIENTI =====

/**
 * Ottiene tutti i clienti (per autocomplete) - CON DEDUPLICAZIONE
 */
function getClienti() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME_CLIENTI);

  // Crea foglio se non esiste
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_CLIENTI);
    sheet.appendRow(['Nome Cliente', 'Telefono']);
    return jsonResponse({ clienti: [] });
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return jsonResponse({ clienti: [] });
  }

  const rows = data.slice(1);

  // DEDUPLICAZIONE: usa Map con chiave "nome|telefono"
  const clientiMap = new Map();

  rows.forEach(row => {
    const nome = (row[0] || '').toString().trim();
    const telefono = (row[1] || '').toString().trim();

    // Salta righe vuote
    if (!nome && !telefono) return;

    // Crea chiave unica per deduplica
    const chiave = `${nome.toLowerCase()}|${telefono}`;

    // Aggiungi solo se non esiste già
    if (!clientiMap.has(chiave)) {
      clientiMap.set(chiave, { nome, telefono });
    }
  });

  // Converti Map in array
  const clienti = Array.from(clientiMap.values());

  // Ordina alfabeticamente per nome
  clienti.sort((a, b) => a.nome.localeCompare(b.nome));

  return jsonResponse({ clienti });
}

/**
 * Aggiunge/aggiorna un cliente - CON CONTROLLO DUPLICATI MIGLIORATO
 */
function updateOrAddCliente(nome, telefono) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME_CLIENTI);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_CLIENTI);
    sheet.appendRow(['Nome Cliente', 'Telefono']);
  }

  const data = sheet.getDataRange().getValues();

  // Cerca se esiste già la coppia nome + telefono
  let found = false;
  for (let i = 1; i < data.length; i++) {
    const rowNome = (data[i][0] || '').toString().trim();
    const rowTelefono = (data[i][1] || '').toString().trim();

    // Se nome E telefono corrispondono, non fare nulla (già presente)
    if (rowNome === nome && rowTelefono === telefono) {
      found = true;
      break;
    }

    // Se solo il nome corrisponde ma telefono diverso, aggiorna il telefono
    if (rowNome === nome && rowTelefono !== telefono) {
      sheet.getRange(i + 1, 2).setValue(telefono);
      found = true;
      break;
    }
  }

  // Se non trovato, aggiungi nuovo cliente
  if (!found) {
    sheet.appendRow([nome, telefono]);
  }
}

/**
 * Ottiene solo il prossimo numero (leggero, per form nuova riparazione)
 */
function getNextNumero() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME_RIPARAZIONI);

  if (!sheet) {
    return jsonResponse({ error: 'Foglio Riparazioni non trovato' }, 404);
  }

  const anno = new Date().getFullYear();
  const ultimoProgressivo = getUltimoProgressivo(sheet, anno);
  const nuovoProgressivo = ultimoProgressivo + 1;
  const nextNumero = `${anno % 100}/${String(nuovoProgressivo).padStart(4, '0')}`;

  return jsonResponse({
    nextNumero: nextNumero,
    timestamp: Date.now()
  });
}

// ===== UTILITY =====

/**
 * Ottiene l'ultimo progressivo per l'anno corrente
 */
function getUltimoProgressivo(sheet, anno) {
  const data = sheet.getDataRange().getValues();
  let maxProgressivo = 0;

  const annoBreve = anno % 100; // 2025 -> 25

  for (let i = 1; i < data.length; i++) {
    const numero = data[i][0]; // Colonna A: Numero

    // Estrai anno e progressivo dal formato AA/NNNN
    const match = numero.match(/^(\d{2})\/(\d{4})$/);
    if (match) {
      const rowAnno = parseInt(match[1]);
      const rowProgressivo = parseInt(match[2]);

      if (rowAnno === annoBreve && rowProgressivo > maxProgressivo) {
        maxProgressivo = rowProgressivo;
      }
    }
  }

  return maxProgressivo;
}

/**
 * Helper per risposta JSON
 */
function jsonResponse(data, statusCode = 200) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
