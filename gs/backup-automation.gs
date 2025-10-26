/**
 * BACKUP AUTOMATION - Elettromeccanica Maranzan
 *
 * Script per backup automatico settimanale dei fogli Google Sheets
 * Trigger consigliato: Domenica 03:00-04:00
 * Mantiene: Ultimi 4 backup (1 mese)
 */

// ===== CONFIGURAZIONE =====
const MAGAZZINO_ID = '1wFamrwzFNNz5iHenqVpdAHb5Dhvv5xYx5XPimjax9As';
const RIPARAZIONI_ID = '122xQdmQb02UH6evZE382t0s6oRDIoiOhF5cYAAmEvY0';
const BACKUP_FOLDER_ID = '1TMA05bPaRX5wHKarBFnf5cGx6X8D6MWF'; // Cartella "Backup EM Maranzan"

// Numero di backup da mantenere per ogni foglio
const KEEP_LAST_N_BACKUPS = 4;

/**
 * Funzione principale - Esegue backup settimanale
 */
function backupWeekly() {
  try {
    // Verifica configurazione
    if (BACKUP_FOLDER_ID === 'INSERISCI_QUI_ID_CARTELLA_BACKUP') {
      Logger.log('❌ ERRORE: Configura BACKUP_FOLDER_ID prima di eseguire lo script');
      return;
    }

    const backupFolder = DriveApp.getFolderById(BACKUP_FOLDER_ID);
    const timestamp = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd_HHmm');

    Logger.log(`🔄 Inizio backup settimanale: ${timestamp}`);

    // Backup Magazzino
    const magazzinoFile = DriveApp.getFileById(MAGAZZINO_ID);
    const magazzinoBackup = magazzinoFile.makeCopy(
      `Magazzino_${timestamp}`,
      backupFolder
    );
    Logger.log(`✅ Backup Magazzino creato: ${magazzinoBackup.getName()}`);

    // Backup Riparazioni
    const riparazioniFile = DriveApp.getFileById(RIPARAZIONI_ID);
    const riparazioniBackup = riparazioniFile.makeCopy(
      `Riparazioni_${timestamp}`,
      backupFolder
    );
    Logger.log(`✅ Backup Riparazioni creato: ${riparazioniBackup.getName()}`);

    // Pulizia backup vecchi
    cleanOldBackups(backupFolder, 'Magazzino_', KEEP_LAST_N_BACKUPS);
    cleanOldBackups(backupFolder, 'Riparazioni_', KEEP_LAST_N_BACKUPS);

    Logger.log(`✅ Backup completato con successo`);

  } catch (error) {
    Logger.log(`❌ ERRORE durante backup: ${error.toString()}`);
  }
}

/**
 * Pulisce backup vecchi mantenendo solo gli ultimi N
 * SICURO: Elimina SOLO file che iniziano con il prefix specificato
 */
function cleanOldBackups(folder, prefix, keepLast) {
  const backupFiles = [];

  // Raccogli tutti i file con il prefisso specificato
  const iterator = folder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    if (file.getName().startsWith(prefix)) {
      backupFiles.push({
        file: file,
        date: file.getDateCreated(),
        name: file.getName()
      });
    }
  }

  // Ordina per data decrescente (più recenti prima)
  backupFiles.sort((a, b) => b.date - a.date);

  // Elimina quelli oltre keepLast
  let deletedCount = 0;
  for (let i = keepLast; i < backupFiles.length; i++) {
    backupFiles[i].file.setTrashed(true);
    deletedCount++;
    Logger.log(`🗑️  Eliminato backup vecchio: ${backupFiles[i].name}`);
  }

  if (deletedCount > 0) {
    Logger.log(`✅ Puliti ${deletedCount} backup vecchi con prefisso "${prefix}"`);
  }
}

/**
 * Funzione di test - Esegui manualmente per verificare funzionamento
 */
function testBackup() {
  Logger.log('🧪 Esecuzione test backup...');
  backupWeekly();
  Logger.log('🧪 Test completato - Controlla i log sopra');
}

/**
 * Lista tutti i backup esistenti (utility)
 */
function listBackups() {
  if (BACKUP_FOLDER_ID === 'INSERISCI_QUI_ID_CARTELLA_BACKUP') {
    Logger.log('❌ Configura BACKUP_FOLDER_ID prima');
    return;
  }

  const folder = DriveApp.getFolderById(BACKUP_FOLDER_ID);
  const files = folder.getFiles();

  Logger.log('📋 Backup esistenti:');
  let count = 0;

  while (files.hasNext()) {
    const file = files.next();
    const created = Utilities.formatDate(file.getDateCreated(), 'Europe/Rome', 'yyyy-MM-dd HH:mm');
    Logger.log(`  - ${file.getName()} (${created})`);
    count++;
  }

  Logger.log(`\nTotale: ${count} backup`);
}
