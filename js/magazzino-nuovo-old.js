// API Endpoint
const API_URL = 'https://script.google.com/macros/s/AKfycbyp2a0ue4xesDlzfRWsaXrkPZxVgzk175a7ld5UQaVrdP-UD6s06MSP8JtnzjTsW9R9/exec';

// Elementi DOM
const formNuovo = document.getElementById('form-nuovo');
const codiceInput = document.getElementById('codice');
const descrizioneInput = document.getElementById('descrizione');
const scaffaleInput = document.getElementById('scaffale');
const btnAnnulla = document.getElementById('btn-annulla');

const popupConferma = document.getElementById('popup-conferma');
const popupRiepilogo = document.getElementById('popup-riepilogo');
const popupAnnullaConferma = document.getElementById('popup-annulla-conferma');
const popupConfermaSalva = document.getElementById('popup-conferma-salva');

const loadingOverlay = document.getElementById('loading-overlay');

// Init
loadingOverlay.classList.add('hidden');

// Event listeners
btnAnnulla.addEventListener('click', () => {
  window.location.href = '/private.html';
});

formNuovo.addEventListener('submit', handleSubmit);
popupAnnullaConferma.addEventListener('click', () => popupConferma.classList.add('hidden'));

// Handle submit
function handleSubmit(e) {
  e.preventDefault();

  const dati = {
    codice: codiceInput.value.trim(),
    descrizione: descrizioneInput.value.trim(),
    scaffale: scaffaleInput.value.trim()
  };

  // Mostra popup conferma
  popupRiepilogo.innerHTML = `
    <p><strong>Codice:</strong> ${dati.codice}</p>
    <p><strong>Descrizione:</strong> ${dati.descrizione}</p>
    <p><strong>Scaffale:</strong> ${dati.scaffale}</p>
  `;

  popupConferma.classList.remove('hidden');

  // Salva dati per conferma
  popupConfermaSalva.onclick = () => salvaRicambio(dati);
}

// Salva ricambio
async function salvaRicambio(dati) {
  popupConfermaSalva.disabled = true;
  popupConfermaSalva.textContent = 'Salvataggio...';

  try {
    const res = await fetch(`${API_URL}?action=addRicambio`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'addRicambio',
        codice: dati.codice,
        descrizione: dati.descrizione,
        scaffale: dati.scaffale
      })
    });

    const result = await res.json();

    if (result.success) {
      popupConferma.classList.add('hidden');
      alert('Ricambio aggiunto con successo!');

      // Reset form per nuovo inserimento
      formNuovo.reset();
      codiceInput.focus();

      popupConfermaSalva.disabled = false;
      popupConfermaSalva.textContent = 'Conferma';
    } else {
      alert('Errore: ' + (result.error || 'Errore sconosciuto'));
      popupConfermaSalva.disabled = false;
      popupConfermaSalva.textContent = 'Conferma';
    }
  } catch (err) {
    alert('Errore di connessione: ' + err.message);
    popupConfermaSalva.disabled = false;
    popupConfermaSalva.textContent = 'Conferma';
  }
}
