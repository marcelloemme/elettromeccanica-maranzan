function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Cartellini')
    .addItem('🖨️ Stampa cartellini nuovi/modificati', 'checkScaffaliDaStampare_')
    .addItem('🖨️ Stampa cartellini manualmente', 'generaCartelliniA4Grid')
    .addSeparator()
    .addItem('Inizializza tracciamento stampe', 'initStatoStampe_')
    .addItem('Marca tutti come stampati', 'marcaTuttiStampati_')
    .addToUi();
}

/**
 * Controlla se ci sono scaffali da stampare e mostra notifica
 */
function checkScaffaliDaStampare_() {
  try {
    var daStampare = getScaffaliDaStampare_();

    if (daStampare.length === 0) return; // Nessuna modifica

    var ui = SpreadsheetApp.getUi();
    var lista = daStampare.join(', ');
    var messaggio = 'Modifiche non stampate agli scomparti:\n\n' + lista + '\n\nStampare nuovi cartellini?';

    var risposta = ui.alert(
      '🖨️ Cartellini da stampare',
      messaggio,
      ui.ButtonSet.YES_NO
    );

    if (risposta === ui.Button.YES) {
      // Genera PDF solo per scaffali modificati
      generaPDFScaffali_(daStampare);
    }
  } catch(error) {
    // Ignora errori silenziosamente
  }
}

/**
 * Genera PDF per lista specifica di scaffali
 */
function generaPDFScaffali_(scaffali) {
  if (!scaffali || scaffali.length === 0) return;

  var pdf = buildSlidesA4GridPdf_(SLIDES_TEMPLATE_A4_ID, scaffali);

  if (pdf) {
    // Marca scaffali come stampati
    marcaScaffaliStampati_(scaffali);

    // Mostra dialog con link
    var pdfUrl = pdf.getUrl();
    var html = HtmlService.createHtmlOutput(
      '<div style="padding:20px;font-family:Arial,sans-serif;">' +
      '<p style="margin-bottom:15px;">✅ PDF generato con successo!</p>' +
      '<p style="margin-bottom:15px;">📁 <b>' + scaffali.length + ' scaffali</b> stampati: ' + scaffali.join(', ') + '</p>' +
      '<p style="margin-bottom:15px;">📄 File: <b>' + pdf.getName() + '</b></p>' +
      '<p><a href="' + pdfUrl + '" target="_blank" style="display:inline-block;background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">📄 Apri PDF</a></p>' +
      '</div>'
    ).setWidth(500).setHeight(220);
    SpreadsheetApp.getUi().showModelessDialog(html, 'Cartellini generati');
  }
}

/**
 * Marca tutti gli scaffali come stampati (reset completo)
 */
function marcaTuttiStampati_() {
  var ui = SpreadsheetApp.getUi();
  var risposta = ui.alert(
    'Marca tutti come stampati',
    'Questa operazione marca tutti gli scaffali come già stampati.\n\nContinuare?',
    ui.ButtonSet.YES_NO
  );

  if (risposta !== ui.Button.YES) return;

  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Stato Stampe');
  if (!sheet) {
    ui.alert('Foglio "Stato Stampe" non trovato. Inizializzalo prima.');
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var now = new Date();

  // Imposta tutte le righe come stampate e rimuovi evidenziazione
  for (var i = 2; i <= lastRow; i++) {
    sheet.getRange(i, 2).setValue(now); // Ultima Stampa
    sheet.getRange(i, 4).setValue('NO'); // Da Stampare = NO

    // Rimuovi evidenziazione rossa
    sheet.getRange(i, 3).setBackground('#ffffff');
    sheet.getRange(i, 4).setBackground('#ffffff').setFontWeight('normal');
  }

  ui.alert('✅ Tutti gli scaffali marcati come stampati.');
}

var SLIDES_TEMPLATE_ID = '117qDq6tuoNwAeCuYFqA5UygRmQ7p28YLgMdNWvp-TKw'; // Template 6x9 cm
var SLIDES_TEMPLATE_A4_ID = '1TT55LCwRtPmWQ1ORxMm4yuZYkT3ZTX27shF2BcMmRe0'; // Template A4 (21x29.7 cm)

function generaCartelliniSlides(){
  var ui = SpreadsheetApp.getUi();

  // 1) Leggi eventuale elenco da foglio SELEZIONE (colonna A)
  var fromSheet = getSelectedShelves_(); // array oppure null

  // 2) Chiedi opzionalmente intervalli/elenco via prompt (A01-A03, F01, AA01-AC02, …)
  var res = ui.prompt('Cartellini 6×9 (Slides)', 'Lascia vuoto per usare solo SELEZIONE (o TUTTI se SELEZIONE è vuoto). Oppure inserisci elenco/INTERVALLI separati da virgole: es. A01-A03, F01, AA01-AC02', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var typed = String(res.getResponseText()||'').trim();
  var fromTyped = typed ? parseShelfFilters_(typed) : null; // array oppure null

  // 3) Merge + dedup
  var filters = null;
  if (fromSheet && fromTyped){
    var seen = {}; filters = [];
    for (var i=0;i<fromSheet.length;i++){ var v1 = fromSheet[i]; if (!seen[v1]){ seen[v1]=true; filters.push(v1); } }
    for (var j=0;j<fromTyped.length;j++){ var v2 = fromTyped[j]; if (!seen[v2]){ seen[v2]=true; filters.push(v2); } }
  } else if (fromSheet){
    filters = fromSheet;
  } else if (fromTyped){
    filters = fromTyped;
  } else {
    filters = null; // nessun filtro => TUTTI
  }

  var pdf = buildSlides6x9Pdf_(SLIDES_TEMPLATE_ID, filters);
  if (pdf){
    // Mostra dialog con link cliccabile
    var pdfUrl = pdf.getUrl();
    var html = HtmlService.createHtmlOutput(
      '<div style="padding:20px;font-family:Arial,sans-serif;">' +
      '<p style="margin-bottom:15px;">✅ PDF generato con successo!</p>' +
      '<p style="margin-bottom:15px;">📁 Salvato in: <b>' + pdf.getName() + '</b></p>' +
      '<p><a href="' + pdfUrl + '" target="_blank" style="display:inline-block;background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">📄 Apri PDF</a></p>' +
      '</div>'
    ).setWidth(400).setHeight(180);
    ui.showModelessDialog(html, 'Cartellini generati');
  }
}

function generaCartelliniA4Grid(){
  var ui = SpreadsheetApp.getUi();

  // 1) Leggi eventuale elenco da foglio SELEZIONE (colonna A)
  var fromSheet = getSelectedShelves_(); // array oppure null

  // 2) Chiedi opzionalmente intervalli/elenco via prompt (A01-A03, F01, AA01-AC02, …)
  var res = ui.prompt('Cartellini A4 (griglia 3×3)', 'Lascia vuoto per usare solo SELEZIONE (o TUTTI se SELEZIONE è vuoto). Oppure inserisci elenco/INTERVALLI separati da virgole: es. A01-A03, F01, AA01-AC02', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var typed = String(res.getResponseText()||'').trim();
  var fromTyped = typed ? parseShelfFilters_(typed) : null; // array oppure null

  // 3) Merge + dedup
  var filters = null;
  if (fromSheet && fromTyped){
    var seen = {}; filters = [];
    for (var i=0;i<fromSheet.length;i++){ var v1 = fromSheet[i]; if (!seen[v1]){ seen[v1]=true; filters.push(v1); } }
    for (var j=0;j<fromTyped.length;j++){ var v2 = fromTyped[j]; if (!seen[v2]){ seen[v2]=true; filters.push(v2); } }
  } else if (fromSheet){
    filters = fromSheet;
  } else if (fromTyped){
    filters = fromTyped;
  } else {
    filters = null; // nessun filtro => TUTTI
  }

  var pdf = buildSlidesA4GridPdf_(SLIDES_TEMPLATE_A4_ID, filters);
  if (pdf){
    // Marca scaffali come stampati
    if (filters && filters.length > 0) {
      marcaScaffaliStampati_(filters);
    }

    // Mostra dialog con link cliccabile
    var pdfUrl = pdf.getUrl();
    var numScaffali = filters ? filters.length : 'tutti';
    var html = HtmlService.createHtmlOutput(
      '<div style="padding:20px;font-family:Arial,sans-serif;">' +
      '<p style="margin-bottom:15px;">✅ PDF A4 (griglia 3×3) generato con successo!</p>' +
      '<p style="margin-bottom:15px;">📁 <b>' + numScaffali + ' scaffali</b> stampati</p>' +
      '<p style="margin-bottom:15px;">📄 File: <b>' + pdf.getName() + '</b></p>' +
      '<p><a href="' + pdfUrl + '" target="_blank" style="display:inline-block;background:#1a73e8;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;">📄 Apri PDF</a></p>' +
      '</div>'
    ).setWidth(400).setHeight(200);
    ui.showModelessDialog(html, 'Cartellini A4 generati');
  }
}

function getSelectedShelves_(){
  // Se esiste un foglio chiamato "SELEZIONE", leggi la colonna A come elenco di scaffali
  var ss = SpreadsheetApp.getActive();
  var sh = null;
  try { sh = ss.getSheetByName('SELEZIONE'); } catch(e) { sh = null; }
  if (!sh) return null; // nessuna selezione: genera TUTTI

  var last = sh.getLastRow();
  if (last < 1) return null;
  var vals = sh.getRange(1,1,last,1).getValues();
  var out = [];
  for (var i=0;i<vals.length;i++){
    var v = vals[i][0];
    if (!v) continue;
    v = String(v).toUpperCase().replace(/\s+/g,'');
    if (v) out.push(v);
  }
  // deduplica
  var seen = {}; var dedup = [];
  for (var j=0;j<out.length;j++){ var s=out[j]; if (!seen[s]){ seen[s]=true; dedup.push(s);} }
  return dedup.length ? dedup : null; // null => tutti
}

function parseShelfFilters_(input){
  if (!input) return null;

  function normalizeDashes(str){
    var s = String(str);
    var out = '';
    for (var i = 0; i < s.length; i++){
      var ch = s.charAt(i);
      var code = s.charCodeAt(i);
      // figure dash, en dash, em dash, horizontal bar, minus sign
      if (code === 8210 || code === 8211 || code === 8212 || code === 8213 || code === 8722){
        out += '-';
      } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'){
        // skip whitespace
      } else {
        out += ch;
      }
    }
    return out.toUpperCase();
  }

  function splitCode(code){
    if (!code) return null;
    var s = String(code).toUpperCase();
    var i = 0;
    var prefix = '';
    while (i < s.length){
      var cc = s.charCodeAt(i);
      if (cc >= 65 && cc <= 90){ prefix += s.charAt(i); i++; } else { break; }
    }
    if (!prefix) return null;
    var numStr = s.substring(i);
    if (!numStr) return null;
    for (var k = 0; k < numStr.length; k++){
      var c = numStr.charCodeAt(k);
      if (c < 48 || c > 57) return null;
    }
    return { prefix: prefix, numStr: numStr, num: parseInt(numStr, 10) };
  }

  function zpad(num, w){
    var s = String(num);
    while (s.length < w) s = '0' + s;
    return s;
  }

  function isAllLetters(s){
    if (!s) return false;
    for (var i=0;i<s.length;i++){
      var cc = s.charCodeAt(i);
      if (cc < 65 || cc > 90) return false;
    }
    return true;
  }

  function alphaToNum(str){
    var n = 0;
    for (var i=0;i<str.length;i++) n = n*26 + (str.charCodeAt(i) - 65);
    return n;
  }
  function numToAlpha(n, len){
    var arr = [];
    for (var i=0;i<len;i++) arr.push('A');
    for (var pos=len-1; pos>=0; pos--){
      arr[pos] = String.fromCharCode(65 + (n % 26));
      n = Math.floor(n/26);
    }
    return arr.join('');
  }

  var norm = normalizeDashes(input);
  var parts = norm.split(',');
  var out = [];

  for (var p=0; p<parts.length; p++){
    var part = parts[p];
    if (!part) continue;

    var dashPos = part.indexOf('-');
    if (dashPos === -1){ out.push(part); continue; }

    var start = part.substring(0, dashPos);
    var end   = part.substring(dashPos + 1);
    if (!start || !end){ out.push(part); continue; }

    var s1 = splitCode(start);
    var s2 = splitCode(end);
    if (!s1 || !s2){ out.push(part); continue; }

    var p1 = s1.prefix, p2 = s2.prefix;
    var n1 = s1.num,    n2 = s2.num;
    if (isNaN(n1) || isNaN(n2)){ out.push(part); continue; }

    var numStart = Math.min(n1, n2);
    var numEnd   = Math.max(n1, n2);
    var width = Math.max(s1.numStr.length, s2.numStr.length);

    if (p1 === p2){
      for (var n=numStart; n<=numEnd; n++) out.push(p1 + zpad(n, width));
      continue;
    }

    if (isAllLetters(p1) && isAllLetters(p2) && p1.length === p2.length){
      var sN = alphaToNum(p1), eN = alphaToNum(p2);
      var lo = Math.min(sN, eN), hi = Math.max(sN, eN);
      for (var prefN = lo; prefN <= hi; prefN++){
        var pref = numToAlpha(prefN, p1.length);
        for (var nn=numStart; nn<=numEnd; nn++) out.push(pref + zpad(nn, width));
      }
      continue;
    }

    out.push(part);
  }

  // deduplica
  var seen = {}; var dedup = [];
  for (var i=0;i<out.length;i++){ var v=out[i]; if (v && !seen[v]){ seen[v]=true; dedup.push(v); } }
  return dedup.length ? dedup : null;
}

// ===== Helpers Drive v3 via UrlFetch (evitano DriveApp.getFileById) =====
function getSpreadsheetParentFolderId_(){
  try {
    var ssId = SpreadsheetApp.getActive().getId();
    var url = 'https://www.googleapis.com/drive/v3/files/' + ssId + '?fields=parents';
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
      var obj = JSON.parse(res.getContentText());
      if (obj.parents && obj.parents.length > 0) return obj.parents[0];
    }
  } catch(e) {}
  return null;
}
function driveCopyFile_(fileId, name, parentId){
  var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/copy';
  var payload = { name: name };
  if (parentId) payload.parents = [parentId];
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    var obj = JSON.parse(res.getContentText());
    return obj.id;
  }
  throw new Error('Drive copy failed: ' + code + ' ' + res.getContentText());
}
function driveExportPdf_(fileId){
  var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=application/pdf';
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    return Utilities.newBlob(res.getContent(), 'application/pdf', 'export.pdf');
  }
  throw new Error('Drive export failed: ' + code + ' ' + res.getContentText());
}
function driveMoveToFolder_(fileId, parentId){
  try {
    if (!parentId) return;
    var url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?addParents=' + encodeURIComponent(parentId) + '&removeParents=root&fields=id,parents';
    UrlFetchApp.fetch(url, {
      method: 'patch',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
  } catch(e) {}
}
function driveTrashFile_(fileId){
  try {
    var url = 'https://www.googleapis.com/drive/v3/files/' + fileId;
    UrlFetchApp.fetch(url, {
      method: 'patch',
      contentType: 'application/json',
      payload: JSON.stringify({ trashed: true }),
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
  } catch(e) {}
}

// ===== Helper: apertura Slides con retry (gestisce "Servizio non disponibile: Presentazioni") =====
function openSlidesWithRetry_(id){
  var attempts = 6; // ~6 secondi totali
  for (var i=0; i<attempts; i++){
    try {
      return SlidesApp.openById(id);
    } catch (e) {
      Utilities.sleep(1000); // attende e ritenta
    }
  }
  return null;
}

function buildSlides6x9Pdf_(templateId, scaffoldFilter){
  // 1) Leggi dati dal foglio "Per codice" (ordinato per codice crescente)
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Per codice');
  if (!sh){
    SpreadsheetApp.getUi().alert('Errore: Foglio "Per codice" non trovato!');
    return null;
  }
  var last = sh.getLastRow();
  if (last < 2){ SpreadsheetApp.getUi().alert('Nessun dato.'); return null; }
  var data = sh.getRange(2,1,last-1,3).getValues(); // A=codice, B=descrizione, C=scaffale
  var byShelf = {};
  for (var r=0; r<data.length; r++){
    var code = (data[r][0]||'').toString().trim();
    var desc = (data[r][1]||'').toString().trim();
    var shelf = (data[r][2]||'').toString().trim().toUpperCase();
    if (!shelf) continue;
    if (!code && !desc) continue;
    if (scaffoldFilter && scaffoldFilter.indexOf(shelf) === -1) continue;
    if (!byShelf[shelf]) byShelf[shelf] = [];
    byShelf[shelf].push({code:code, desc:desc});
  }
  var shelves = Object.keys(byShelf).sort(function(a,b){ return a.localeCompare(b,'it'); });
  if (shelves.length === 0){ SpreadsheetApp.getUi().alert('Nessuno scaffale trovato con questi criteri.'); return null; }

  // 2) Copia template (Drive v3) e apri Slides — niente DriveApp.getFileById
  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
  var baseName = 'Cartellini_6x9_Slides_' + ts;
  var targetFolderId = getSpreadsheetParentFolderId_();
  var copyId = driveCopyFile_(templateId, baseName, targetFolderId);
  // attende un attimo per la propagazione su Drive e apre con retry
  Utilities.sleep(1000);
  var pres = openSlidesWithRetry_(copyId);
  if (!pres){
    SpreadsheetApp.getUi().alert('Slides non disponibile al momento. Riprova fra qualche secondo.');
    driveTrashFile_(copyId);
    return null;
  }

  // 3) Misure pagina e stili
  var PT_PER_CM = 28.3464567;
  var PAGE_W = 6 * PT_PER_CM; // 6 cm
  var PAGE_H = 9 * PT_PER_CM; // 9 cm
  var margin = 0.3 * PT_PER_CM; // 3 mm
  var font = 'Roboto';
  var titleSize = 11;
  var baseBodySize = 11;

  // 4) Genera una slide per scaffale
  for (var s=0; s<shelves.length; s++){
    var shelf = shelves[s];
    var slide = pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);

    // TITLE BOX (fisso)
    var TITLE_BOX_H = 30; // pt ~ titolo 11pt + spacer 8pt
    var INSET_FIX_PT = 6;
    var titleTb = slide.insertTextBox('', margin, margin, PAGE_W - 2*margin, TITLE_BOX_H);
    titleTb.setLeft(margin - INSET_FIX_PT);
    titleTb.setTop(margin - INSET_FIX_PT);
    titleTb.setWidth((PAGE_W - 2*margin) + 2*INSET_FIX_PT);
    titleTb.setHeight(TITLE_BOX_H + 2*INSET_FIX_PT);
    try { titleTb.getLine().setWeight(0); titleTb.getLine().getLineFill().setTransparent(); } catch(e) {}
    var titleTf = titleTb.getText();
    titleTf.setText('');
    var titleRange = titleTf.appendText(shelf);
    titleRange.getTextStyle().setBold(true).setUnderline(true).setFontFamily(font).setFontSize(titleSize).setForegroundColor('#000000');
    titleTf.appendText('\n');
    var titleSpacer = titleTf.appendText(' ');
    titleSpacer.getTextStyle().setFontFamily(font).setFontSize(8).setForegroundColor('#000000').setBold(false).setItalic(false).setUnderline(false);

    // CONTENT BOX
    var contentTop = margin + TITLE_BOX_H;
    var contentHeight = PAGE_H - 2*margin - TITLE_BOX_H;
    var contentTb = slide.insertTextBox('', margin, contentTop, PAGE_W - 2*margin, contentHeight);
    contentTb.setLeft(margin - INSET_FIX_PT);
    contentTb.setTop(contentTop - INSET_FIX_PT);
    contentTb.setWidth((PAGE_W - 2*margin) + 2*INSET_FIX_PT);
    contentTb.setHeight(contentHeight + 2*INSET_FIX_PT);
    try { contentTb.getLine().setWeight(0); contentTb.getLine().getLineFill().setTransparent(); } catch(e) {}
    var tf = contentTb.getText();
    tf.setText('');

    // Raggruppa per descrizione: più codici, una sola descrizione
    var items = byShelf[shelf] || [];
    var groupsMap = {};
    var order = [];
    for (var ii=0; ii<items.length; ii++){
      var code = (items[ii].code||'').toString();
      var desc = (items[ii].desc||'').toString();
      if (!groupsMap.hasOwnProperty(desc)){ groupsMap[desc] = []; order.push(desc); }
      groupsMap[desc].push(code);
    }

    // Stima height e fitting fine
    var nCodes = 0; for (var k in groupsMap){ if (groupsMap.hasOwnProperty(k)) nCodes += groupsMap[k].length; }
    var nDescs = order.length;
    var nSpacers = Math.max(0, order.length - 1);
    var contentHeightPt = contentHeight;
    var LINE_FACTOR = 1.24;  // prudente
    var minBody = 7.5;       // pt
    var step = 0.1;          // pt
    function totalHeightEstimate(bodySize){
      var descSize = Math.max(minBody - 1, bodySize - 1);
      var codesHeight = nCodes * bodySize * LINE_FACTOR;
      var descsHeight = nDescs * descSize * LINE_FACTOR;
      var spacersHeight = nSpacers * 9; // ~9 pt tra gruppi
      return codesHeight + descsHeight + spacersHeight;
    }
    var bodySizeFitted = baseBodySize;
    while (totalHeightEstimate(bodySizeFitted) > contentHeightPt && bodySizeFitted > minBody){
      bodySizeFitted = Math.max(minBody, +(bodySizeFitted - step).toFixed(2));
    }
    var descSizeFitted = Math.max(minBody - 1, +(bodySizeFitted - 1).toFixed(2));

    // Scrivi gruppi
    for (var gi=0; gi<order.length; gi++){
      var d = order[gi];
      var codesArr = groupsMap[d] || [];
      for (var ci=0; ci<codesArr.length; ci++){
        var codeStr = codesArr[ci];
        var codeRange = tf.appendText(codeStr);
        codeRange.getTextStyle().setFontFamily(font).setFontSize(bodySizeFitted).setUnderline(false).setBold(false).setForegroundColor('#000000');
        tf.appendText('\n');
      }
      var descRange = tf.appendText(d);
      descRange.getTextStyle().setFontFamily(font).setFontSize(descSizeFitted).setUnderline(false).setBold(false).setItalic(true).setForegroundColor('#000000');
      if (gi < order.length - 1){
        tf.appendText('\n');
        var spacerRange = tf.appendText(' ');
        spacerRange.getTextStyle().setFontFamily(font).setFontSize(8).setForegroundColor('#000000').setBold(false).setItalic(false).setUnderline(false);
        tf.appendText('\n');
      }
    }
  }

  // 5) Esporta PDF (Drive v3), crea file, sposta nella cartella del foglio e cestina la copia
  // salvataggio con piccolo retry per evitare errori transitori
  var _saved = false;
  for (var _i=0; _i<3; _i++){
    try { pres.saveAndClose(); _saved = true; break; } catch(e){ Utilities.sleep(500); }
  }
  if (!_saved){
    SpreadsheetApp.getUi().alert('Errore di salvataggio Slides. Riprova.');
    driveTrashFile_(copyId);
    return null;
  }
  var pdfBlob = driveExportPdf_(copyId);
  pdfBlob.setName(baseName + '.pdf');
  var pdfFile = DriveApp.createFile(pdfBlob); // crea in Root
  driveMoveToFolder_(pdfFile.getId(), targetFolderId); // sposta nella stessa cartella del foglio, se esiste
  driveTrashFile_(copyId); // cestina la presentazione temporanea
  return pdfFile;
}

function buildSlidesA4GridPdf_(templateId, scaffoldFilter){
  // 1) Leggi dati dal foglio "Per codice" (ordinato per codice crescente)
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName('Per codice');
  if (!sh){
    SpreadsheetApp.getUi().alert('Errore: Foglio "Per codice" non trovato!');
    return null;
  }
  var last = sh.getLastRow();
  if (last < 2){ SpreadsheetApp.getUi().alert('Nessun dato.'); return null; }
  var data = sh.getRange(2,1,last-1,3).getValues(); // A=codice, B=descrizione, C=scaffale
  var byShelf = {};
  for (var r=0; r<data.length; r++){
    var code = (data[r][0]||'').toString().trim();
    var desc = (data[r][1]||'').toString().trim();
    var shelf = (data[r][2]||'').toString().trim().toUpperCase();
    if (!shelf) continue;
    if (!code && !desc) continue;
    if (scaffoldFilter && scaffoldFilter.indexOf(shelf) === -1) continue;
    if (!byShelf[shelf]) byShelf[shelf] = [];
    byShelf[shelf].push({code:code, desc:desc});
  }
  var shelves = Object.keys(byShelf).sort(function(a,b){ return a.localeCompare(b,'it'); });
  if (shelves.length === 0){ SpreadsheetApp.getUi().alert('Nessuno scaffale trovato con questi criteri.'); return null; }

  // 2) Verifica che il template A4 sia configurato
  if (templateId === 'INSERISCI_QUI_ID_TEMPLATE_A4'){
    SpreadsheetApp.getUi().alert(
      'Template A4 non configurato',
      'Per usare la versione A4 griglia:\n\n' +
      '1. Crea una presentazione Google Slides vuota\n' +
      '2. File → Imposta pagina → Personalizzato → 21 × 29.7 cm\n' +
      '3. Salva e copia l\'ID dalla URL\n' +
      '4. Incolla l\'ID nella riga 10 di cartellini.gs (SLIDES_TEMPLATE_A4_ID)',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return null;
  }

  // 3) Copia template A4 e apri Slides
  var ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HH-mm-ss');
  var baseName = 'Cartellini_A4_Grid_' + ts;
  var targetFolderId = getSpreadsheetParentFolderId_();
  var copyId = driveCopyFile_(templateId, baseName, targetFolderId);
  Utilities.sleep(1000);
  var pres = openSlidesWithRetry_(copyId);
  if (!pres){
    SpreadsheetApp.getUi().alert('Slides non disponibile al momento. Riprova fra qualche secondo.');
    driveTrashFile_(copyId);
    return null;
  }

  // 4) Misure e configurazione
  var PT_PER_CM = 28.3464567;
  var PAGE_W = 21 * PT_PER_CM;     // A4 width
  var PAGE_H = 29.7 * PT_PER_CM;   // A4 height

  // Rimuovi slide vuota del template
  var slides = pres.getSlides();
  if (slides.length > 0){
    slides[0].remove();
  }
  var CARD_W = 6 * PT_PER_CM;      // 6 cm
  var CARD_H = 9 * PT_PER_CM;      // 9 cm
  var GRID_W = CARD_W * 3;         // 18 cm
  var GRID_H = CARD_H * 3;         // 27 cm
  var MARGIN_X = (PAGE_W - GRID_W) / 2; // 1.5 cm
  var MARGIN_Y = (PAGE_H - GRID_H) / 2; // 1.35 cm
  var CARD_MARGIN = 0.3 * PT_PER_CM; // margine interno cartellino 3 mm
  var font = 'Roboto';
  var titleSize = 11;
  var baseBodySize = 11;
  var CROSSHAIR_SIZE = 10; // lunghezza crocino in pt
  var CROSSHAIR_WIDTH = 0.5; // spessore linea

  // 5) Dividi scaffali in gruppi di 9 (griglia 3×3)
  var groups = [];
  for (var i=0; i<shelves.length; i+=9){
    groups.push(shelves.slice(i, Math.min(i+9, shelves.length)));
  }

  // 6) Genera una slide A4 per ogni gruppo di 9 scaffali
  for (var g=0; g<groups.length; g++){
    var group = groups[g];
    var slide = pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);

    // Disegna crocini di taglio (griglia 4×4 inclusi i 4 angoli esterni)
    var crosshairColor = '#999999';
    for (var row=0; row<4; row++){
      for (var col=0; col<4; col++){
        var crossX = MARGIN_X + col * CARD_W;
        var crossY = MARGIN_Y + row * CARD_H;

        // Linea orizzontale del crocino
        var hLine = slide.insertLine(
          SlidesApp.LineCategory.STRAIGHT,
          crossX - CROSSHAIR_SIZE/2, crossY,
          crossX + CROSSHAIR_SIZE/2, crossY
        );
        hLine.setWeight(CROSSHAIR_WIDTH);
        hLine.getLineFill().setSolidFill(crosshairColor);

        // Linea verticale del crocino
        var vLine = slide.insertLine(
          SlidesApp.LineCategory.STRAIGHT,
          crossX, crossY - CROSSHAIR_SIZE/2,
          crossX, crossY + CROSSHAIR_SIZE/2
        );
        vLine.setWeight(CROSSHAIR_WIDTH);
        vLine.getLineFill().setSolidFill(crosshairColor);
      }
    }

    // Disegna i 9 cartellini (o meno se ultimo gruppo)
    for (var idx=0; idx<group.length; idx++){
      var shelf = group[idx];
      var col = idx % 3;
      var row = Math.floor(idx / 3);

      var cardX = MARGIN_X + col * CARD_W;
      var cardY = MARGIN_Y + row * CARD_H;

      // TITLE BOX (ridotta all'80% e centrata)
      var TITLE_BOX_H = 30;
      var INSET_FIX_PT = 6;
      var BOX_WIDTH_PERCENT = 0.8; // 80% della larghezza cartellino (~4.8 cm)
      var titleBoxWidth = CARD_W * BOX_WIDTH_PERCENT;
      var titleOffsetX = (CARD_W - titleBoxWidth) / 2; // centra la box

      var titleTb = slide.insertTextBox('', cardX + titleOffsetX, cardY + CARD_MARGIN, titleBoxWidth, TITLE_BOX_H);
      titleTb.setLeft(cardX + titleOffsetX - INSET_FIX_PT);
      titleTb.setTop(cardY + CARD_MARGIN - INSET_FIX_PT);
      titleTb.setWidth(titleBoxWidth + 2*INSET_FIX_PT);
      titleTb.setHeight(TITLE_BOX_H + 2*INSET_FIX_PT);
      try { titleTb.getLine().setWeight(0); titleTb.getLine().getLineFill().setTransparent(); } catch(e) {}
      var titleTf = titleTb.getText();
      titleTf.setText('');
      var titleRange = titleTf.appendText(shelf);
      titleRange.getTextStyle().setBold(true).setUnderline(true).setFontFamily(font).setFontSize(titleSize).setForegroundColor('#000000');
      titleTf.appendText('\n');
      var titleSpacer = titleTf.appendText(' ');
      titleSpacer.getTextStyle().setFontFamily(font).setFontSize(8).setForegroundColor('#000000').setBold(false).setItalic(false).setUnderline(false);

      // CONTENT BOX (ridotta all'80% e centrata)
      var contentTop = cardY + CARD_MARGIN + TITLE_BOX_H;
      var contentHeight = CARD_H - 2*CARD_MARGIN - TITLE_BOX_H;
      var contentBoxWidth = CARD_W * BOX_WIDTH_PERCENT;
      var contentOffsetX = (CARD_W - contentBoxWidth) / 2; // centra la box

      var contentTb = slide.insertTextBox('', cardX + contentOffsetX, contentTop, contentBoxWidth, contentHeight);
      contentTb.setLeft(cardX + contentOffsetX - INSET_FIX_PT);
      contentTb.setTop(contentTop - INSET_FIX_PT);
      contentTb.setWidth(contentBoxWidth + 2*INSET_FIX_PT);
      contentTb.setHeight(contentHeight + 2*INSET_FIX_PT);
      try { contentTb.getLine().setWeight(0); contentTb.getLine().getLineFill().setTransparent(); } catch(e) {}
      var tf = contentTb.getText();
      tf.setText('');

      // Raggruppa per descrizione
      var items = byShelf[shelf] || [];
      var groupsMap = {};
      var order = [];
      for (var ii=0; ii<items.length; ii++){
        var code = (items[ii].code||'').toString();
        var desc = (items[ii].desc||'').toString();
        if (!groupsMap.hasOwnProperty(desc)){ groupsMap[desc] = []; order.push(desc); }
        groupsMap[desc].push(code);
      }

      // Auto-fitting dimensione font
      var nCodes = 0; for (var k in groupsMap){ if (groupsMap.hasOwnProperty(k)) nCodes += groupsMap[k].length; }
      var nDescs = order.length;
      var nSpacers = Math.max(0, order.length - 1);
      var contentHeightPt = contentHeight;
      var LINE_FACTOR = 1.24;
      var minBody = 7.5;
      var step = 0.1;
      function totalHeightEstimate(bodySize){
        var descSize = Math.max(minBody - 1, bodySize - 1);
        var codesHeight = nCodes * bodySize * LINE_FACTOR;
        var descsHeight = nDescs * descSize * LINE_FACTOR;
        var spacersHeight = nSpacers * 9;
        return codesHeight + descsHeight + spacersHeight;
      }
      var bodySizeFitted = baseBodySize;
      while (totalHeightEstimate(bodySizeFitted) > contentHeightPt && bodySizeFitted > minBody){
        bodySizeFitted = Math.max(minBody, +(bodySizeFitted - step).toFixed(2));
      }
      var descSizeFitted = Math.max(minBody - 1, +(bodySizeFitted - 1).toFixed(2));

      // Scrivi gruppi
      for (var gi=0; gi<order.length; gi++){
        var d = order[gi];
        var codesArr = groupsMap[d] || [];
        for (var ci=0; ci<codesArr.length; ci++){
          var codeStr = codesArr[ci];
          var codeRange = tf.appendText(codeStr);
          codeRange.getTextStyle().setFontFamily(font).setFontSize(bodySizeFitted).setUnderline(false).setBold(false).setForegroundColor('#000000');
          tf.appendText('\n');
        }
        var descRange = tf.appendText(d);
        descRange.getTextStyle().setFontFamily(font).setFontSize(descSizeFitted).setUnderline(false).setBold(false).setItalic(true).setForegroundColor('#000000');
        if (gi < order.length - 1){
          tf.appendText('\n');
          var spacerRange = tf.appendText(' ');
          spacerRange.getTextStyle().setFontFamily(font).setFontSize(8).setForegroundColor('#000000').setBold(false).setItalic(false).setUnderline(false);
          tf.appendText('\n');
        }
      }
    }
  }

  // 7) Esporta PDF
  var _saved = false;
  for (var _i=0; _i<3; _i++){
    try { pres.saveAndClose(); _saved = true; break; } catch(e){ Utilities.sleep(500); }
  }
  if (!_saved){
    SpreadsheetApp.getUi().alert('Errore di salvataggio Slides. Riprova.');
    driveTrashFile_(copyId);
    return null;
  }
  var pdfBlob = driveExportPdf_(copyId);
  pdfBlob.setName(baseName + '.pdf');
  var pdfFile = DriveApp.createFile(pdfBlob);
  driveMoveToFolder_(pdfFile.getId(), targetFolderId);
  driveTrashFile_(copyId);
  return pdfFile;
}

// ===== SISTEMA TRACCIAMENTO STAMPE =====

/**
 * Inizializza o aggiorna il foglio "Stato Stampe"
 * Struttura: Scaffale | Ultima Stampa | Ultima Modifica | Da Stampare
 */
function initStatoStampe_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Stato Stampe');

  // Crea foglio se non esiste
  if (!sheet) {
    sheet = ss.insertSheet('Stato Stampe');
    sheet.appendRow(['Scaffale', 'Ultima Stampa', 'Ultima Modifica', 'Da Stampare']);
    sheet.getRange('A1:D1').setFontWeight('bold').setBackground('#f3f3f3');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 100);
    sheet.setColumnWidth(2, 180);
    sheet.setColumnWidth(3, 180);
    sheet.setColumnWidth(4, 120);
  }

  // Leggi tutti gli scaffali dal foglio "Per codice"
  var dataSheet = ss.getSheetByName('Per codice');
  if (!dataSheet) return;

  var lastRow = dataSheet.getLastRow();
  if (lastRow < 2) return;

  var data = dataSheet.getRange(2, 3, lastRow - 1, 1).getValues(); // Colonna C = Scaffale
  var scaffaliEsistenti = {};

  for (var i = 0; i < data.length; i++) {
    var scaffale = (data[i][0] || '').toString().trim().toUpperCase();
    if (scaffale) scaffaliEsistenti[scaffale] = true;
  }

  // Leggi scaffali già tracciati
  var statoData = sheet.getDataRange().getValues();
  var trackedScaffali = {};

  for (var j = 1; j < statoData.length; j++) {
    var s = statoData[j][0];
    if (s) trackedScaffali[s] = true;
  }

  // Aggiungi nuovi scaffali non ancora tracciati
  var now = new Date();
  for (var scaffale in scaffaliEsistenti) {
    if (!trackedScaffali.hasOwnProperty(scaffale)) {
      sheet.appendRow([scaffale, '', now, 'SI']);
    }
  }

  // Ordina tutti gli scaffali alfabeticamente (A-Z)
  if (sheet.getLastRow() > 1) {
    var range = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4);
    range.sort({column: 1, ascending: true});
  }

  return sheet;
}

/**
 * Ritorna lista scaffali con modifiche non stampate
 */
function getScaffaliDaStampare_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Stato Stampe');

  if (!sheet) {
    initStatoStampe_();
    sheet = ss.getSheetByName('Stato Stampe');
    if (!sheet) return [];
  }

  var data = sheet.getDataRange().getValues();
  var daStampare = [];

  for (var i = 1; i < data.length; i++) {
    var scaffale = data[i][0];
    var flag = data[i][3]; // Colonna D: Da Stampare

    if (flag === 'SI' || flag === true) {
      daStampare.push(scaffale);
    }
  }

  return daStampare.sort(function(a, b) { return a.localeCompare(b, 'it'); });
}

/**
 * Marca scaffali come stampati
 * Rimuove evidenziazione rossa
 */
function marcaScaffaliStampati_(scaffali) {
  if (!scaffali || scaffali.length === 0) return;

  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Stato Stampe');
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var scaffaliSet = {};

  for (var i = 0; i < scaffali.length; i++) {
    scaffaliSet[scaffali[i]] = true;
  }

  for (var j = 1; j < data.length; j++) {
    var scaffale = data[j][0];
    if (scaffaliSet.hasOwnProperty(scaffale)) {
      var rowNum = j + 1;

      // Aggiorna valori
      sheet.getRange(rowNum, 2).setValue(now); // Ultima Stampa
      sheet.getRange(rowNum, 4).setValue('NO'); // Da Stampare = NO

      // Rimuovi evidenziazione rossa (sfondo bianco)
      sheet.getRange(rowNum, 3).setBackground('#ffffff');
      sheet.getRange(rowNum, 4).setBackground('#ffffff').setFontWeight('normal');
    }
  }
}

/**
 * Aggiorna timestamp modifica per uno scaffale
 * Evidenzia in rosso le colonne C e D quando marca come modificato
 */
function aggiornaModificaScaffale_(scaffale) {
  if (!scaffale) return;

  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Stato Stampe');

  if (!sheet) {
    initStatoStampe_();
    sheet = ss.getSheetByName('Stato Stampe');
  }
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var found = false;

  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === scaffale) {
      var rowNum = i + 1;

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
    var lastRow = sheet.getLastRow();

    // Evidenzia in rosso la nuova riga (colonne C e D)
    sheet.getRange(lastRow, 3).setBackground('#ffcccc');
    sheet.getRange(lastRow, 4).setBackground('#ffcccc').setFontWeight('bold');

    // Riordina automaticamente dopo aver aggiunto nuovo scaffale
    if (lastRow > 2) {
      var range = sheet.getRange(2, 1, lastRow - 1, 4);
      range.sort({column: 1, ascending: true});
    }
  }
}

/**
 * Trigger automatico modifiche manuali
 * Traccia modifiche a QUALSIASI colonna (Codice, Descrizione, Scaffale)
 */
function onEdit(e) {
  try {
    var sheet = e.source.getActiveSheet();
    var sheetName = sheet.getName();

    // Traccia solo modifiche ai fogli Magazzino o "Per codice"
    if (sheetName !== 'Magazzino' && sheetName !== 'Per codice') return;

    var range = e.range;
    var row = range.getRow();

    // Ignora header
    if (row < 2) return;

    // Prendi lo scaffale dalla colonna C della riga modificata
    var scaffaleCell = sheet.getRange(row, 3);
    var scaffale = (scaffaleCell.getValue() || '').toString().trim().toUpperCase();

    if (scaffale) {
      aggiornaModificaScaffale_(scaffale);
    }
  } catch(error) {
    // Ignora errori silenziosamente per non bloccare edit
  }
}
