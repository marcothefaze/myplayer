# MyPlayer — Player musicale personale

Web app "stile Spotify" semplificata che riproduce i **tuoi** file MP3,
presenti in locale. Nessuno streaming: tutto funziona **offline**.

---

## Struttura del progetto

```
progetto/
├── assets/
│   ├── audio/      <- qui vanno i file MP3 (una cartella per ALBUM)
│   └── covers/     <- copertine salvate automaticamente dallo script
├── src/
│   ├── index.html  <- pagina principale
│   ├── style.css   <- stile (dark theme, responsive)
│   ├── player.js   <- logica del player (commentata in italiano)
│   └── playlist.json <- elenco canzoni letto dall'app
├── tools/
│   └── genera_playlist.py  <- genera playlist.json dagli MP3
└── README.md
```

Formato di ogni voce di `playlist.json`:

```json
{
  "id": "nome_file",
  "titolo": "Titolo della canzone",
  "artista": "Nome artista",
  "album": "Nome dell'album",
  "durata": 205,
  "file": "assets/audio/Album 1/brano.mp3",
  "copertina": "assets/covers/nome_album.jpg"
}
```

- `durata` è espressa in **secondi** (numero), convertita in `m:ss` dall'interfaccia.
- `album` è il nome della cartella di provenienza (vuoto `""` se la canzone è
  "sparsa" senza cartella).
- `copertina` può essere una stringa vuota: l'app mostrerà un segnaposto.

---

## Come aggiungere gli album (in 3 passi)

1. **Copia ogni album nella propria cartella** dentro `assets/audio/`:

   ```
   assets/audio/
   ├── Album 1/
   │   ├── 01_Intro.mp3
   │   └── 02_Canzone.mp3
   ├── Album 2/
   │   ├── 01_Tracce.mp3
   │   └── cover.jpg
   └── brano_sparso.mp3          <- senza cartella = "Senza album"
   ```

   A ogni cartella corrisponde un album: l'app mostrerà una **intestazione
   con il nome della cartella** e sotto le canzoni.

2. **Copertina album (facoltativa ma consigliata)**: metti un'immagine
   dentro la cartella dell'album (es. `cover.jpg`, `folder.jpg`, `front.jpg`
   oppure qualsiasi file immagine). Lo script la userà come copertina
   di tutto l'album. Se non c'è un'immagine, usa quella dei tag ID3 della
   prima canzone; se non c'è nemmeno quella, l'app mostra un segnaposto.

3. **Avvia lo script** dalla cartella del progetto:

   ```bash
   python3 tools/genera_playlist.py
   ```

   Lo script scansiona le cartelle, legge i metadati ID3 (titolo, artista),
   salva le copertine in `assets/covers/` e rigenera `src/playlist.json`.
   Nessuna libreria esterna: serve solo Python 3.

4. **Apri la pagina** (vedi sotto). Ogni volta che aggiungi o togli file,
   rilanci lo script per rigenerare la lista.

---

## Ridurre il peso dei file (128 kbps)

Se i tuoi MP3 pesano troppo (es. per caricarli su GitHub), puoi
ricomprimerli a 128 kbps con:

```bash
python3 tools/converti_128kbps.py          # salta i brani già sotto i 160 kbps
python3 tools/converti_128kbps.py --force  # converte proprio tutti
```

- Nella cartella `tools/` c'è già un ffmpeg statico per Mac con CPU Apple
  Silicon: lo script lo usa automaticamente (ne basta uno, non si installa nulla).
  Se invece hai ffmpeg già nel PATH, viene usato quello.
- Titolo, artista e copertina vengono **conservati**.
- Dopo la conversione rilanci `python3 tools/genera_playlist.py`.

> Suggerimento: se uno MP3 non ha i tag ID3, lo script usa il nome del file
> come titolo e mette "Artista sconosciuto" come artista.

---

## Avvio dell'app

L'app **non** funziona aprendo `index.html` con un doppio click: i browser
bloccano il caricamento di `playlist.json` via `file://`. Serve un piccolo
server locale (pochi secondi):

```bash
cd progetto
python3 -m http.server 8000
```

Poi apri nel browser: <http://localhost:8000/src/>

---

## Funzionalità

- Lista canzoni letta da `playlist.json` e creata dinamicamente.
- Canzoni **raggruppate per album** (una cartella in `assets/audio/` = un album):
  intestazione con nome dell'album, copertina e numero di canzoni.
- Click su una canzone = play, riga evidenziata, avanzamento automatico.
- Controlli: play/pausa, precedente, successiva.
- Barra di progresso **cliccabile** (seek) + slider del volume.
- Barra spaziatrice = play/pausa (bonus).
- Dark theme, responsive: su mobile la sidebar sparisce e il player si impila.

---

## Note tecniche

- **Durata "approssimata"**: lo script la calcola dividendo i byte audio per
  il bitrate del primo frame. Non è identica a quella reale al secondo,
  ma l'app la corregge da sola appena il browser carica i metadati del file.
- **Riproduzione automatica**: i browser bloccano l'autoplay senza un click
  dell'utente. Qui si parte sempre da un click, quindi nessun problema.
- **Offline**: una volta servita dal server locale, l'app non fa alcuna
  richiesta verso internet (solo il fetch locale di `playlist.json`).