/**
 * CacheManager - Gestione centralizzata cache localStorage per PWA
 * Elettromeccanica Maranzan
 *
 * Gestisce cache per:
 * - riparazioni: lista completa riparazioni
 * - clienti: lista clienti per autocomplete
 * - magazzino: lista ricambi da CSV
 */

class CacheManager {
  constructor() {
    this.prefix = 'em_cache_';
    this.version = 'v1';

    // Durata cache per ogni tipo di dato (in millisecondi)
    this.durations = {
      riparazioni: 15 * 60 * 1000,     // 15 minuti (sessioni lavoro più lunghe)
      clienti: 10 * 60 * 1000,         // 10 minuti (dati stabili)
      magazzino: 30 * 60 * 1000        // 30 minuti (uso intensivo ripetuto)
    };
  }

  /**
   * Genera chiave localStorage per un tipo di cache
   */
  _getKey(cacheKey) {
    return `${this.prefix}${this.version}_${cacheKey}`;
  }

  /**
   * Genera chiave timestamp per un tipo di cache
   */
  _getTimestampKey(cacheKey) {
    return `${this.prefix}${this.version}_${cacheKey}_timestamp`;
  }

  /**
   * Ottiene dati dalla cache se validi
   * @param {string} cacheKey - Tipo di cache ('riparazioni', 'clienti', 'magazzino')
   * @returns {any|null} - Dati cachati o null se cache invalida/assente
   */
  get(cacheKey) {
    try {
      const key = this._getKey(cacheKey);
      const timestampKey = this._getTimestampKey(cacheKey);

      const cached = localStorage.getItem(key);
      const timestamp = localStorage.getItem(timestampKey);

      if (!cached || !timestamp) {
        console.log(`[CacheManager] Cache '${cacheKey}' non trovata`);
        return null;
      }

      // Controlla se cache è scaduta
      const age = Date.now() - parseInt(timestamp);
      const duration = this.durations[cacheKey] || 5 * 60 * 1000;

      if (age > duration) {
        console.log(`[CacheManager] Cache '${cacheKey}' scaduta (age: ${Math.round(age / 1000)}s)`);
        this.invalidate(cacheKey);
        return null;
      }

      console.log(`[CacheManager] Cache '${cacheKey}' valida (age: ${Math.round(age / 1000)}s)`);
      return JSON.parse(cached);
    } catch (e) {
      console.error(`[CacheManager] Errore lettura cache '${cacheKey}':`, e);
      return null;
    }
  }

  /**
   * Salva dati in cache
   * @param {string} cacheKey - Tipo di cache ('riparazioni', 'clienti', 'magazzino')
   * @param {any} data - Dati da cachare
   */
  set(cacheKey, data) {
    try {
      const key = this._getKey(cacheKey);
      const timestampKey = this._getTimestampKey(cacheKey);

      localStorage.setItem(key, JSON.stringify(data));
      localStorage.setItem(timestampKey, Date.now().toString());

      console.log(`[CacheManager] Cache '${cacheKey}' salvata (${JSON.stringify(data).length} bytes)`);
    } catch (e) {
      console.error(`[CacheManager] Errore scrittura cache '${cacheKey}':`, e);
    }
  }

  /**
   * Invalida (rimuove) una cache specifica
   * @param {string} cacheKey - Tipo di cache da invalidare
   */
  invalidate(cacheKey) {
    try {
      const key = this._getKey(cacheKey);
      const timestampKey = this._getTimestampKey(cacheKey);

      localStorage.removeItem(key);
      localStorage.removeItem(timestampKey);

      console.log(`[CacheManager] Cache '${cacheKey}' invalidata`);
    } catch (e) {
      console.error(`[CacheManager] Errore invalidazione cache '${cacheKey}':`, e);
    }
  }

  /**
   * Invalida tutte le cache gestite
   */
  invalidateAll() {
    console.log('[CacheManager] Invalidazione completa cache...');
    Object.keys(this.durations).forEach(key => {
      this.invalidate(key);
    });
  }

  /**
   * Ottiene info su tutte le cache (per debug)
   */
  getStats() {
    const stats = {};

    Object.keys(this.durations).forEach(cacheKey => {
      const key = this._getKey(cacheKey);
      const timestampKey = this._getTimestampKey(cacheKey);

      const cached = localStorage.getItem(key);
      const timestamp = localStorage.getItem(timestampKey);

      if (cached && timestamp) {
        const age = Date.now() - parseInt(timestamp);
        const duration = this.durations[cacheKey];
        const isValid = age <= duration;

        stats[cacheKey] = {
          size: cached.length,
          age: Math.round(age / 1000),
          maxAge: Math.round(duration / 1000),
          valid: isValid
        };
      } else {
        stats[cacheKey] = { empty: true };
      }
    });

    return stats;
  }
}

// Esporta istanza singleton
const cacheManager = new CacheManager();

// Esponi globalmente per debug console
if (typeof window !== 'undefined') {
  window.cacheManager = cacheManager;
}
