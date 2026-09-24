# AGENTS.md — istruzioni per opencode

## Regole del progetto (richieste da Marco)

- **Dopo OGNI modifica al codice: fare SEMPRE commit e push** senza chiedere
  il permesso. Il messaggio di commit segue lo stile esistente:
  `vNN: descrizione breve delle modifiche` (vNN progressivo, es. v55).
- Le chat passate di opencode si perdono: questo file è il promemoria
  persistente delle preferenze.

## Note tecniche utili

- App web/PWA statica in `/src` (index.html + player.js + style.css +
  playlist.json), servita da un server locale (`python3 -m http.server`).
- `node` NON è installato: per verificare la sintassi JS usare JavaScriptCore
  (`osascript -l JavaScript`), per il CSS basta il conteggio delle graffe.
- A ogni release bumpare: `?v=N` di style.css/player.js in index.html e
  `APP_VERSION` in player.js (per playlist.json).
- Il video di "Goleador" (TRACK_VIDEOS in player.js) richiede che il titolo
  del brano resti "Goleador".
- Ordine album home: ALBUM_ORDER in player.js, guidato dai nomi album esatti
  in playlist.json ("Non è SSG" è il primo, con è accentata).
