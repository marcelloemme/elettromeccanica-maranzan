# Prompt per riprendere la migrazione Cloudflare

Copia e incolla questo messaggio quando riapri la chat con Claude:

---

Ciao Claude, riprendiamo il progetto Elettromeccanica Maranzan. Dobbiamo implementare la migrazione da Google Apps Script a Cloudflare Workers + D1.

**Leggi questi file per il contesto:**
1. `.claude.md` - contiene la roadmap completa nella sezione "ROADMAP: Migrazione a Cloudflare Workers + D1"
2. `gs/riparazioni.gs` - API attuale riparazioni (da replicare in Worker)
3. `gs/magazzino.gs` - API attuale magazzino (da replicare in Worker)

**Stato attuale:**
- Backend: Google Apps Script che legge/scrive su Google Sheets
- Il sito PWA chiama questi endpoint (vedi `API_URL` in `js/riparazioni-*.js` e `js/magazzino-*.js`)
- Il firmware T4 (`hardware/t4-printer/src/main.cpp`) fa polling ogni 2.2s sulla cella M1 per rilevare nuove schede

**Obiettivo migrazione:**
- Cloudflare Workers + D1 come backend primario (latenza 10-50ms vs 200-500ms)
- Google Sheets resta come "admin UI" per modifiche manuali
- Sync bidirezionale: D1 → Sheets (ogni 30-60s) e Sheets → D1 (trigger onEdit)
- Polling T4 ridotto a 300-500ms (stampa quasi istantanea)

**Struttura file da creare:**
```
/cloudflare/
├── wrangler.toml
├── src/
│   ├── index.ts
│   ├── routes/ (riparazioni.ts, magazzino.ts, clienti.ts, poll.ts)
│   ├── db/schema.sql
│   └── sync/ (to-sheets.ts, from-sheets.ts)
```

**Endpoint da implementare:**
- Riparazioni: GET/POST /api/riparazioni, GET /api/riparazioni/:numero, PATCH, /complete, /next-numero
- Magazzino: GET/POST/PATCH/DELETE /api/ricambi, POST /api/ricambi/batch
- Clienti: GET /api/clienti
- Polling: GET /api/poll?ts=xxx (per T4)
- Sync: POST /api/sync/from-sheets (webhook da Sheets)

**Fasi da seguire:**
1. Setup Cloudflare (wrangler, D1 database)
2. Implementa endpoint riparazioni
3. Implementa endpoint magazzino
4. Implementa sync bidirezionale
5. Aggiorna firmware T4
6. Cleanup

Iniziamo dalla Fase 1: setup infrastruttura Cloudflare.
