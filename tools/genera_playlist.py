#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
genera_playlist.py
==================

Genera src/playlist.json a partire dai file MP3 contenuti in assets/audio.

Cosa fa il programma:
  1. Scansiona assets/audio RICORSIVAMENTE: ogni sottocartella corrisponde
     a un ALBUM (es. "assets/audio/Album 1/brano.mp3" -> album "Album 1")
  2. Legge i metadati ID3v2 (titolo TIT2, artista TPE1) con fallback su ID3v1
  3. Gestisce la copertina per ALBUM: usa un'immagine presente nella cartella
     dell'album (cover.jpg, folder.jpg, front.jpg, ...) oppure, se assente,
     l'immagine APIC della prima canzone dell'album
  4. Stima la durata approssimativa in secondi leggendo l'header del primo
     frame audio MP3 (bitrate) -> durata = byte_audio * 8 / bitrate
  5. Scrive src/playlist.json con la struttura:
     { "id", "titolo", "artista", "album", "durata", "file", "copertina" }

Requisiti: SOLO Python 3, nessuna libreria esterna.

Uso:
    python3 tools/genera_playlist.py
"""

import os
import json

# --------------------------------------------------------------------------
# PERCORSI
# --------------------------------------------------------------------------
# tools/ sta dentro /progetto: risalendo di una cartella troviamo la radice
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

AUDIO_DIR   = os.path.join(BASE_DIR, "assets", "audio")
COVERS_DIR  = os.path.join(BASE_DIR, "assets", "covers")
OUTPUT_FILE = os.path.join(BASE_DIR, "src", "playlist.json")

EXTENSIONS = (".mp3",)

# Estensioni immagine riconosciute come copertine dentro le cartelle album
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".webp")

# Nomi "parlanti" che fanno capire che un'immagine è la copertina dell'album
COVER_KEYWORDS = ("cover", "folder", "front", "copertina", "album")


# --------------------------------------------------------------------------
# TABELLE MPEG (servono per calcolare bitrate e frequenza campionamento)
# --------------------------------------------------------------------------
# Indice bitrate (0-15) -> velocità in kbps.
# La chiave è la coppia (versione MPEG, layer): 1/2/3 = Layer I/II/III
BITRATE_TABLE = {
    # MPEG 1
    (1, 1): [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
    (1, 2): [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
    (1, 3): [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
    # MPEG 2 / 2.5
    (2, 1): [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
    (2, 2): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
    (2, 3): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
}

# Frequenza di campionamento (Hz) per versione MPEG
SAMPLE_TABLE = {
    1:   [44100, 48000, 32000],
    2:   [22050, 24000, 16000],
    2.5: [11025, 12000, 8000],
}


# --------------------------------------------------------------------------
# PARSING MP3
# --------------------------------------------------------------------------

def parse_mp3_header(data, offset):
    """Cerca il primo header di un frame MP3 partendo da `offset`.

    Un frame MP3 inizia con 11 bit di sincronizzazione (11111111111):
      fallita la lettura lo cerchiamo scorrendo byte per byte.
    Restituisce (bitrate_kbps, sample_hz, posizione_header) oppure None.
    """
    while offset + 4 <= len(data):
        b = data[offset:offset + 4]

        # Sincronizzazione: 0xFF seguito da un byte che inizia con i 3 bit 111
        if b[0] == 0xFF and (b[1] & 0xE0) == 0xE0:
            # Versione MPEG: bit 3-4 del secondo byte (00=2.5, 01=riservato, 10=2, 11=1)
            ver_bits = (b[1] >> 3) & 0x03
            # Layer: bit 1-2 (01=LayerIII, 10=LayerII, 11=LayerI)
            layer_bits = (b[1] >> 1) & 0x03
            # Indici per bitrate e frequenza
            br_index = b[2] >> 4
            sr_index = (b[2] >> 2) & 0x03

            # Traduco i bit nei valori "veri"
            version = {3: 1, 2: 2, 0: 2.5}.get(ver_bits)   # MPEG 1 / 2 / 2.5
            layer   = {3: 1, 2: 2, 1: 3}.get(layer_bits)   # Layer I / II / III

            if version is None or layer is None:
                return None

            bitrate = BITRATE_TABLE.get((version, layer), [0] * 16)[br_index]
            if bitrate == 0 or sr_index == 3:               # indici invalidi
                return None

            sample = SAMPLE_TABLE.get(version, [])[sr_index]
            return bitrate, sample, offset

        offset += 1   # non era un frame valido: provo un byte più avanti

    return None


def estimate_duration(data, data_start):
    """Stima la durata in secondi: (byte_di_audio * 8) / bitrate_in_bit_al_secondo."""
    frame = parse_mp3_header(data, data_start)
    if frame is None:
        return 0
    bitrate_kbps, sample, frame_pos = frame

    audio_bytes = len(data) - frame_pos
    return int(round(audio_bytes * 8 / (bitrate_kbps * 1000)))


# --------------------------------------------------------------------------
# PARSING ID3 (metadati)
# --------------------------------------------------------------------------

def decode_syncsafe(b):
    """Decodifica un intero a 4 byte in formato "syncsafe" (7 bit utili per byte)."""
    return ((b[0] & 0x7F) << 21) | ((b[1] & 0x7F) << 14) | ((b[2] & 0x7F) << 7) | (b[3] & 0x7F)


def decode_text(raw):
    """Decodifica il contenuto di un frame testuale ID3 (es. TIT2, TPE1).

    Il primo byte indica la codifica: 0=Latin-1, 1=UTF-16 con BOM,
    2=UTF-16 senza BOM, 3=UTF-8.
    """
    if not raw:
        return None
    encoding = raw[0]
    payload = raw[1:]

    if encoding == 0:
        text = payload.decode("latin-1", "replace")
    elif encoding == 1:
        text = payload.decode("utf-16", "replace")
    elif encoding == 2:
        text = payload.decode("utf-16-be", "replace")
    else:
        text = payload.decode("utf-8", "replace")

    clean = text.replace("\x00", "").strip()   # via i null e gli spazi in eccesso
    return clean or None


def parse_apic(raw):
    """Estrae l'immagine dal frame APIC (copertina). Restituisce (dati, mime)."""
    if not raw:
        return None, None

    encoding = raw[0]
    # Il MIME è una stringa che termina con un byte nullo
    nul = raw.find(b"\x00", 1)
    if nul == -1:
        return None, None
    mime = raw[1:nul].decode("latin-1", "replace")

    # Dopo il MIME: 1 byte per il tipo di immagine e una descrizione.
    # Se la codifica è UTF-16 la descrizione finisce con 2 byte nulli.
    desc_start = nul + 2
    if encoding in (1, 2):
        term = raw.find(b"\x00\x00", desc_start)
        image_start = term + 2 if term != -1 else desc_start
    else:
        term = raw.find(b"\x00", desc_start)
        image_start = term + 1 if term != -1 else desc_start

    return raw[image_start:], mime


def read_id3(data):
    """Legge i tag ID3v2 all'inizio del file.

    Restituisce (titolo, artista, immagine, mime, offset_dopo_i_tag).
    """
    title = artist = image = mime = None

    # Se i primi 3 byte non sono "ID3", nel file non ci sono tag ID3v2
    if not data.startswith(b"ID3"):
        return title, artist, image, mime, 0

    version_major = data[3]
    version_minor = data[4]      # non usato, ma utile sapere che esiste
    flags = data[5]

    # La dimensione del blocco tag è un numero syncsafe in 4 byte
    tag_size = decode_syncsafe(data[6:10])
    end = 10 + tag_size

    pos = 10

    # Se c'è un "extended header" (flag 0x40) va saltato per raggiungere i frame
    if flags & 0x40 and version_major >= 3:
        ext_size = int.from_bytes(data[pos:pos + 4], "big")
        if version_major == 4:
            pos += ext_size               # in v2.4 la grandezza include sé stessa
        else:
            pos += 4 + ext_size           # in v2.3 la grandezza esclude i 4 byte

    # In base alla versione cambia la struttura di un frame:
    #  v2.2: id 3 byte, grandezza 3 byte, senza flag
    #  v2.3/v2.4: id 4 byte, grandezza 4 byte, flag 2 byte
    if version_major >= 3:
        id_len, size_len, flags_len = 4, 4, 2
    else:
        id_len, size_len, flags_len = 3, 3, 0

    # Nomi dei frame nelle due versioni (v2 e v2.3/v2.4)
    ids = ("TT2", "TP1", "PIC") if version_major == 2 else ("TIT2", "TPE1", "APIC")

    while pos + id_len <= end:
        frame_id = data[pos:pos + id_len].decode("latin-1", "replace")

        # Un id valido contiene solo lettere e numeri: altrimenti stop
        if not frame_id or not frame_id.isalnum():
            break

        # Grandezza del frame (in v2.4 è in formato syncsafe)
        size_bytes = data[pos + id_len:pos + id_len + size_len]
        if version_major >= 4:
            frame_size = decode_syncsafe(size_bytes)
        else:
            frame_size = int.from_bytes(size_bytes, "big")

        frame_start = pos + id_len + size_len + flags_len
        frame_data = data[frame_start:frame_start + frame_size]

        try:
            if frame_id == ids[0] and title is None:
                title = decode_text(frame_data)
            elif frame_id == ids[1] and artist is None:
                artist = decode_text(frame_data)
            elif frame_id == ids[2] and image is None:
                image, mime = parse_apic(frame_data)
        except Exception:
            pass   # un frame "strano" non deve mandare in errore tutto il file

        pos = frame_start + frame_size   # passo al frame successivo

    return title, artist, image, mime, end


def read_id3v1(data):
    """Fallback: legge i tag ID3v1 (128 byte finali del file) se presenti."""
    if len(data) < 128 or data[-128:-125] != b"TAG":
        return None, None

    tail = data[-128:]
    title_raw  = tail[3:33]
    artist_raw = tail[33:63]

    title  = title_raw.split(b"\x00")[0].decode("latin-1", "replace").strip()
    artist = artist_raw.split(b"\x00")[0].decode("latin-1", "replace").strip()

    return (title or None), (artist or None)


# --------------------------------------------------------------------------
# UTILITÀ
# --------------------------------------------------------------------------

def clean_field(value):
    """Mette in ordine un campo di testo (spazi e caratteri strani)."""
    return " ".join(value.split()) if value else ""


def sanitize_id(stem):
    """Rende il nome del file un id adatto al JSON (niente caratteri speciali)."""
    s = stem.strip()
    if not s:
        return "brano"
    for ch in ' /\\?%*:|"<>':
        s = s.replace(ch, "_")
    return s


def cover_extension(mime):
    """Sceglie l'estensione della copertina in base al tipo MIME."""
    if (mime or "").lower() == "image/png":
        return ".png"
    return ".jpg"   # default (anche per jpeg/webp, ecc.)


# --------------------------------------------------------------------------
# SUPPORTO ALBUM
# --------------------------------------------------------------------------

def scan_audio_files():
    """Scansiona assets/audio ricorsivamente.

    Ogni sottocartella viene considerata UN ALBUM.
    Restituisce una lista di tuple (album, percorso_relativo, nome_file).
    Le canzoni direttamente in assets/audio (senza cartella) hanno album = "".
    """
    results = []
    for root, dirs, files in os.walk(AUDIO_DIR):
        dirs.sort()                                # cartelle in ordine alfabetico
        rel = os.path.relpath(root, AUDIO_DIR)
        album = "" if rel == "." else rel          # nome della cartella = nome album
        for filename in sorted(files):
            if filename.lower().endswith(EXTENSIONS):
                rel_path = os.path.relpath(os.path.join(root, filename), AUDIO_DIR)
                results.append((album, rel_path, filename))
    return results


def find_album_cover(album_dir):
    """Cerca un'immagine di copertina dentro la cartella dell'album.

    Preferisce i file con nomi "parlanti" (cover, folder, front, ...);
    altrimenti usa la prima immagine trovata. Restituisce il percorso o None.
    """
    if not os.path.isdir(album_dir):
        return None
    images = [f for f in os.listdir(album_dir)
              if f.lower().endswith(IMAGE_EXTENSIONS)]
    if not images:
        return None
    for img in sorted(images):
        low = img.lower()
        if any(k in low for k in COVER_KEYWORDS):
            return os.path.join(album_dir, img)
    return os.path.join(album_dir, sorted(images)[0])


def copy_cover_file(src_file, base_name):
    """Copia un'immagine (dalla cartella album) in assets/covers.

    Restituisce il percorso relativo (es. "assets/covers/album_1.jpg").
    """
    ext = os.path.splitext(src_file)[1].lower() or ".jpg"
    cover_file = base_name + ext
    cover_full = os.path.join(COVERS_DIR, cover_file)
    if not os.path.exists(cover_full):   # se già salvata, non riscriverla
        with open(src_file, "rb") as fin, open(cover_full, "wb") as fout:
            fout.write(fin.read())
    return "assets/covers/" + cover_file


def write_cover(image_bytes, mime, base_name):
    """Salva in assets/covers i byte di un'immagine estratta dai tag ID3."""
    cover_file = base_name + cover_extension(mime)
    cover_full = os.path.join(COVERS_DIR, cover_file)
    if not os.path.exists(cover_full):
        with open(cover_full, "wb") as f:
            f.write(image_bytes)
    return "assets/covers/" + cover_file


def get_album_cover(album, first_image, first_mime):
    """Determina la copertina di un album (una sola per tutte le canzoni).

    Priorità:
      1) un file immagine presente nella cartella dell'album;
      2) l'immagine APIC della prima canzone dell'album (se trovata);
      3) nessuna copertina (stringa vuota).
    """
    found = find_album_cover(os.path.join(AUDIO_DIR, album))
    if found:
        return copy_cover_file(found, sanitize_id(album))
    if first_image:
        return write_cover(first_image, first_mime, sanitize_id(album))
    return ""


# --------------------------------------------------------------------------
# PROGRAMMA PRINCIPALE
# --------------------------------------------------------------------------

def main():
    if not os.path.isdir(AUDIO_DIR):
        print("ERRORE: cartella audio non trovata:", AUDIO_DIR)
        print("Crea la cartella assets/audio e mettici dentro gli MP3.")
        return

    os.makedirs(COVERS_DIR, exist_ok=True)

    # Scansione ricorsiva: ogni sottocartella di assets/audio = un album
    files = scan_audio_files()
    print("Trovati", len(files), "file MP3.\n")

    playlist = []
    used_ids = set()
    album_covers = {}   # cache: nome album -> percorso copertina (calcolata 1 sola volta)

    for album, rel_path, filename in files:
        path = os.path.join(AUDIO_DIR, rel_path)
        print("  ->", rel_path, end="")

        with open(path, "rb") as f:
            data = f.read()

        # 1) Leggo i metadati ID3v2
        title, artist, image, mime, tag_end = read_id3(data)

        # 2) Fallback ID3v1 se manca qualcosa
        if not title or not artist:
            t1, a1 = read_id3v1(data)
            title = title or t1
            artist = artist or a1

        # 3) Id univoco basato sul nome del file
        stem = os.path.splitext(filename)[0]
        song_id = sanitize_id(stem)
        if song_id in used_ids:
            n = 2
            while f"{song_id}_{n}" in used_ids:
                n += 1
            song_id = f"{song_id}_{n}"
        used_ids.add(song_id)

        # 4) Copertina
        #    - canzone dentro un album -> UNA copertina per l'intero album
        #      (immagine nella cartella oppure APIC della prima canzone);
        #    - canzone "sparsa" (senza cartella) -> usa il suo APIC personale.
        cover_path = ""
        if album:
            if album not in album_covers:
                album_covers[album] = get_album_cover(album, image, mime)
            cover_path = album_covers[album]
        elif image:
            cover_path = write_cover(image, mime, song_id)
            print(" [copertina OK]", end="")

        # 5) Durata approssimata: i byte dopo i tag divisi per il bitrate
        duration = estimate_duration(data, tag_end)

        # 6) Voce della playlist
        playlist.append({
            "id": song_id,
            "titolo": clean_field(title) or stem,               # se manca il titolo uso il nome file
            "artista": clean_field(artist) or "Artista sconosciuto",
            "album": clean_field(album),
            "durata": duration,
            "file": "assets/audio/" + rel_path.replace(os.sep, "/"),
            "copertina": cover_path,
        })
        print(" OK")

    # Ordino per album (le canzoni "libere" senza album vanno in fondo),
    # poi per titolo dentro ogni album.
    playlist.sort(key=lambda s: (s["album"] == "", s["album"].lower(), s["titolo"].lower()))

    # Scrivo il JSON (ensure_ascii=False per conservare gli accenti)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(json.dumps(playlist, ensure_ascii=False, indent=2))
        f.write("\n")

    n_albums = len({s["album"] for s in playlist if s["album"]})
    print("\nFatto! Scritto", OUTPUT_FILE, "con", len(playlist), "canzoni e", n_albums, "album.")


if __name__ == "__main__":
    main()