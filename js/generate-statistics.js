#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Leggi CSV (nella root del progetto durante GitHub Action)
const csvPath = path.join(process.cwd(), 'riparazioni.csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');

// Parse CSV
const lines = csvContent.trim().split('\n');
const headers = lines[0].split(',');
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

const today = new Date();
const isSaturday = today.getDay() === 6;

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

const recapAttuale = {
  totaleInCorso: riparazioniInCorso.length,
  oltre90gg: oltre90gg.length > 0 ? oltre90gg : null,
  top3Vecchie: oltre90gg.length > 0 ? null : top3
};

// 2. RECAP SETTIMANALE (solo sabato)
let recapSettimanale = null;
if (isSaturday) {
  // Calcola settimana corrente (lun-dom)
  const startWeek = new Date(today);
  startWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Lunedì
  startWeek.setHours(0, 0, 0, 0);

  const endWeek = new Date(startWeek);
  endWeek.setDate(startWeek.getDate() + 6); // Domenica
  endWeek.setHours(23, 59, 59, 999);

  const inseriteSettimana = riparazioni.filter(r => {
    const data = parseDate(r['Data consegna']);
    return data && data >= startWeek && data <= endWeek;
  }).length;

  const completateSettimana = riparazioni.filter(r => {
    const data = parseDate(r['Data completamento']);
    return data && data >= startWeek && data <= endWeek;
  }).length;

  // Media ultimi 6 mesi (26 settimane)
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(today.getMonth() - 6);

  const riparazioniUltimi6Mesi = riparazioni.filter(r => {
    const data = parseDate(r['Data consegna']);
    return data && data >= sixMonthsAgo;
  });

  const completateUltimi6Mesi = riparazioni.filter(r => {
    const data = parseDate(r['Data completamento']);
    return data && data >= sixMonthsAgo;
  });

  const mediaInseriteSettimana = riparazioniUltimi6Mesi.length / 26;
  const mediaCompletateSettimana = completateUltimi6Mesi.length / 26;

  const percInserite = ((inseriteSettimana - mediaInseriteSettimana) / mediaInseriteSettimana * 100).toFixed(1);
  const percCompletate = ((completateSettimana - mediaCompletateSettimana) / mediaCompletateSettimana * 100).toFixed(1);

  recapSettimanale = {
    settimana: `${startWeek.getDate().toString().padStart(2, '0')}.${(startWeek.getMonth() + 1).toString().padStart(2, '0')}-${endWeek.getDate().toString().padStart(2, '0')}.${(endWeek.getMonth() + 1).toString().padStart(2, '0')}`,
    inserite: inseriteSettimana,
    completate: completateSettimana,
    percInserite: parseFloat(percInserite),
    percCompletate: parseFloat(percCompletate),
    mediaInserite: mediaInseriteSettimana.toFixed(1),
    mediaCompletate: mediaCompletateSettimana.toFixed(1)
  };
}

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

// Salva JSON
const output = {
  generatedAt: today.toISOString(),
  recapAttuale,
  recapSettimanale,
  tempiRiparazione,
  grafici,
  anniDisponibili
};

const outputPath = path.join(__dirname, 'statistiche.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log('✓ Statistiche generate con successo!');
console.log(`- Riparazioni totali: ${riparazioni.length}`);
console.log(`- In corso: ${riparazioniInCorso.length}`);
console.log(`- Anni disponibili: ${anniDisponibili.join(', ')}`);
if (recapSettimanale) {
  console.log(`- Recap settimanale generato (sabato)`);
}
