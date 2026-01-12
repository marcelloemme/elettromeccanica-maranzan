#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Leggi CSV (nella root del progetto durante GitHub Action)
const csvPath = path.join(process.cwd(), 'riparazioni.csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');

// Parse CSV
const lines = csvContent.trim().split('\n');

// Parse header con gestione virgolette
const headerLine = lines[0];
const headers = [];
let currentHeader = '';
let insideQuotesHeader = false;

for (let i = 0; i < headerLine.length; i++) {
  const char = headerLine[i];
  if (char === '"') {
    insideQuotesHeader = !insideQuotesHeader;
  } else if (char === ',' && !insideQuotesHeader) {
    headers.push(currentHeader.trim());
    currentHeader = '';
  } else {
    currentHeader += char;
  }
}
headers.push(currentHeader.trim()); // Ultimo header

const rows = lines.slice(1).map(line => {
  // Parse CSV con gestione virgolette per campi JSON
  const values = [];
  let currentValue = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      values.push(currentValue);
      currentValue = '';
    } else {
      currentValue += char;
    }
  }
  values.push(currentValue); // Ultimo valore

  const obj = {};
  headers.forEach((header, i) => {
    obj[header] = values[i] || '';
  });
  return obj;
});

// Funzioni helper
const parseDate = (dateStr) => {
  if (!dateStr) return null;
  return new Date(dateStr);
};

const formatDataIT = (date) => {
  if (!date) return '-';
  const d = new Date(date);
  const giorno = String(d.getDate()).padStart(2, '0');
  const mese = String(d.getMonth() + 1).padStart(2, '0');
  const anno = d.getFullYear();
  return `${giorno}/${mese}/${anno}`;
};

const today = new Date();
const dayOfWeek = today.getDay(); // 0=domenica, 1=lunedì, ..., 6=sabato
const hour = today.getHours();

// Filtra riparazioni
const riparazioni = rows.filter(r => r.Numero);

// 1. RECAP ATTUALE
const riparazioniInCorso = riparazioni.filter(r => r.Completato !== 'TRUE');
const inCorsoOrdinate = riparazioniInCorso
  .map(r => ({
    numero: r.Numero,
    cliente: r.Cliente,
    dataConsegna: parseDate(r['Data consegna']),
    giorniAperti: Math.floor((today - parseDate(r['Data consegna'])) / (1000 * 60 * 60 * 24))
  }))
  .filter(r => r.dataConsegna)
  .sort((a, b) => a.dataConsegna - b.dataConsegna);

const oltre90gg = inCorsoOrdinate.filter(r => r.giorniAperti > 90);
const top3 = inCorsoOrdinate.slice(0, 3);

// Genera testo notifica per shortcut iOS
let testoNotifica = `Al momento hai ${riparazioniInCorso.length} riparazioni attive.`;
if (oltre90gg.length > 0) {
  const elenco = oltre90gg.map((r, i) => {
    const sep = i === oltre90gg.length - 1 ? '.' : ';';
    return `- ${r.numero} - ${r.cliente} del ${formatDataIT(r.dataConsegna)}${sep}`;
  }).join('\n');
  testoNotifica += ` Le riparazioni aperte da oltre 90 giorni sono:\n${elenco}`;
} else if (top3.length > 0) {
  const elenco = top3.map((r, i) => {
    const sep = i === top3.length - 1 ? '.' : ';';
    return `- ${r.numero} - ${r.cliente} del ${formatDataIT(r.dataConsegna)}${sep}`;
  }).join('\n');
  testoNotifica += ` Le tre più vecchie sono:\n${elenco}`;
}

const recapAttuale = {
  totaleInCorso: riparazioniInCorso.length,
  oltre90gg: oltre90gg.length > 0 ? oltre90gg : null,
  top3Vecchie: oltre90gg.length > 0 ? null : top3,
  testoNotifica
};

// 2. RECAP SETTIMANALE (sempre visibile)
// Determina se mostrare settimana corrente o scorsa
const mostraSettimanaCorrente = (dayOfWeek === 6 && hour >= 17) || dayOfWeek === 0; // Sabato dopo 17:30 o Domenica

let startWeek, endWeek, prefisso;
if (mostraSettimanaCorrente) {
  // Settimana corrente (lun-dom)
  startWeek = new Date(today);
  startWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Lunedì corrente
  startWeek.setHours(0, 0, 0, 0);

  endWeek = new Date(startWeek);
  endWeek.setDate(startWeek.getDate() + 6); // Domenica corrente
  endWeek.setHours(23, 59, 59, 999);

  prefisso = 'Questa settimana';
} else {
  // Settimana scorsa (lun-dom)
  const lunediCorrente = new Date(today);
  lunediCorrente.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  startWeek = new Date(lunediCorrente);
  startWeek.setDate(lunediCorrente.getDate() - 7); // Lunedì settimana scorsa
  startWeek.setHours(0, 0, 0, 0);

  endWeek = new Date(startWeek);
  endWeek.setDate(startWeek.getDate() + 6); // Domenica settimana scorsa
  endWeek.setHours(23, 59, 59, 999);

  prefisso = 'Settimana scorsa';
}

const inseriteSettimana = riparazioni.filter(r => {
  const data = parseDate(r['Data consegna']);
  return data && data >= startWeek && data <= endWeek;
}).length;

const completateSettimana = riparazioni.filter(r => {
  const data = parseDate(r['Data completamento']);
  return data && data >= startWeek && data <= endWeek;
}).length;

// Media ultimi 6 mesi (ma non prima delle date storiche)
const sixMonthsAgo = new Date(today);
sixMonthsAgo.setMonth(today.getMonth() - 6);

const dataInizioInseritiStorico = new Date('2025-10-27'); // Primo lunedì con dati inserimenti
const dataInizioCompletatiStorico = new Date('2026-01-12'); // Primo lunedì con data completamento salvata

const dataInizioCalcoloInseriti = sixMonthsAgo > dataInizioInseritiStorico ? sixMonthsAgo : dataInizioInseritiStorico;
const dataInizioCalcoloCompletati = sixMonthsAgo > dataInizioCompletatiStorico ? sixMonthsAgo : dataInizioCompletatiStorico;

const riparazioniPeriodo = riparazioni.filter(r => {
  const data = parseDate(r['Data consegna']);
  return data && data >= dataInizioCalcoloInseriti;
});

const completatePeriodo = riparazioni.filter(r => {
  const data = parseDate(r['Data completamento']);
  return data && data >= dataInizioCalcoloCompletati;
});

// Calcola numero di settimane complete per ogni periodo
const giorniPeriodoInseriti = Math.floor((today - dataInizioCalcoloInseriti) / (1000 * 60 * 60 * 24));
const settimaneCalcoloInseriti = Math.max(1, giorniPeriodoInseriti / 7);

const giorniPeriodoCompletati = Math.floor((today - dataInizioCalcoloCompletati) / (1000 * 60 * 60 * 24));
const settimaneCalcoloCompletati = Math.max(1, giorniPeriodoCompletati / 7);

const mediaInseriteSettimana = riparazioniPeriodo.length / settimaneCalcoloInseriti;
const mediaCompletateSettimana = completatePeriodo.length / settimaneCalcoloCompletati;

// Calcola percentuali (gestisce caso divisione per zero e valori molto piccoli)
let percInserite = mediaInseriteSettimana > 0
  ? ((inseriteSettimana - mediaInseriteSettimana) / mediaInseriteSettimana * 100).toFixed(1)
  : null;

let percCompletate = mediaCompletateSettimana > 0
  ? ((completateSettimana - mediaCompletateSettimana) / mediaCompletateSettimana * 100).toFixed(1)
  : null;

// Se percentuale è tra -0.5 e +0.5, considera "nella media"
if (percInserite !== null && Math.abs(parseFloat(percInserite)) < 0.5) {
  percInserite = 0;
}
if (percCompletate !== null && Math.abs(parseFloat(percCompletate)) < 0.5) {
  percCompletate = 0;
}

const recapSettimanale = {
  settimana: `${prefisso} (${startWeek.getDate().toString().padStart(2, '0')}.${(startWeek.getMonth() + 1).toString().padStart(2, '0')}-${endWeek.getDate().toString().padStart(2, '0')}.${(endWeek.getMonth() + 1).toString().padStart(2, '0')})`,
  inserite: inseriteSettimana,
  completate: completateSettimana,
  percInserite: percInserite !== null ? parseFloat(percInserite) : null,
  percCompletate: percCompletate !== null ? parseFloat(percCompletate) : null,
  mediaInserite: mediaInseriteSettimana.toFixed(1),
  mediaCompletate: mediaCompletateSettimana.toFixed(1)
};

// 3. TEMPI RIPARAZIONE (ultimi 90 giorni)
const ninetyDaysAgo = new Date(today);
ninetyDaysAgo.setDate(today.getDate() - 90);

const completateUltimi90gg = riparazioni.filter(r => {
  const dataComp = parseDate(r['Data completamento']);
  return dataComp && dataComp >= ninetyDaysAgo && r.Completato === 'TRUE';
}).map(r => {
  const dataConsegna = parseDate(r['Data consegna']);
  const dataComp = parseDate(r['Data completamento']);
  const giorni = Math.floor((dataComp - dataConsegna) / (1000 * 60 * 60 * 24));
  return {
    numero: r.Numero,
    cliente: r.Cliente,
    giorni: giorni >= 0 ? giorni : null
  };
}).filter(r => r.giorni !== null);

let tempiRiparazione = null;
if (completateUltimi90gg.length > 0) {
  const sommaGiorni = completateUltimi90gg.reduce((sum, r) => sum + r.giorni, 0);
  const mediaGiorni = Math.round(sommaGiorni / completateUltimi90gg.length);

  const ordinatiPerGiorni = [...completateUltimi90gg].sort((a, b) => a.giorni - b.giorni);
  const piuVeloce = ordinatiPerGiorni[0];
  const piuLenta = ordinatiPerGiorni[ordinatiPerGiorni.length - 1];

  const entro14 = completateUltimi90gg.filter(r => r.giorni <= 14).length;
  const entro30 = completateUltimi90gg.filter(r => r.giorni <= 30).length;
  const entro60 = completateUltimi90gg.filter(r => r.giorni <= 60).length;

  const percEntro14 = ((entro14 / completateUltimi90gg.length) * 100).toFixed(1);
  const percEntro30 = ((entro30 / completateUltimi90gg.length) * 100).toFixed(1);
  const percEntro60 = ((entro60 / completateUltimi90gg.length) * 100).toFixed(1);

  tempiRiparazione = {
    mediaGiorni,
    recordVelocita: piuVeloce,
    recordLentezza: piuLenta,
    percEntro14: parseFloat(percEntro14),
    percEntro30: parseFloat(percEntro30),
    percEntro60: parseFloat(percEntro60)
  };
}

// 4. GRAFICI MENSILI (ultimi 12 mesi per ogni anno disponibile)
const anniDisponibili = [...new Set(riparazioni.map(r => {
  const data = parseDate(r['Data consegna']);
  return data ? data.getFullYear() : null;
}).filter(Boolean))].sort((a, b) => b - a);

const grafici = {};

anniDisponibili.forEach(anno => {
  const datiAnno = { create: {}, completate: {} };

  // Inizializza tutti i mesi a 0
  for (let m = 0; m < 12; m++) {
    const mese = m + 1;
    datiAnno.create[mese] = 0;
    datiAnno.completate[mese] = 0;
  }

  // Conta create per mese
  riparazioni.forEach(r => {
    const data = parseDate(r['Data consegna']);
    if (data && data.getFullYear() === anno) {
      const mese = data.getMonth() + 1;
      datiAnno.create[mese]++;
    }
  });

  // Conta completate per mese
  riparazioni.forEach(r => {
    const data = parseDate(r['Data completamento']);
    if (data && data.getFullYear() === anno) {
      const mese = data.getMonth() + 1;
      datiAnno.completate[mese]++;
    }
  });

  grafici[anno] = datiAnno;
});

// 5. GRAFICO DELTA GIORNALIERO (dal 7 gennaio 2026)
const dataInizioDeltagiornaliero = new Date('2026-01-07');

// Crea mappa di conteggi giornalieri
const deltaGiornaliero = {};

// Conta aggiunte per giorno
riparazioni.forEach(r => {
  const data = parseDate(r['Data consegna']);
  if (data && data >= dataInizioDeltagiornaliero) {
    const dateKey = data.toISOString().split('T')[0]; // YYYY-MM-DD
    if (!deltaGiornaliero[dateKey]) {
      deltaGiornaliero[dateKey] = { aggiunte: 0, completate: 0 };
    }
    deltaGiornaliero[dateKey].aggiunte++;
  }
});

// Conta completate per giorno
riparazioni.forEach(r => {
  const data = parseDate(r['Data completamento']);

  // Debug per 26/0008
  if (r.Numero === '26/0008') {
    console.log('DEBUG 26/0008:');
    console.log('- Completato:', r.Completato);
    console.log('- Data completamento raw:', r['Data completamento']);
    console.log('- Data completamento parsed:', data);
  }

  if (data && data >= dataInizioDeltagiornaliero) {
    const dateKey = data.toISOString().split('T')[0];
    if (!deltaGiornaliero[dateKey]) {
      deltaGiornaliero[dateKey] = { aggiunte: 0, completate: 0 };
    }
    deltaGiornaliero[dateKey].completate++;
  }
});

// Filtra solo giorni con attività e calcola delta
const deltaArray = Object.keys(deltaGiornaliero)
  .filter(dateKey => {
    const d = deltaGiornaliero[dateKey];
    return d.aggiunte > 0 || d.completate > 0; // Solo giorni con attività
  })
  .map(dateKey => ({
    data: dateKey,
    aggiunte: deltaGiornaliero[dateKey].aggiunte,
    completate: deltaGiornaliero[dateKey].completate,
    delta: deltaGiornaliero[dateKey].completate - deltaGiornaliero[dateKey].aggiunte
  }))
  .sort((a, b) => a.data.localeCompare(b.data)); // Ordina per data

// Salva JSON
const output = {
  generatedAt: today.toISOString(),
  recapAttuale,
  recapSettimanale,
  tempiRiparazione,
  grafici,
  anniDisponibili,
  deltaGiornaliero: deltaArray
};

const outputPath = path.join(__dirname, 'statistiche.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log('✓ Statistiche generate con successo!');
console.log(`- Riparazioni totali: ${riparazioni.length}`);
console.log(`- In corso: ${riparazioniInCorso.length}`);
console.log(`- Anni disponibili: ${anniDisponibili.join(', ')}`);
console.log(`- Delta giornaliero: ${deltaArray.length} giorni con attività`);
if (recapSettimanale) {
  console.log(`- Recap settimanale generato (sabato)`);
}
