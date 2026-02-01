(() => {
  // API Endpoint
  const API_URL = 'https://script.google.com/macros/s/AKfycbzgXCGMef3UX9GEaS8inOXE7TKz00fbj69ZZqxJgjiWz2GT07GGjAQRGElEdxx9HESS/exec';

  // DOM elements
  const loadingOverlay = document.getElementById('loading-overlay');
  const shelvesContainer = document.getElementById('shelves-container');
  const searchInput = document.getElementById('search-input');
  const searchNav = document.getElementById('search-nav');
  const searchCount = document.getElementById('search-count');
  const btnSave = document.getElementById('btn-save');
  const btnCancel = document.getElementById('btn-cancel');
  const btnEdit = document.getElementById('btn-edit');
  const btnMove = document.getElementById('btn-move');
  const btnDelete = document.getElementById('btn-delete');
  const btnMenu = document.getElementById('btn-menu');
  const btnPrint = document.getElementById('btn-print');
  const app = document.getElementById('app');
  const toast = document.getElementById('toast');

  // Popups
  const popupSave = document.getElementById('popup-save');
  const popupCancel = document.getElementById('popup-cancel');
  const popupExit = document.getElementById('popup-exit');
  const popupDuplicate = document.getElementById('popup-duplicate');
  const popupPrint = document.getElementById('popup-print');
  const popupChanges = document.getElementById('popup-changes');
  const popupDuplicateMsg = document.getElementById('popup-duplicate-msg');
  const printShelvesInput = document.getElementById('print-shelves-input');
  const confirmPrintCheckbox = document.getElementById('confirm-print-checkbox');
  const popupSaveConfirm = document.getElementById('popup-save-confirm');
  const printCountEl = document.getElementById('print-count');

  // State
  let DATA = [];                    // Original data from API
  let currentMode = null;           // 'edit' | 'delete' | 'move' | null
  let changes = {
    added: [],                      // { codice, descrizione, scaffale }
    modified: [],                   // { codice, oldDescrizione?, newDescrizione?, oldScaffale?, newScaffale? }
    deleted: []                     // { codice, descrizione, scaffale }
  };
  let pendingMoves = [];            // { codice, descrizione, fromScaffale, toScaffale }
  let modifiedShelvesSet = new Set(); // Traccia scaffali modificati per stampa
  let hasPrintedModified = false;   // Traccia se utente ha stampato dopo modifiche
  let searchResults = [];
  let currentSearchIndex = 0;

  // ---------- Utils ----------

  function normalizeShelf(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^([A-Za-z])\s*0*(\d{1,2})$/);
    if (!m) return null;
    const letter = m[1].toUpperCase();
    const num = parseInt(m[2], 10);
    return { letter, num, formatted: `${letter}${String(num).padStart(2, '0')}`, raw: `${letter}${num}` };
  }

  function formatShelf(letter, num) {
    return `${letter}${String(num).padStart(2, '0')}`;
  }

  function showToast(msg, type = '') {
    toast.textContent = msg;
    toast.className = 'toast visible ' + type;
    setTimeout(() => toast.classList.remove('visible'), 3000);
  }

  function hasChanges() {
    const validMoves = pendingMoves.filter(m => m.toScaffale);
    return changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0 || validMoves.length > 0;
  }

  function updatePrintButton() {
    const modifiedShelves = getModifiedShelves();
    const count = modifiedShelves.length;

    if (count === 0) {
      // Nessuna modifica: stato normale
      btnPrint.classList.remove('print-pending', 'print-done');
      printCountEl.textContent = '';
    } else if (hasPrintedModified) {
      // Ha stampato: verde con conteggio
      btnPrint.classList.remove('print-pending');
      btnPrint.classList.add('print-done');
      printCountEl.textContent = `(${count})`;
    } else {
      // Non ha stampato: rosso con conteggio
      btnPrint.classList.remove('print-done');
      btnPrint.classList.add('print-pending');
      printCountEl.textContent = `(${count})`;
    }
  }

  function updateSaveButton() {
    btnSave.disabled = !hasChanges();
    updatePrintButton();
  }


  function getModifiedShelves() {
    // Raccoglie tutti gli scaffali che sono stati modificati
    const shelves = new Set();

    // Aggiunti
    for (const item of changes.added) {
      const norm = normalizeShelf(item.scaffale);
      if (norm) shelves.add(norm.formatted);
    }

    // Modificati (scaffale originale)
    for (const mod of changes.modified) {
      // Trova l'item originale per sapere lo scaffale
      const original = DATA.find(d => d.codice === mod.codice);
      if (original) {
        const norm = normalizeShelf(original.scaffale);
        if (norm) shelves.add(norm.formatted);
      }
      // Se lo scaffale è cambiato, aggiungi anche il nuovo
      if (mod.newScaffale) {
        const normNew = normalizeShelf(mod.newScaffale);
        if (normNew) shelves.add(normNew.formatted);
      }
    }

    // Eliminati
    for (const item of changes.deleted) {
      const norm = normalizeShelf(item.scaffale);
      if (norm) shelves.add(norm.formatted);
    }

    // Spostati
    for (const move of pendingMoves) {
      if (move.toScaffale) {
        const normFrom = normalizeShelf(move.fromScaffale);
        const normTo = normalizeShelf(move.toScaffale);
        if (normFrom) shelves.add(normFrom.formatted);
        if (normTo) shelves.add(normTo.formatted);
      }
    }

    return Array.from(shelves).sort();
  }

  // ---------- Data Loading ----------

  async function loadFromAPI() {
    try {
      const res = await fetch(`${API_URL}?action=getRicambi`, {
        redirect: 'follow',
        cache: 'no-store'
      });
      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      DATA = (data.ricambi || []).map(r => ({
        codice: r.Codice || '',
        descrizione: r.Descrizione || '',
        scaffale: r.Scaffale || ''
      }));

      // Save to cache
      if (typeof window.cacheManager !== 'undefined' && DATA.length > 0) {
        window.cacheManager.set('magazzino', DATA);
      }
    } catch (e) {
      console.error('Errore caricamento da API:', e);
      DATA = [];
    }
  }

  // ---------- Shelf Organization ----------

  function organizeByShelf(data) {
    // Group items by normalized shelf
    const shelfMap = new Map();

    for (const item of data) {
      const shelf = normalizeShelf(item.scaffale);
      if (!shelf) continue;

      const key = shelf.raw;
      if (!shelfMap.has(key)) {
        shelfMap.set(key, {
          letter: shelf.letter,
          num: shelf.num,
          formatted: shelf.formatted,
          items: []
        });
      }
      shelfMap.get(key).items.push(item);
    }

    // Sort items within each shelf by codice
    for (const shelf of shelfMap.values()) {
      shelf.items.sort((a, b) => a.codice.localeCompare(b.codice));
    }

    // Group shelves by letter
    const letterMap = new Map();
    for (const shelf of shelfMap.values()) {
      if (!letterMap.has(shelf.letter)) {
        letterMap.set(shelf.letter, []);
      }
      letterMap.get(shelf.letter).push(shelf);
    }

    // Sort shelves within each letter by number
    for (const shelves of letterMap.values()) {
      shelves.sort((a, b) => a.num - b.num);
    }

    // Sort letters
    const sortedLetters = Array.from(letterMap.keys()).sort();

    return { shelfMap, letterMap, sortedLetters };
  }

  // ---------- Rendering ----------

  function renderShelves() {
    const { letterMap, sortedLetters } = organizeByShelf(DATA);
    shelvesContainer.innerHTML = '';

    for (const letter of sortedLetters) {
      const shelves = letterMap.get(letter);
      const totalShelves = shelves.length;

      // Split into rows of 7
      let rowIndex = 0;
      let shelvesInRow = [];
      let processedCount = 0;

      for (let i = 0; i < shelves.length; i++) {
        shelvesInRow.push(shelves[i]);
        processedCount++;

        // Create row when we have 7 shelves or at the end
        if (shelvesInRow.length === 7 || i === shelves.length - 1) {
          const isLastRowForLetter = (processedCount === totalShelves);
          const row = createShelfRow(letter, shelvesInRow, rowIndex, isLastRowForLetter);
          shelvesContainer.appendChild(row);
          rowIndex++;
          shelvesInRow = [];
        }
      }
    }

    updateSaveButton();
  }

  function createShelfRow(letter, shelves, rowIndex, isLastRowForLetter) {
    const row = document.createElement('div');
    row.className = 'shelf-row';
    row.dataset.letter = letter;
    row.dataset.rowIndex = rowIndex;

    // Calculate max height for new shelf placeholder
    let maxItems = 0;

    for (const shelf of shelves) {
      const box = createShelfBox(shelf);
      row.appendChild(box);
      maxItems = Math.max(maxItems, shelf.items.length);
    }

    // Add "new shelf" placeholder ONLY on the last row for this letter
    if (isLastRowForLetter) {
      const lastShelf = shelves[shelves.length - 1];
      const nextNum = lastShelf.num + 1;

      const newShelf = document.createElement('div');
      newShelf.className = 'shelf-new';
      newShelf.dataset.letter = letter;
      newShelf.dataset.nextNum = nextNum;
      newShelf.style.minHeight = `${Math.max(80, maxItems * 28 + 50)}px`;
      newShelf.innerHTML = '+';
      newShelf.title = `Aggiungi scaffale ${formatShelf(letter, nextNum)}`;
      newShelf.addEventListener('click', () => handleAddShelf(letter, nextNum));
      row.appendChild(newShelf);
    }

    return row;
  }

  function createShelfBox(shelf) {
    const box = document.createElement('div');
    box.className = 'shelf-box';
    box.dataset.shelf = shelf.formatted;

    const header = document.createElement('div');
    header.className = 'shelf-header';
    header.textContent = shelf.formatted;
    box.appendChild(header);

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'shelf-items';

    for (const item of shelf.items) {
      const itemEl = createShelfItem(item);
      itemsContainer.appendChild(itemEl);
    }

    // Add button (visible only in edit mode)
    const addBtn = document.createElement('div');
    addBtn.className = 'shelf-add';
    addBtn.innerHTML = '+';
    addBtn.title = 'Aggiungi pezzo';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleAddItem(shelf.formatted);
    });
    itemsContainer.appendChild(addBtn);

    box.appendChild(itemsContainer);
    return box;
  }

  function createShelfItem(item, isNew = false, isModified = false) {
    const itemEl = document.createElement('div');
    itemEl.className = 'shelf-item';
    itemEl.dataset.codice = item.codice;

    if (isNew) {
      itemEl.classList.add('item-added');
    }
    if (isModified) {
      itemEl.classList.add('item-modified-new');
    }

    // Check if deleted
    const isDeleted = changes.deleted.some(d => d.codice === item.codice);
    if (isDeleted) {
      itemEl.classList.add('item-deleted');
    }

    const codiceEl = document.createElement('span');
    codiceEl.className = 'item-codice';
    codiceEl.textContent = item.codice;
    codiceEl.addEventListener('click', (e) => handleItemClick(e, item, 'codice'));

    const descEl = document.createElement('span');
    descEl.className = 'item-desc';
    descEl.textContent = item.descrizione;
    descEl.title = item.descrizione;
    descEl.addEventListener('click', (e) => handleItemClick(e, item, 'descrizione'));

    itemEl.appendChild(codiceEl);
    itemEl.appendChild(descEl);

    return itemEl;
  }

  // ---------- Mode Handling ----------

  function setMode(mode) {
    // Toggle off if same mode
    if (currentMode === mode) {
      currentMode = null;
      btnEdit.classList.remove('active');
      btnMove.classList.remove('active');
      btnDelete.classList.remove('active');
      app.classList.remove('mode-edit', 'mode-move', 'mode-delete');
      document.body.style.cursor = '';
      return;
    }

    currentMode = mode;
    btnEdit.classList.toggle('active', mode === 'edit');
    btnMove.classList.toggle('active', mode === 'move');
    btnDelete.classList.toggle('active', mode === 'delete');
    app.classList.toggle('mode-edit', mode === 'edit');
    app.classList.toggle('mode-move', mode === 'move');
    app.classList.toggle('mode-delete', mode === 'delete');

    // Change cursor based on mode
    if (mode === 'delete') {
      document.body.style.cursor = 'crosshair';
    } else if (mode === 'edit') {
      document.body.style.cursor = 'text';
    } else if (mode === 'move') {
      document.body.style.cursor = 'pointer';
    } else {
      document.body.style.cursor = '';
    }
  }

  // ---------- Item Actions ----------

  function handleItemClick(e, item, field) {
    e.stopPropagation();

    if (currentMode === 'delete') {
      toggleDelete(item);
    } else if (currentMode === 'move') {
      toggleMove(item);
    } else if (currentMode === 'edit') {
      // Se l'item era marcato per eliminazione, rimuovi la marcatura prima di editare
      const wasDeleted = changes.deleted.findIndex(d => d.codice === item.codice);
      if (wasDeleted >= 0) {
        changes.deleted.splice(wasDeleted, 1);
        const itemEl = shelvesContainer.querySelector(`[data-codice="${item.codice}"]`);
        if (itemEl) {
          itemEl.classList.remove('item-deleted');
        }
        updateSaveButton();
      }
      // Se l'item era marcato per spostamento, rimuovi la marcatura
      const wasMoving = pendingMoves.findIndex(m => m.codice === item.codice);
      if (wasMoving >= 0) {
        cancelMove(item.codice);
      }
      startEditing(e.target, item, field);
    }
  }

  function toggleDelete(item) {
    const idx = changes.deleted.findIndex(d => d.codice === item.codice);

    if (idx >= 0) {
      // Un-delete
      changes.deleted.splice(idx, 1);
    } else {
      // Delete
      changes.deleted.push({ ...item });
    }

    // Update UI
    const itemEl = shelvesContainer.querySelector(`[data-codice="${item.codice}"]`);
    if (itemEl) {
      itemEl.classList.toggle('item-deleted', idx < 0);
    }

    updateSaveButton();
  }

  function toggleMove(item) {
    const idx = pendingMoves.findIndex(m => m.codice === item.codice);

    if (idx >= 0) {
      // Cancel move - rimuovi input e stato
      cancelMove(item.codice);
    } else {
      // Start move - aggiungi input sotto l'item
      startMove(item);
    }
  }

  function startMove(item) {
    const itemEl = shelvesContainer.querySelector(`[data-codice="${item.codice}"]`);
    if (!itemEl) return;

    // Aggiungi classe moving
    itemEl.classList.add('item-moving');

    // Crea container per input
    const moveContainer = document.createElement('div');
    moveContainer.className = 'move-input-container';
    moveContainer.dataset.moveCodice = item.codice;

    const label = document.createElement('span');
    label.textContent = '→';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'move-input';
    input.placeholder = 'A01';
    input.maxLength = 3;

    moveContainer.appendChild(label);
    moveContainer.appendChild(input);
    itemEl.appendChild(moveContainer);

    input.focus();

    // Aggiungi a pendingMoves (senza destinazione per ora)
    pendingMoves.push({
      codice: item.codice,
      descrizione: item.descrizione,
      fromScaffale: item.scaffale,
      toScaffale: null
    });

    input.addEventListener('input', () => {
      const val = input.value.toUpperCase();
      input.value = val;

      const move = pendingMoves.find(m => m.codice === item.codice);
      if (!move) return;

      // Rimuovi vecchio target se esisteva
      if (move.toScaffale) {
        removeMoveTarget(item.codice);
      }

      const normalized = normalizeShelf(val);
      if (normalized && normalized.formatted !== normalizeShelf(item.scaffale)?.formatted) {
        move.toScaffale = normalized.formatted;
        showMoveTarget(item, normalized.formatted);
        updateSaveButton();
      } else {
        move.toScaffale = null;
        updateSaveButton();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const move = pendingMoves.find(m => m.codice === item.codice);
        if (!move || !move.toScaffale) {
          // Nessuna destinazione valida - annulla
          cancelMove(item.codice);
        } else {
          // Conferma spostamento - rimuovi input ma mantieni stato
          moveContainer.remove();
        }
        input.blur();
      } else if (e.key === 'Escape') {
        cancelMove(item.codice);
      }
    });

    input.addEventListener('blur', () => {
      // Solo se clicco fuori e c'è una destinazione valida, mantieni
      setTimeout(() => {
        const move = pendingMoves.find(m => m.codice === item.codice);
        if (move && !move.toScaffale && document.body.contains(moveContainer)) {
          cancelMove(item.codice);
        }
      }, 100);
    });
  }

  function cancelMove(codice) {
    const idx = pendingMoves.findIndex(m => m.codice === codice);
    if (idx >= 0) {
      const move = pendingMoves[idx];
      // Rimuovi target dallo scaffale destinazione
      if (move.toScaffale) {
        removeMoveTarget(codice);
      }
      pendingMoves.splice(idx, 1);
    }

    // Rimuovi classe e input dall'item originale
    const itemEl = shelvesContainer.querySelector(`[data-codice="${codice}"]`);
    if (itemEl) {
      itemEl.classList.remove('item-moving');
      const moveContainer = itemEl.querySelector('.move-input-container');
      if (moveContainer) moveContainer.remove();
    }

    updateSaveButton();
  }

  function showMoveTarget(item, toScaffale) {
    // Trova lo scaffale di destinazione
    const shelfBox = shelvesContainer.querySelector(`[data-shelf="${toScaffale}"]`);
    if (!shelfBox) {
      // Lo scaffale non esiste ancora - potrebbe essere creato
      showToast(`Scaffale ${toScaffale} non esiste`, 'error');
      return;
    }

    const itemsContainer = shelfBox.querySelector('.shelf-items');
    if (!itemsContainer) return;

    // Crea elemento ghost per mostrare dove andrà il pezzo
    const ghost = document.createElement('div');
    ghost.className = 'shelf-item item-move-target';
    ghost.dataset.moveTargetFor = item.codice;

    const codiceSpan = document.createElement('span');
    codiceSpan.className = 'item-codice';
    codiceSpan.textContent = item.codice;

    const descSpan = document.createElement('span');
    descSpan.className = 'item-desc';
    descSpan.textContent = item.descrizione;

    ghost.appendChild(codiceSpan);
    ghost.appendChild(descSpan);

    // Inserisci in ordine alfabetico
    const existingItems = itemsContainer.querySelectorAll('.shelf-item:not(.add-item-btn):not(.item-move-target)');
    let inserted = false;
    for (const existing of existingItems) {
      const existingCodice = existing.dataset.codice || '';
      if (item.codice.localeCompare(existingCodice) < 0) {
        itemsContainer.insertBefore(ghost, existing);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      // Inserisci prima del pulsante +
      const addBtn = itemsContainer.querySelector('.add-item-btn');
      if (addBtn) {
        itemsContainer.insertBefore(ghost, addBtn);
      } else {
        itemsContainer.appendChild(ghost);
      }
    }
  }

  function removeMoveTarget(codice) {
    const target = shelvesContainer.querySelector(`[data-move-target-for="${codice}"]`);
    if (target) target.remove();
  }

  function startEditing(element, item, field) {
    if (element.querySelector('input')) return; // Already editing

    const currentValue = field === 'codice' ? item.codice : item.descrizione;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input' + (field === 'codice' ? ' codice' : '');
    input.value = currentValue;

    const originalText = element.textContent;
    element.textContent = '';
    element.appendChild(input);
    input.focus();
    input.select();

    const finishEditing = (save) => {
      const newValue = input.value.trim();
      input.remove();

      if (!save || newValue === currentValue) {
        element.textContent = originalText;
        return;
      }

      // Check for duplicate codice
      if (field === 'codice' && newValue !== item.codice) {
        const exists = DATA.some(d => d.codice === newValue) ||
                       changes.added.some(a => a.codice === newValue);
        if (exists) {
          popupDuplicateMsg.textContent = `Il codice "${newValue}" esiste già nel magazzino.`;
          popupDuplicate.classList.add('visible');
          element.textContent = originalText;
          return;
        }
      }

      // Record modification
      let mod = changes.modified.find(m => m.codice === item.codice);
      if (!mod) {
        mod = { codice: item.codice };
        changes.modified.push(mod);
      }

      if (field === 'codice') {
        mod.oldCodice = item.codice;
        mod.newCodice = newValue;
      } else {
        mod.oldDescrizione = item.descrizione;
        mod.newDescrizione = newValue;
      }

      // Update UI - show old strikethrough and new value
      const itemEl = element.closest('.shelf-item');

      // Create modified view
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.gap = '2px';

      const oldEl = document.createElement('span');
      oldEl.className = field === 'codice' ? 'item-codice item-modified-old' : 'item-desc item-modified-old';
      oldEl.textContent = currentValue;
      oldEl.style.fontSize = '0.75rem';

      const newEl = document.createElement('span');
      newEl.className = field === 'codice' ? 'item-codice item-modified-new' : 'item-desc item-modified-new';
      newEl.textContent = newValue;

      wrapper.appendChild(oldEl);
      wrapper.appendChild(newEl);
      element.replaceWith(wrapper);

      updateSaveButton();
    };

    input.addEventListener('blur', () => finishEditing(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishEditing(true);
      } else if (e.key === 'Escape') {
        finishEditing(false);
      }
    });
  }

  function handleAddItem(scaffale) {
    if (currentMode !== 'edit') return;

    // Normalize scaffale per trovare il data-shelf corretto
    const shelfNorm = normalizeShelf(scaffale);
    if (!shelfNorm) return;

    // Usa sempre formato formatted (A01)
    const shelfBox = shelvesContainer.querySelector(`[data-shelf="${shelfNorm.formatted}"]`);
    if (!shelfBox) {
      console.error('Shelf box not found for:', shelfNorm.formatted);
      return;
    }

    const itemsContainer = shelfBox.querySelector('.shelf-items');
    const addBtn = itemsContainer.querySelector('.shelf-add');

    // Se c'è già un input aperto, non fare niente
    if (itemsContainer.querySelector('.edit-input')) {
      return;
    }

    // Create new item row
    const newItem = document.createElement('div');
    newItem.className = 'shelf-item item-added';

    const codiceInput = document.createElement('input');
    codiceInput.type = 'text';
    codiceInput.className = 'edit-input codice';
    codiceInput.placeholder = 'Codice';

    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.className = 'edit-input';
    descInput.placeholder = 'Descrizione';
    descInput.style.flex = '1';

    newItem.appendChild(codiceInput);
    newItem.appendChild(descInput);

    itemsContainer.insertBefore(newItem, addBtn);
    codiceInput.focus();

    let isFinishing = false;

    const finishAdding = (fromBlur = false) => {
      if (isFinishing) return;
      // Non processare se il popup duplicato è aperto
      if (popupDuplicate.classList.contains('visible')) return;

      const codice = codiceInput.value.trim();
      const descrizione = descInput.value.trim();

      if (!codice) {
        newItem.remove();
        return;
      }

      // Check for duplicate
      const exists = DATA.some(d => d.codice === codice) ||
                     changes.added.some(a => a.codice === codice);
      if (exists) {
        popupDuplicateMsg.textContent = `Il codice "${codice}" esiste già nel magazzino.`;
        popupDuplicate.classList.add('visible');
        return;
      }

      isFinishing = true;

      // Add to changes
      changes.added.push({
        codice,
        descrizione,
        scaffale: shelfNorm.formatted
      });

      // Update UI
      newItem.innerHTML = '';
      newItem.dataset.codice = codice;

      const codiceEl = document.createElement('span');
      codiceEl.className = 'item-codice';
      codiceEl.textContent = codice;

      const descEl = document.createElement('span');
      descEl.className = 'item-desc';
      descEl.textContent = descrizione;

      newItem.appendChild(codiceEl);
      newItem.appendChild(descEl);

      updateSaveButton();
    };

    descInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishAdding();
      } else if (e.key === 'Escape') {
        newItem.remove();
      }
    });

    descInput.addEventListener('blur', (e) => {
      // Don't finish if focus is moving within the same newItem
      setTimeout(() => {
        if (!newItem.contains(document.activeElement)) {
          finishAdding(true);
        }
      }, 150);
    });

    codiceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        descInput.focus();
      } else if (e.key === 'Escape') {
        newItem.remove();
      }
    });

    codiceInput.addEventListener('blur', (e) => {
      // Don't finish if focus is moving within the same newItem
      setTimeout(() => {
        if (!newItem.contains(document.activeElement)) {
          finishAdding(true);
        }
      }, 150);
    });
  }

  function handleAddShelf(letter, num) {
    if (currentMode !== 'edit') return;

    // Create a temporary shelf box
    const formatted = formatShelf(letter, num);

    // Check if this shelf already exists
    if (shelvesContainer.querySelector(`[data-shelf="${formatted}"]`)) {
      // Shelf already exists, just add item to it
      handleAddItem(formatted);
      return;
    }

    // Find the row and insert new shelf
    const rows = shelvesContainer.querySelectorAll(`.shelf-row[data-letter="${letter}"]`);
    let targetRow = rows[rows.length - 1];

    // Count shelves in last row (excluding the + placeholder)
    const shelvesInRow = targetRow.querySelectorAll('.shelf-box').length;

    if (shelvesInRow >= 7) {
      // Need new row
      targetRow = document.createElement('div');
      targetRow.className = 'shelf-row';
      targetRow.dataset.letter = letter;

      // Insert after the last row for this letter
      const lastRowForLetter = rows[rows.length - 1];
      lastRowForLetter.after(targetRow);
    }

    // Create new shelf box
    const box = document.createElement('div');
    box.className = 'shelf-box';
    box.dataset.shelf = formatted;

    const header = document.createElement('div');
    header.className = 'shelf-header';
    header.textContent = formatted;
    box.appendChild(header);

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'shelf-items';

    const addBtn = document.createElement('div');
    addBtn.className = 'shelf-add';
    addBtn.innerHTML = '+';
    addBtn.title = 'Aggiungi pezzo';
    addBtn.style.display = 'flex'; // Show immediately since we're in edit mode
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleAddItem(formatted);
    });
    itemsContainer.appendChild(addBtn);

    box.appendChild(itemsContainer);

    // Find the new shelf placeholder and insert before it, or move it
    const oldPlaceholder = targetRow.querySelector('.shelf-new');
    if (oldPlaceholder) {
      targetRow.insertBefore(box, oldPlaceholder);
      // Update placeholder for next number
      oldPlaceholder.dataset.nextNum = num + 1;
      oldPlaceholder.title = `Aggiungi scaffale ${formatShelf(letter, num + 1)}`;
    } else {
      // No placeholder in this row, need to create one or move from previous row
      targetRow.appendChild(box);

      // Create new placeholder
      const newPlaceholder = document.createElement('div');
      newPlaceholder.className = 'shelf-new';
      newPlaceholder.dataset.letter = letter;
      newPlaceholder.dataset.nextNum = num + 1;
      newPlaceholder.style.minHeight = '80px';
      newPlaceholder.style.display = 'flex';
      newPlaceholder.innerHTML = '+';
      newPlaceholder.title = `Aggiungi scaffale ${formatShelf(letter, num + 1)}`;
      newPlaceholder.addEventListener('click', () => handleAddShelf(letter, num + 1));
      targetRow.appendChild(newPlaceholder);

      // Remove old placeholder from previous row if exists
      if (rows.length > 0) {
        const prevRowPlaceholder = rows[rows.length - 1].querySelector('.shelf-new');
        if (prevRowPlaceholder && rows[rows.length - 1] !== targetRow) {
          prevRowPlaceholder.remove();
        }
      }
    }

    // Trigger add item
    handleAddItem(formatted);
  }

  // ---------- Search ----------

  function performSearch(query) {
    // Clear previous highlights
    shelvesContainer.querySelectorAll('.search-highlight, .search-current').forEach(el => {
      el.classList.remove('search-highlight', 'search-current');
    });

    searchResults = [];
    currentSearchIndex = 0;

    if (!query || query.length < 2) {
      searchNav.classList.remove('visible');
      return;
    }

    const q = query.toLowerCase();

    // Search in shelf headers, codici, and descriptions
    shelvesContainer.querySelectorAll('.shelf-box').forEach(box => {
      const header = box.querySelector('.shelf-header');
      const shelfName = header.textContent.toLowerCase();

      if (shelfName.includes(q)) {
        header.classList.add('search-highlight');
        searchResults.push(header);
      }

      box.querySelectorAll('.shelf-item').forEach(item => {
        const codice = item.querySelector('.item-codice');
        const desc = item.querySelector('.item-desc');

        if (codice && codice.textContent.toLowerCase().includes(q)) {
          codice.classList.add('search-highlight');
          searchResults.push(codice);
        }
        if (desc && desc.textContent.toLowerCase().includes(q)) {
          desc.classList.add('search-highlight');
          searchResults.push(desc);
        }
      });
    });

    if (searchResults.length > 0) {
      searchNav.classList.add('visible');
      goToSearchResult(0);
    } else {
      searchNav.classList.remove('visible');
    }

    updateSearchCount();
  }

  function goToSearchResult(index) {
    if (searchResults.length === 0) return;

    // Remove current highlight
    searchResults.forEach(el => el.classList.remove('search-current'));

    // Wrap index
    currentSearchIndex = (index + searchResults.length) % searchResults.length;

    // Highlight current
    const current = searchResults[currentSearchIndex];
    current.classList.add('search-current');
    current.scrollIntoView({ behavior: 'smooth', block: 'center' });

    updateSearchCount();
  }

  function updateSearchCount() {
    if (searchResults.length === 0) {
      searchCount.textContent = '0/0';
    } else {
      searchCount.textContent = `${currentSearchIndex + 1}/${searchResults.length}`;
    }
  }

  // ---------- Save & Cancel ----------

  function showSavePopup() {
    let html = '';

    if (changes.added.length > 0) {
      html += '<h3>Aggiunti (' + changes.added.length + ')</h3><ul>';
      for (const item of changes.added) {
        html += `<li><strong>${item.codice}</strong> - ${item.descrizione} (${item.scaffale})</li>`;
      }
      html += '</ul>';
    }

    if (changes.modified.length > 0) {
      html += '<h3>Modificati (' + changes.modified.length + ')</h3><ul>';
      for (const mod of changes.modified) {
        let desc = mod.codice;
        if (mod.newCodice) desc += ` → ${mod.newCodice}`;
        if (mod.newDescrizione) desc += ` (descrizione modificata)`;
        html += `<li>${desc}</li>`;
      }
      html += '</ul>';
    }

    const validMoves = pendingMoves.filter(m => m.toScaffale);
    if (validMoves.length > 0) {
      html += '<h3>Spostati (' + validMoves.length + ')</h3><ul>';
      for (const move of validMoves) {
        html += `<li><strong>${move.codice}</strong> - ${move.fromScaffale} → ${move.toScaffale}</li>`;
      }
      html += '</ul>';
    }

    if (changes.deleted.length > 0) {
      html += '<h3>Eliminati (' + changes.deleted.length + ')</h3><ul>';
      for (const item of changes.deleted) {
        html += `<li><strong>${item.codice}</strong> - ${item.descrizione}</li>`;
      }
      html += '</ul>';
    }

    popupChanges.innerHTML = html;

    // Reset checkbox e pulsante
    confirmPrintCheckbox.checked = false;
    popupSaveConfirm.disabled = true;
    popupSaveConfirm.classList.remove('popup-btn-confirm');
    popupSaveConfirm.classList.add('popup-btn-danger');

    popupSave.classList.add('visible');
  }

  async function saveChanges() {
    popupSave.classList.remove('visible');
    loadingOverlay.classList.remove('hidden');

    try {
      // Converti pendingMoves in modifiche (cambio scaffale)
      const validMoves = pendingMoves.filter(m => m.toScaffale);
      const moveUpdates = validMoves.map(m => ({
        codice: m.codice,
        newScaffale: m.toScaffale
      }));

      // Combina modifiche normali con spostamenti
      const allUpdates = [...changes.modified, ...moveUpdates];

      // Usa il nuovo endpoint batchOperations per fare tutto in una chiamata
      const response = await fetch(API_URL, {
        method: 'POST',
        redirect: 'follow',
        body: JSON.stringify({
          action: 'batchOperations',
          adds: changes.added,
          updates: allUpdates,
          deletes: changes.deleted
        })
      });

      const result = await response.json();

      if (result.error && !result.success) {
        throw new Error(result.error);
      }

      // Mostra eventuali errori parziali
      if (result.results && result.results.errors && result.results.errors.length > 0) {
        console.warn('Errori parziali:', result.results.errors);
      }

      // Clear changes and reload
      changes = { added: [], modified: [], deleted: [] };
      pendingMoves = [];
      hasPrintedModified = false;

      // Invalidate cache
      if (typeof window.cacheManager !== 'undefined') {
        window.cacheManager.invalidate('magazzino');
      }

      // Reload data
      await loadFromAPI();
      renderShelves();
      setMode(null);

      showToast('Modifiche salvate con successo!', 'success');
    } catch (e) {
      console.error('Errore salvataggio:', e);
      showToast('Errore durante il salvataggio: ' + e.message, 'error');
    } finally {
      loadingOverlay.classList.add('hidden');
    }
  }

  function cancelChanges() {
    popupCancel.classList.remove('visible');
    changes = { added: [], modified: [], deleted: [] };
    pendingMoves = [];
    hasPrintedModified = false;
    renderShelves();
    setMode(null);
    updateSaveButton();
    showToast('Modifiche annullate', '');
  }

  // ---------- PDF Generation ----------

  function parseShelfRange(input) {
    // Parse input like "A01-A09, B05, C01-C03" into array of shelf names
    if (!input || !input.trim()) {
      // Return all shelves
      const { letterMap, sortedLetters } = organizeByShelf(DATA);
      const allShelves = [];
      for (const letter of sortedLetters) {
        for (const shelf of letterMap.get(letter)) {
          allShelves.push(shelf.formatted);
        }
      }
      return allShelves;
    }

    const shelves = [];
    const parts = input.split(/[,;]+/).map(p => p.trim()).filter(p => p);

    for (const part of parts) {
      if (part.includes('-')) {
        // Range like A01-A09
        const [start, end] = part.split('-').map(s => s.trim());
        const startNorm = normalizeShelf(start);
        const endNorm = normalizeShelf(end);

        if (startNorm && endNorm && startNorm.letter === endNorm.letter) {
          const letter = startNorm.letter;
          const from = Math.min(startNorm.num, endNorm.num);
          const to = Math.max(startNorm.num, endNorm.num);
          for (let i = from; i <= to; i++) {
            shelves.push(formatShelf(letter, i));
          }
        }
      } else {
        // Single shelf
        const norm = normalizeShelf(part);
        if (norm) {
          shelves.push(norm.formatted);
        }
      }
    }

    return shelves;
  }

  function getShelfData(shelfName) {
    const norm = normalizeShelf(shelfName);
    if (!norm) return null;

    const items = DATA.filter(item => {
      const itemShelf = normalizeShelf(item.scaffale);
      return itemShelf && itemShelf.formatted === norm.formatted;
    }).sort((a, b) => a.codice.localeCompare(b.codice));

    return {
      name: norm.formatted,
      items: items
    };
  }

  function generatePDF(shelfNames) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    // Timestamp per footer cartellini
    const now = new Date();
    const timestamp = now.toLocaleDateString('it-IT') + ' ' + now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });

    // A4: 210 x 297 mm
    // Grid: 3 columns x 3 rows = 9 labels per page
    // Each label: 70mm x 99mm
    // Padding: 9mm top/left/right, but 4mm bottom for last row (scaffali lunghi potrebbero sforare)

    const labelWidth = 70;
    const labelHeight = 99;
    const paddingNormal = 9;
    const paddingBottomReduced = 4; // Per ultima riga
    const usableWidth = 52; // 70 - 9 - 9
    const cols = 3;
    const rows = 3;
    const labelsPerPage = cols * rows;

    // Cross mark size (75% of original 4mm)
    const crossSize = 3;

    // Collect shelf data and sort alphabetically
    const shelfDataList = shelfNames
      .map(name => getShelfData(name))
      .filter(data => data !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (shelfDataList.length === 0) {
      showToast('Nessuno scaffale trovato', 'error');
      return;
    }

    // Separate long shelves (>7 items) from normal ones
    const longShelves = shelfDataList.filter(s => s.items.length > 7);
    const normalShelves = shelfDataList.filter(s => s.items.length <= 7);

    // Reorder: long shelves go to positions 0-5 (first two rows), normal shelves fill the rest
    const orderedShelves = [];
    let longIdx = 0;
    let normalIdx = 0;

    // For each page, fill positions 0-5 with long shelves first, then normal
    // Position 6-8 (last row) only gets normal shelves
    const totalShelves = shelfDataList.length;
    const totalPages = Math.ceil(totalShelves / labelsPerPage);

    for (let page = 0; page < totalPages; page++) {
      const pageStart = page * labelsPerPage;
      const pageEnd = Math.min(pageStart + labelsPerPage, totalShelves);
      const shelvesThisPage = pageEnd - pageStart;

      // Positions 0-5: prefer long shelves
      for (let pos = 0; pos < Math.min(6, shelvesThisPage); pos++) {
        if (longIdx < longShelves.length) {
          orderedShelves.push(longShelves[longIdx++]);
        } else if (normalIdx < normalShelves.length) {
          orderedShelves.push(normalShelves[normalIdx++]);
        }
      }

      // Positions 6-8: only normal shelves
      for (let pos = 6; pos < shelvesThisPage; pos++) {
        if (normalIdx < normalShelves.length) {
          orderedShelves.push(normalShelves[normalIdx++]);
        } else if (longIdx < longShelves.length) {
          // Fallback: if no normal shelves left, use long (shouldn't happen often)
          orderedShelves.push(longShelves[longIdx++]);
        }
      }
    }

    // Generate pages
    const finalTotalPages = Math.ceil(orderedShelves.length / labelsPerPage);

    for (let page = 0; page < finalTotalPages; page++) {
      if (page > 0) {
        doc.addPage();
      }

      // Draw cross marks at internal vertices (4 marks)
      doc.setDrawColor(0);
      doc.setLineWidth(0.2);

      const crossPositions = [
        { x: labelWidth, y: labelHeight },
        { x: labelWidth * 2, y: labelHeight },
        { x: labelWidth, y: labelHeight * 2 },
        { x: labelWidth * 2, y: labelHeight * 2 }
      ];

      for (const pos of crossPositions) {
        doc.line(pos.x - crossSize, pos.y, pos.x + crossSize, pos.y);
        doc.line(pos.x, pos.y - crossSize, pos.x, pos.y + crossSize);
      }

      // Draw labels for this page
      const startIdx = page * labelsPerPage;
      const endIdx = Math.min(startIdx + labelsPerPage, orderedShelves.length);

      for (let i = startIdx; i < endIdx; i++) {
        const shelfData = orderedShelves[i];
        const localIdx = i - startIdx;
        const col = localIdx % cols;
        const row = Math.floor(localIdx / cols);

        const labelX = col * labelWidth;
        const labelY = row * labelHeight;
        const contentX = labelX + paddingNormal;
        const contentY = labelY + paddingNormal;

        // Scaffali con >7 pezzi hanno padding inferiore ridotto per più spazio verticale
        const isLongShelf = shelfData.items.length > 7;
        const bottomPadding = isLongShelf ? paddingBottomReduced : paddingNormal;
        const usableHeight = labelHeight - paddingNormal - bottomPadding;

        drawLabel(doc, shelfData, contentX, contentY, usableWidth, usableHeight, timestamp);
      }
    }

    // Aggiungi rapportino finale se ci sono modifiche
    if (hasChanges()) {
      // Calcola quanti slot sono rimasti nell'ultima pagina
      const totalLabels = orderedShelves.length;
      const usedSlotsOnLastPage = totalLabels % labelsPerPage;
      const freeSlotsOnLastPage = usedSlotsOnLastPage === 0 ? 0 : labelsPerPage - usedSlotsOnLastPage;

      // Il rapportino occupa 3 slot (una riga intera, 210x99mm)
      // Se ci sono almeno 3 slot liberi, usa quelli; altrimenti nuova pagina
      let reportY;
      if (freeSlotsOnLastPage >= 3) {
        // Calcola la riga dove mettere il rapportino (slot successivo, inizio riga)
        const nextRow = Math.ceil(usedSlotsOnLastPage / cols);
        reportY = nextRow * labelHeight;
      } else {
        // Nuova pagina
        doc.addPage();
        reportY = 0;
      }

      drawReportLabel(doc, now, timestamp, reportY);
    }

    // Download PDF con nome AAAAMMGG_HHMM_cartellini-scaffali.pdf
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const filename = `${year}${month}${day}_${hours}${minutes}_cartellini-scaffali.pdf`;

    doc.save(filename);

    // Segna che l'utente ha stampato
    hasPrintedModified = true;

    showToast(`PDF generato con ${orderedShelves.length} cartellini`, 'success');
  }

  function drawReportLabel(doc, now, timestamp, startY) {
    // Rapportino occupa tutta la larghezza A4 (210x99mm) con padding 9mm
    const reportWidth = 210;
    const reportHeight = 99;
    const padding = 9;
    const usableWidth = reportWidth - padding * 2; // 192mm
    const usableHeight = reportHeight - padding * 2; // 81mm

    const x = padding;
    const y = startY + padding;

    // Header con titolo e data/ora sulla stessa barra
    const headerHeight = 8;
    doc.setFillColor(85, 85, 85);
    doc.rect(x, y, usableWidth, headerHeight, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('RAPPORTINO MODIFICHE MAGAZZINO', x + 2, y + 5.5);

    // Data/ora a destra, font più piccolo
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const dateStr = now.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    doc.text(`${dateStr} - ${timeStr}`, x + usableWidth - 2, y + 5.5, { align: 'right' });

    const lineHeight = 3.5;
    const sectionGap = 6; // 6mm tra sezioni

    // === SEZIONE MODIFICATI (sotto header, tutta larghezza) ===
    let modifiedY = y + headerHeight + sectionGap; // 6mm dopo header
    let hasModified = false;

    if (changes.modified.length > 0) {
      hasModified = true;
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(`MODIFICATI (${changes.modified.length}):`, x, modifiedY);
      modifiedY += lineHeight + 1;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);

      for (const mod of changes.modified) {
        // Trova dati originali
        const original = DATA.find(d => d.codice === mod.codice);
        const oldCodice = mod.codice;
        const oldDesc = original ? original.descrizione : '';
        const newCodice = mod.newCodice || oldCodice;
        const newDesc = mod.newDescrizione !== undefined ? mod.newDescrizione : oldDesc;

        let text = `${oldCodice}`;
        if (oldDesc) text += ` - ${oldDesc}`;
        text += ' -> ';
        text += `${newCodice}`;
        if (newDesc) text += ` - ${newDesc}`;

        // Tronca se necessario
        let displayText = text;
        while (doc.getTextWidth('- ' + displayText) > usableWidth && displayText.length > 20) {
          displayText = displayText.slice(0, -1);
        }
        if (displayText !== text) displayText += '...';

        doc.text('- ' + displayText, x, modifiedY);
        modifiedY += lineHeight;

        if (modifiedY > y + 40) {
          doc.text('- ... e altri', x, modifiedY);
          modifiedY += lineHeight;
          break;
        }
      }
    }

    // === SEZIONE INFERIORE TRIPARTITA: ELIMINATI | AGGIUNTI | SPOSTATI ===
    // 6mm dopo MODIFICATI se presente, altrimenti 6mm dopo header
    const bottomSectionY = hasModified ? modifiedY + sectionGap : y + headerHeight + sectionGap;
    const columnWidth = usableWidth / 3; // ~64mm per colonna

    // Helper per disegnare una colonna
    const drawColumn = (title, items, formatFn, colIndex) => {
      const colX = x + colIndex * columnWidth;
      let colY = bottomSectionY;
      const maxColWidth = columnWidth - 4;

      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(`${title} (${items.length}):`, colX, colY);
      colY += lineHeight + 1;

      if (items.length === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.text('- nessuno', colX, colY);
        return;
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);

      for (const item of items) {
        const text = formatFn(item);

        // Tronca se necessario
        let displayText = text;
        while (doc.getTextWidth('- ' + displayText) > maxColWidth && displayText.length > 10) {
          displayText = displayText.slice(0, -1);
        }
        if (displayText !== text) displayText += '...';

        doc.text('- ' + displayText, colX, colY);
        colY += lineHeight;

        if (colY > y + usableHeight - 5) {
          doc.text('- ...', colX, colY);
          break;
        }
      }
    };

    // Colonna 1: ELIMINATI
    drawColumn('ELIMINATI', changes.deleted, item =>
      `${item.codice} - ${item.descrizione} (${item.scaffale})`, 0
    );

    // Colonna 2: AGGIUNTI
    drawColumn('AGGIUNTI', changes.added, item =>
      `${item.codice} - ${item.descrizione} (${item.scaffale})`, 1
    );

    // Colonna 3: SPOSTATI
    const validMoves = pendingMoves.filter(m => m.toScaffale);
    drawColumn('SPOSTATI', validMoves, move =>
      `${move.codice} - ${move.descrizione} - ${move.fromScaffale} -> ${move.toScaffale}`, 2
    );

    // Footer con timestamp
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5);
    doc.setTextColor(128, 128, 128);
    doc.text(timestamp, x + usableWidth, startY + reportHeight - padding, { align: 'right' });
  }

  function drawLabel(doc, shelfData, x, y, width, height, timestamp) {
    // Header bar (gray background, white text)
    const headerHeight = 6;
    doc.setFillColor(85, 85, 85); // #555
    doc.rect(x, y, width, headerHeight, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(shelfData.name, x + width / 2, y + headerHeight - 1.5, { align: 'center' });

    // Content area
    const gapAfterHeader = 2;    // 2mm tra header e primo codice (ridotto da 3)
    const gapBetweenItems = 2.5; // 2.5mm tra descrizione e codice successivo
    const contentStartY = y + headerHeight + gapAfterHeader;
    const availableHeight = height - headerHeight - gapAfterHeader;

    doc.setTextColor(0, 0, 0);

    const items = shelfData.items;
    const itemCount = items.length;

    // Calcola font size e lineHeight in base al numero di pezzi
    let fontSize, lineHeight;

    if (itemCount <= 6) {
      // Per ≤6 pezzi: font 11.2pt
      // availableHeight = 81 - 6 - 2 = 73mm
      // lineHeight = (73 - 5*2.5) / 12 = (73 - 12.5) / 12 = 60.5/12 ≈ 5.04mm
      fontSize = 11.2;
      lineHeight = 5.04;
    } else if (itemCount === 7) {
      // Per 7 pezzi: font 10pt
      // availableHeight = 81 - 6 - 2 = 73mm
      // lineHeight = (73 - 6*2.5) / 14 = (73 - 15) / 14 = 58/14 ≈ 4.14mm
      fontSize = 10;
      lineHeight = 4.14;
    } else if (itemCount === 8) {
      // Per 8 pezzi, usa 86mm di altezza (padding ridotto)
      // availableHeight = 86 - 6 - 2 = 78mm
      // lineHeight = (78 - 7*2.5) / 16 = (78 - 17.5) / 16 = 60.5/16 ≈ 3.78mm
      fontSize = 9;
      lineHeight = 3.78;
    } else {
      // Per 9+ pezzi, usa 86mm di altezza
      // availableHeight = 86 - 6 - 2 = 78mm
      // lineHeight = (78 - 8*2.5) / 18 = (78 - 20) / 18 = 58/18 ≈ 3.22mm
      fontSize = 8;
      lineHeight = 3.22;
    }

    doc.setFontSize(fontSize);

    // Calcola la larghezza massima del testo per centrare il blocco
    let maxTextWidth = 0;
    const truncatedDescs = [];

    for (const item of items) {
      doc.setFont('helvetica', 'bold');
      const codiceWidth = doc.getTextWidth(item.codice);

      doc.setFont('helvetica', 'normal');
      let desc = item.descrizione;
      const maxAllowedWidth = width - 4; // Margine di sicurezza

      // Truncate description if too long
      while (doc.getTextWidth(desc) > maxAllowedWidth && desc.length > 3) {
        desc = desc.slice(0, -1);
      }
      if (desc !== item.descrizione) {
        desc = desc.slice(0, -1) + '…';
      }
      truncatedDescs.push(desc);

      const descWidth = doc.getTextWidth(desc);
      maxTextWidth = Math.max(maxTextWidth, codiceWidth, descWidth);
    }

    // Calcola offset X per centrare il blocco
    const blockOffsetX = (width - maxTextWidth) / 2;
    const textX = x + blockOffsetX;

    // Disegna i pezzi
    let currentY = contentStartY + lineHeight; // Prima riga di testo

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Codice (bold)
      doc.setFont('helvetica', 'bold');
      doc.text(item.codice, textX, currentY);
      currentY += lineHeight;

      // Descrizione (normal)
      doc.setFont('helvetica', 'normal');
      doc.text(truncatedDescs[i], textX, currentY);

      // Gap tra items (tranne dopo l'ultimo)
      if (i < items.length - 1) {
        currentY += gapBetweenItems + lineHeight;
      }
    }

    // Timestamp in basso a destra
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4.5);
    doc.setTextColor(128, 128, 128);
    doc.text(timestamp, x + width, y + height, { align: 'right' });
  }

  // ---------- Event Listeners ----------

  btnEdit.addEventListener('click', () => setMode('edit'));
  btnMove.addEventListener('click', () => setMode('move'));
  btnDelete.addEventListener('click', () => setMode('delete'));

  btnPrint.addEventListener('click', () => {
    // Precompila con scaffali modificati se presenti
    const modifiedShelves = getModifiedShelves();
    printShelvesInput.value = modifiedShelves.length > 0 ? modifiedShelves.join(', ') : '';
    popupPrint.classList.add('visible');
    printShelvesInput.focus();
  });

  btnSave.addEventListener('click', () => {
    showSavePopup();
  });

  document.getElementById('popup-save-cancel').addEventListener('click', () => {
    popupSave.classList.remove('visible');
  });

  confirmPrintCheckbox.addEventListener('change', () => {
    popupSaveConfirm.disabled = !confirmPrintCheckbox.checked;
    if (confirmPrintCheckbox.checked) {
      popupSaveConfirm.classList.remove('popup-btn-danger');
      popupSaveConfirm.classList.add('popup-btn-confirm');
    } else {
      popupSaveConfirm.classList.remove('popup-btn-confirm');
      popupSaveConfirm.classList.add('popup-btn-danger');
    }
  });

  popupSaveConfirm.addEventListener('click', saveChanges);

  btnCancel.addEventListener('click', () => {
    if (hasChanges()) {
      popupCancel.classList.add('visible');
    }
  });
  document.getElementById('popup-cancel-no').addEventListener('click', () => {
    popupCancel.classList.remove('visible');
  });
  document.getElementById('popup-cancel-yes').addEventListener('click', cancelChanges);

  btnMenu.addEventListener('click', () => {
    if (hasChanges()) {
      popupExit.classList.add('visible');
    } else {
      window.location.href = '/private.html';
    }
  });
  document.getElementById('popup-exit-stay').addEventListener('click', () => {
    popupExit.classList.remove('visible');
  });
  document.getElementById('popup-exit-leave').addEventListener('click', () => {
    window.location.href = '/private.html';
  });

  document.getElementById('popup-duplicate-ok').addEventListener('click', () => {
    popupDuplicate.classList.remove('visible');
    // Trova l'input codice attivo e permettigli di essere modificato
    const activeInput = shelvesContainer.querySelector('.edit-input.codice');
    if (activeInput) {
      activeInput.focus();
      activeInput.select();
    }
  });

  document.getElementById('popup-print-cancel').addEventListener('click', () => {
    popupPrint.classList.remove('visible');
  });

  document.getElementById('popup-print-ok').addEventListener('click', () => {
    popupPrint.classList.remove('visible');
    const shelfNames = parseShelfRange(printShelvesInput.value);
    generatePDF(shelfNames);
  });

  printShelvesInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      popupPrint.classList.remove('visible');
      const shelfNames = parseShelfRange(printShelvesInput.value);
      generatePDF(shelfNames);
    } else if (e.key === 'Escape') {
      popupPrint.classList.remove('visible');
    }
  });

  // Search
  let searchDebounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      performSearch(searchInput.value.trim());
    }, 200);
  });

  document.getElementById('search-prev').addEventListener('click', () => {
    goToSearchResult(currentSearchIndex - 1);
  });
  document.getElementById('search-next').addEventListener('click', () => {
    goToSearchResult(currentSearchIndex + 1);
  });

  // Close popups on overlay click
  [popupSave, popupCancel, popupExit, popupDuplicate, popupPrint].forEach(popup => {
    popup.addEventListener('click', (e) => {
      if (e.target === popup) {
        popup.classList.remove('visible');
      }
    });
  });

  // Warn on page unload
  window.addEventListener('beforeunload', (e) => {
    if (hasChanges()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------- Init ----------

  (async () => {
    // Try cache first
    const cached = window.cacheManager?.get('magazzino');

    if (cached && cached.length > 0) {
      DATA = cached;
      renderShelves();
      loadingOverlay.classList.add('hidden');

      // Background refresh
      loadFromAPI().then(() => {
        renderShelves();
      });
      return;
    }

    // No cache, load from API
    await loadFromAPI();
    renderShelves();
    loadingOverlay.classList.add('hidden');
  })();
})();
