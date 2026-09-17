#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
converti_128kbps.py
===================

Converte i file audio in assets/audio a 128 kbps per ridurne il peso.

Supporta i formati MP3 e WAV (quelli che il browser riproduce nativamente):

  MP3 -> viene ricompresso a 128k (saltati quelli già <= 160 kbps)
  WAV -> viene convertito in MP3 a 128k e il .wav originale viene ELIMINATO

Quello che fa il programma:
  1. Cerca ffmpeg (in PATH oppure un binario statico in tools/ffmpeg)
  2. Per ogni file misura il bitrate attuale
  3. Se il brano è GIÀ piccolo (<= 160 kbps) lo salta, per non degradare
     la qualità con una doppia compressione
  4. Altrimenti lo ricomprime a 128 kbps CONSERVANDO i metadati
     (titolo, artista, copertina)
  5. Sostituisce il file originale con quello convertito (il vecchio
     file viene sovrascritto: fai una copia di sicurezza se lo vuoi)

Nota: i nomi di file che contengono "?" o "#" vengono rinominati con "_":
questi caratteri, dentro un URL, sarebbero interpretati come querystring
e il file non si troverebbe più.

Dopo la conversione rilanci:
    python3 tools/genera_playlist.py
per rigenerare playlist.json con le durate aggiornate.

Uso:
    python3 tools/converti_128kbps.py            # salta i brani già piccoli
    python3 tools/converti_128kbps.py --force    # converte TUTTI i file
"""

import os
import re
import shutil
import subprocess
import sys

# --------------------------------------------------------------------------
# PERCORSI (stessa logica di genera_playlist.py)
# --------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_DIR = os.path.join(BASE_DIR, "assets", "audio")

# Formati gestiti: MP3 e WAV
INPUT_EXTENSIONS = (".mp3", ".wav")

TARGET_BITRATE = "128k"      # bitrate desiderato (formato ffmpeg)
SKIP_IF_BELOW = 160          # kbps: i file già sotto questa soglia vengono saltati


# --------------------------------------------------------------------------
# RICERCA DI FFMPEG
# --------------------------------------------------------------------------

def find_ffmpeg():
    """Cerca il binario ffmpeg prima in tools/, poi nel PATH di sistema.

    In questo modo puoi usare un "ffmpeg statico" scaricato nella cartella
    tools senza installare nulla di più.
    """
    local = os.path.join(BASE_DIR, "tools", "ffmpeg")
    if os.path.isfile(local):
        return local
    found = shutil.which("ffmpeg")
    if found:
        return found
    return None


def detect_bitrate(ffmpeg, path):
    """Misura il bitrate di un MP3 usando ffmpeg stesso.

    ffmpeg stampa le info del file nei log: cerchiamo la voce
    "... Audio: mp3 ... 320 kb/s ..." e leggiamo la cifra.
    """
    cmd = [ffmpeg, "-hide_banner", "-i", str(path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    m = re.search(r"Audio:[^\n]*?(\d+)\s*kb/s", result.stderr)
    return int(m.group(1)) if m else None


def convert_file(ffmpeg, path):
    """Ricodifica un file audio a 128 kbps in MP3, mantenendo i metadati.

    -i input
    -map 0            prende tutti i flussi presenti (audio + eventuale copertina)
    -c:a libmp3lame -b:a 128k   ricodifica l'audio a 128 kbps
    -c:v copy         copia la copertina senza rielaborarla
    -map_metadata 0   conserva i tag del file originale

    Se il file è un WAV, la conversione produce un .mp3 con lo stesso nome
    e poi il .wav originale viene cancellato (pesano tantissimo).
    """
    # Nome finale: stessa cartella, estensione .mp3
    stem = os.path.splitext(path)[0]
    out_name = stem + ".mp3"

    # ? e # rompono gli URL (verrebbero scambiati per querystring) -> _ al loro posto
    out_name = out_name.replace("?", "_").replace("#", "_")

    tmp = out_name + ".tmp.mp3"      # file temporaneo, poi sostituiamo l'originale
    cmd = [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(path),
        "-map", "0",
        "-map_metadata", "0",
        "-c:a", "libmp3lame", "-b:a", TARGET_BITRATE,
        "-c:v", "copy",
        tmp,
    ]
    print("      [ffmpeg]", subprocess.list2cmdline(cmd))
    subprocess.run(cmd, check=True)
    os.replace(tmp, out_name)        # il convertito diventa il file definitivo

    # Se era un WAV, l'originale non serve più
    if path.lower().endswith(".wav") and os.path.exists(path):
        os.remove(path)

    return out_name


# --------------------------------------------------------------------------
# PROGRAMMA PRINCIPALE
# --------------------------------------------------------------------------

def main():
    force = "--force" in sys.argv      # converte tutto, anche i brani già piccoli

    if not os.path.isdir(AUDIO_DIR):
        print("ERRORE: cartella audio non trovata:", AUDIO_DIR)
        return

    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        print("ERRORE: ffmpeg non trovato.")
        print()
        print("Installa ffmpeg con:")
        print("    brew install ffmpeg")
        print()
        print("oppure scarica un ffmpeg statico e mettilo in tools/ffmpeg")
        print("(es. da https://evermeet.cx/ffmpeg/ per Mac Intel,")
        print("     da https://www.osxexperts.net/ per Mac Apple Silicon).")
        return

    # Tutti i file audio (mp3 e wav), anche nelle sottocartelle (album)
    files = []
    for root, _, names in os.walk(AUDIO_DIR):
        for name in sorted(names):
            if name.lower().endswith(INPUT_EXTENSIONS):
                files.append(os.path.join(root, name))

    print("Trovati", len(files), "file audio (mp3/wav).\n")

    converted = skipped = errors = 0

    for path in files:
        rel = os.path.relpath(path, AUDIO_DIR)
        print("  ->", rel, end="")

        # Se è un WAV ed esiste già un MP3 con lo stesso nome, non sovrascriverlo
        if path.lower().endswith(".wav"):
            possible = os.path.splitext(path)[0] + ".mp3"
            if os.path.exists(possible):
                print("  [esiste già", os.path.basename(possible) + ", salto]")
                skipped += 1
                continue

        bitrate = detect_bitrate(ffmpeg, path)
        if bitrate is None:
            print("  [bitrate sconosciuto, salto] ")
            skipped += 1
            continue

        print("  (" + str(bitrate) + " kbps)")

        # Salta i brani già sotto soglia, a meno di --force
        if not force and bitrate <= SKIP_IF_BELOW:
            print("      già piccolo: saltato (usa --force per convertirlo comunque)")
            skipped += 1
            continue

        try:
            convert_file(ffmpeg, path)
            converted += 1
            print("      convertito a", TARGET_BITRATE)
        except Exception as e:
            errors += 1
            print("      ERRORE:", e)
            # Pulizia del temporaneo se è rimasto a metà
            tmp = os.path.splitext(path)[0] + ".mp3.tmp.mp3"
            if os.path.exists(tmp):
                os.remove(tmp)

    print()
    print("Riepilogo:", converted, "convertiti,", skipped, "saltati,", errors, "errori.")
    print()
    print("Ora rilanci:")
    print("    python3 tools/genera_playlist.py")
    print("per rigenerare playlist.json con le nuove durate.")


if __name__ == "__main__":
    main()