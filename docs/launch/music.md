# Eos launch score: r31 reference

The final music for the Eos launch video (picture cut "A5"). This document describes exactly what is in the file, how it was made, how to reproduce it, and what the user likes and dislikes, so the score can be studied, rebuilt or adapted later.

All numbers are measured from the delivered file or read out of the script that renders it, unless they're marked as picture timings. Picture timings come from the coordinator's briefs.

---

> **Picture timings in the final cut (A5) differ from the briefs quoted in the Picture column below.** In A5: Claude Code fades in at 1.9 s and typing starts at 2.75 s; the 22.0 click opens Export (the share menu) from the old-version view, with no "Back to latest"; the push-out runs 23.47–25.07 (1.5× → 1×) after a pan right at 20.6–21.7; the 25.4 click is Back to the library. The music is exactly as described. See `README.md` (in the repo) or the skill's storyboard for the A5 picture.

## 1. Identity

| | |
|---|---|
| File | `scratchpad/ideas-c/r31-rewind-90-29s-back-at-25s4-loop.wav` |
| Checksums | MD5 `9067adf4f7d3fc73463d2f7c5ef33266`, SHA-256 `27ed4a0a970ed5a5d1125b9e41d03e890708e8f59218fb1fda34822fba6e2175` |
| Format | WAV, 16-bit PCM, stereo, 48 000 Hz |
| Length | 1 408 000 samples = **29.333 s** (88/3 s) |
| Tempo / grid | **90 BPM**, 4/4. One bar = 2.667 s (8/3 s), one beat = 0.667 s, one sixteenth = 0.1667 s |
| Bars | **11** (bars 0–10) |
| Key | **D major**. The loop starts and ends on Dmaj9; the colour moment is Amaj9 (a lift to V with a major 7th) |
| Integrated loudness | **-12.76 LUFS** (BS.1770, measured around the loop) |
| Loudness range | **1.75 LU** (EBU R128 LRA). Short-term max -11.78 LUFS, momentary max -10.23 LUFS |
| Peak | sample peak **-1.20 dBFS**, true peak **-1.20 dBTP** (4× oversampled) |
| RMS | -13.41 dBFS. DC offset 0.00000 |
| Stereo | side/mid -8.9 dB. L/R correlation 0.773 (a fairly narrow, centred image; width only on the pad, the box notes and the ladder) |
| Spectral balance (share of total power) | <60 Hz -4.7 dB · 60–120 Hz -4.3 · 120–250 -8.2 · 250–500 -10.0 · 500–1100 -14.4 · 1.1–3 kHz -26.2 · above 3 kHz -78 dB |
| Spectral centroid | **139 Hz**: bass-led and very dark, because of the 1.1 kHz "blanket" master |
| Level per bar (RMS dBFS, bars 0–10) | -14.5, -14.5, -14.1, -13.4, -14.3, -13.5, -12.8, -15.3, -15.6, -12.8, -13.4 |
| Noise texture | spectral flatness in 250–1100 Hz: 0.213 (25 ms frames) and 0.070 (100 ms frames). Saturation (intermodulation) products 24.1 dB below the mix |

**How it loops seamlessly.** Every part is rendered over three back-to-back passes of the loop (3 × 29.333 s). Notes, echoes and reverb tails that run past the end of one pass land at the start of the next, and only the middle pass is kept. The master "blanket" stage then runs on that middle pass tiled three times, and again keeps the middle. So the end of the file flows into its start exactly as it would if the music kept going.
- The jump between the last and first sample is 0.0064, against a median step of 0.0034 between neighbouring samples (99th percentile 0.022), so the seam is inaudible.
- Musically, the held bar ends on a long D2 under Dmaj9, which rings across the seam into bar 0's Dmaj9 (D into D).

---

## 2. Bar-by-bar map

Chords are listed with their bass root and the four-note pad voicing. "Picture" is what the video shows, as given in the coordinator's briefs.

| Bar | Time (s) | Chord: root, pad voicing | Music | Picture |
|---|---|---|---|---|
| 0 | 0.000–2.667 | **Dmaj9**: D2, F#3 A3 C#4 E4 | Light groove: bass lead at -1.4 dB, kick on 1 and the "and" of 3, softer snare on 2 and 4. A backwards chord swell lands on 0.000. | The library. The Claude Code window fades in 0.6–1.1. |
| 1 | 2.667–5.333 | Dmaj9 (continues) | Light groove; swell into 2.667. **Click bloop at 2.600** (D3). | 2.6: click into the terminal; typing 3.0–4.4; Enter 4.8. |
| 2 | 5.333–8.000 | **Bm11**: B1, F#3 A3 D4 E4 | Full groove (three kicks per bar). **The eight reversed box notes**, one per eighth note: 5.333 … 7.667. | The agent builds the diagram; one box per eighth note. |
| 3 | 8.000–10.667 | **Gmaj9**: G1, F#3 A3 B3 D4 | Full groove (bass at -1.4 dB, because G1 is a low root). | Diagram complete. Typing "give it a dawn palette" 10.9–12.0. |
| 4 | 10.667–13.333 | **E9sus**: E2, D3 A3 B3 E4 | The "hole" bar: kick on 1, snare on 2 only, and the bass rests on beat 4, then climbs **E2 F#2 G#2** (12.667, 12.833, 13.000). A reversed **B4+E5** dyad answers the request at 10.667. The long reversed **wash** chord rises from about 10.7. | Enter 12.6. |
| 5 | 13.333–16.000 | **Amaj9**: A1, G#3 C#4 E4 B4 | **THE COLOUR WASH lands at 13.333.** The pad opens from 1100 to 2600 Hz and steps up to 1.6× level; a forward bloom chord follows; the bass filter is at its most open. | 13.333: dawn-palette colour crossfade (0.3 s). Typing 14.05–15.25; Enter 15.55. |
| 6 | 16.000–18.667 | **Gmaj9** | Full groove; swell into 16.000. | 16.0: the flowchart turns into a sequence diagram (0.35 s crossfade). |
| 7 | 18.667–21.333 | **Bm11** | Light groove. The pad goes **grey** from 20.267 (filter closes to 750 Hz, level 0.85); bass, kick and snare play quieter and darker from the 3rd beat. **Clicks at 19.267 (B2) and 20.267 (F#2).** Phrase reference: the first four box notes **backwards and an octave down** (E4 19.333, D4 20.000, B3 20.667, A3 21.333). | Push-in 18.667–20.067; Claude fades out 18.667–19.167. 19.267: Version history. 20.267: the oldest entry; the diagram goes grey. |
| 8 | 21.333–24.000 | Bm11, then **Amaj9 from 22.000** | Grey until 22.0. **Click at 22.000 (A2)**: a small reversed Amaj9 "echo of the wash" lands, the pad reopens to 1900 Hz, and the box phrase's E–F# turn, a fourth lower, sounds (C#5 22.000, B4 22.667, C#5 23.000). The bar breathes on its last beat (no bass, no 2nd snare). **THE STOP** follows: the whole band falls to -20 dB over 23.30–23.36 and stays down until 23.988; only a low, warm **inhale** (G2 D3 G3) swells into 24.0. | 22.0: Back to latest; colour returns. The pull-back runs 22.667–26.067 (ease-in-out cubic, 1.22× → 1×). |
| 9 | 24.000–26.667 | **Gmaj9** | **THE SNAP at 24.000**: the band slams back in. A round sub hit on G2 (with a phone-safe upper octave), and the bass lead wide open (filter ×2.2, +1.2 dB). A **ladder** of seven Gmaj9 tones follows the pull-back: 24.000 G2, 24.201 B2, 24.360 D3, 24.516 F#3, 24.712 A3, 24.992 B3, 26.067 D4. The pad opens to 2300–2500 Hz. **Click at 25.400 (G2).** | 24.0: snap. The cursor reaches Back as the push-out completes (about 25.07), rests, and clicks at 25.4, returning to the library. |
| 10 | 26.667–29.333 | **A9sus** (A1: G3 B3 D4 E4) to 28.000, then **Dmaj9** | The **held bar ("move")**: no snare, kick on 1. A soft reversed dyad F#4+A4 (a phrase reference) lands at 26.667. The bass holds A1, then **the four-note climb A1 27.500, B1 27.667, C#2 27.833 and the long, accented D2 at 28.000**, with a light kick and a small backwards Dmaj9 swell. The D rings through the seam into bar 0's Dmaj9. The pad closes from 2500 Hz (27.4) to 920 Hz (29.25) for the loop. | 26.067–28.9: the held shot of the whole Eos window. 28.933–29.333: crossfade back to the opening library. |

---

## 3. Every voice and sound

Note numbers are MIDI (A4 = 69 = 440 Hz). Every voice is generated with numpy/scipy oscillators that cancel their own aliasing, rather than from samples.

### The building block: `warm_voice(note, length, bright)`
Two sawtooths detuned by ±6 cents (averaged), plus 0.5 × a square wave with 30% pulse width, then a 2nd-order Butterworth low-pass at `bright` Hz. Every pad, swell, box note, wash, reference note and ladder note is built from this voice.

### Pad bed
- **Notes:** four voices per chord (the voicings in §2): `warm_voice(·, ·, 900)`, ADSR 0.25 / 0.5 / 0.8 / 0.8 s, gain 0.09 each, panned -0.5 / -0.17 / +0.17 / +0.5.
- **Filter:** the whole bed goes through a time-varying resonant low-pass (Q 0.8) that follows `PAD_CUT` (Hz):
  - 0 → 900, 5.333 → 950
  - 13.233 → 1100, **13.333 → 2600** (the wash)
  - 19.167 → 1700, 20.217 → 1600, **20.417 → 750** (grey), 21.92 → 800, **22.0 → 1900**
  - 23.25 → 1500, 23.36 → 700, 23.98 → 800, 24.0 → 1000
  - 25.7 → 2300, 26.6 → 2400, 27.4 → 2500, 28.3 → 2000, 29.25 → 920
- **Level:** `PAD_GAIN` (×): 1.0 · 13.233 0.8 · **13.333 1.6** · 19.167 1.3 · 20.217 1.25 · 20.417 0.85 · 21.92 0.9 · 22.0 1.35 · 23.25 1.2 · 23.98 1.0 · 24.0 1.3 · 25.7 1.45 · 27.4 1.5 · 28.3 1.3 · 29.25 1.0.
- **Mix:** 30% wet reverb, × kick pump, × 0.8.
- **Kick pump:** a sidechain-style dip to 0.55 on each kick, recovering to 1.0 over 180 ms.

### Reversed chord swells ("swells")
- **How they're made:** the upper three notes of the chord that is about to start, an octave up, rendered as a soft chord with 60% reverb and a **40 ms attack**, then played backwards. They rise over about 1.6 s and stop dead on the downbeat, with a 6 ms cut.
- **Where:** they land at 0.000, 2.667 (gain 0.48), 5.333, 8.000, 10.667, 16.000 (0.55), 18.667, 24.000 (0.48), plus a 0.25 one into 28.000.
- **Mix:** mixed at (0.6 + 0.4 × pump).

### The eight box notes (the score's signature)
- **Pitches:** **A4 B4 D5 E5 F#5 E5 F#5 A5**, a D-major-pentatonic climb with a little E–F# turn.
- **Timing:** **5.333, 5.667, 6.000, 6.333, 6.667, 7.000, 7.333, 7.667**, one per box. They are heard in full once only.
- **How each is made:** a single note, `warm_voice(·, ·, 2200)`, with a 5 ms attack and 75% reverb, played backwards, so it sucks in and lands exactly on its box. 0.95 s rise; measured landing within 0–5 ms of each box.
- **Mix:** gain 0.5, panned from +0.5 (first) to -0.48 (last), then through the ping-pong echo (dotted eighth, 0.5 s) and 20% reverb.

### The colour wash (13.333)
- **The wash:** an Amaj9 voicing plus E5 and A5, as one long reversed chord: 2.0 s plus 0.6 s rise, `bright` 2600, **60 ms attack, 45% reverb**. It's shaped with a ^2.5 curve so it builds late, and is level-matched to the original. It lands at 13.333.
- **The bloom:** a forward Amaj9+E5 chord (`bright` 2400, 3.5 s, gain 0.34) starts on the same downbeat.
- **The rest of the band:** the pad opens and the bass filter peaks at the same moment.

### Phrase references (never the box phrase itself)
- **Answer to "dawn palette"** (10.667): a reversed **B4+E5** dyad, gain 0.36.
- **Version history** (19.333, 20.000, 20.667, 21.333): **E4 D4 B3 A3**, the first four box notes backwards and an octave down. They're sung by the pad's own forward voice (`bright` 900, ADSR 0.12 / 0.4 / 0.75 / 0.6, gain 0.12), low inside the Bm11 bed.
- **Back to latest** (22.000, 22.667, 23.000): **C#5 B4 C#5**, the box phrase's E–F# turn a fourth lower, long-short-long, in the same pad voice inside the returning Amaj9. A small reversed Amaj9+E5 "echo of the wash" (1.2 s, gain 0.405) lands with it at 22.0.
- **Into the held bar** (26.667): **F#4+A4** (the phrase's last two notes) stacked as one soft reversed dyad an octave down, gain 0.26.
- **Level:** the references sit 12–18 dB under the mix, inside the texture.
- **The old "star" figure** (a reversed C#5+E5 dyad) is not in r31.

### The bass lead ("gritty but round")
- **Oscillators:** each note is 0.6 × saw + 0.5 × square (45% pulse width) + 0.6 × sine at the note.
- **Filter:** a resonant low-pass (Q 1.6) with cutoff `(180 + 900·accent·e^(-18t)) × BASS_OPEN` Hz, updated every 64 samples. So each note opens bright and closes to about 180–400 Hz within about 100 ms.
- **Envelope:** 4 ms attack, a hold for the note length, then a 60 ms linear release.
- **Drive (the grit):** `tanh(1.5·u)/tanh(1.5)` on `u = 1.4·filtered·envelope`.
- **Sub:** 0.55 × a sine one octave below, added after the drive.
- **Level:** gain 0.22 × 1.35 × the bar's level (0.85 in the person's "light" bars, 1.0 in "full" bars, 1.15 in the reveal bar).
- **Pattern** (sixteenth; interval; length in sixteenths):
  - (0; root; 3), (3; octave; 1), (4; root; 2), (6; 5th; 1), (8; root; 2), (10; octave; 1), (11; ♭7 over B and E, 6th elsewhere; 1), (14; root; 2)
  - odd sixteenths come 12 ms late (swing)
  - accent 1.0 on beats, 0.6 off them
  - note length = written length × 0.85
- **`BASS_OPEN`** (filter multiplier): 0 → 1.0 · 13.333 **1.7** · 18.667 1.35 · 22.0 1.3 · 23.6 1.25 · 24.0 **2.2** · 25.4 1.7 · 26.6 1.3 · 29.3 1.0. Grey bars are multiplied by 0.7 (and 0.6× level).
- **Climb into the wash:** E2 12.667, F#2 12.833, G#2 13.000 (0.16 s each, gain 0.17 × 1.35).
- **Snap sub hit** (24.000): a sine that falls from G3 onto **G2** (frequency ×(1 + e^(-30t))), plus 0.35 × a soft-saturated 2nd harmonic. 6 ms attack, e^(-1.9t) decay, 1.8 s, gain 0.42.
- **Held bar:**
  - **A1** 26.667, held 0.753 s, decaying e^(-0.35t)
  - climb **A1 27.500, B1 27.667, C#2 27.833**: 0.10 s each, accent 0.9, filter ×1.1, gain 0.2 × 1.35
  - **D2 28.000**: held to the seam (1.263 s), accent 1.5, filter ×1.5, gain ×1.7 (+4.6 dB), slow e^(-0.3t) settle
  - measured: the D is +3.2 dB above the climb notes on the bass alone, and still sounding at 28.85–28.93 (1.7 dB under its start)

### Drums (no hi-hats, no shaker)
- **Kick:** a sine sweeping 130 → 50 Hz (e^(-35t)), e^(-9t) decay, low-passed at 700 Hz, 0.4 s. Gain 0.5 on the downbeat, 0.35 elsewhere.
- **Snare (r22c2's cleaner version):** band-passed noise (400–2500 Hz, e^(-22t)) × 0.5 plus a 200 Hz sine body (e^(-28t)) × 0.55, low-passed at 3 kHz, 5 ms attack. Gain 0.24 × 0.8 × the bar's snare level (0.7 in light bars).
- **Patterns** (sixteenths within the bar):

  | Bar type | Kick | Snare | Bars |
  |---|---|---|---|
  | light (the person's sections) | 0, 10 | 4, 12 | 0, 1, 7 |
  | full (the agent's sections) | 0, 7, 10 | 4, 12 | 2, 3, 5, 6, 9 |
  | hole (before the wash) | 0 | 4 | 4 |
  | grey / breath | 0, 7 | 4 | 8 |
  | held | 0 (26.667, 0.5) and 28.000 (0.28) | — | 10 |

  - Bar 7 plays its sixteenths 10–15 dimmed (0.6, darker).
  - Bar 8 plays sixteenths 0–3 dimmed and drops its bass on beat 4.
- **Mix:** drums get 12% reverb.

### The stop and the snap (23.36 → 24.0)
- **The stop:** a master envelope on the whole band (everything except the inhale): 1.0 to 23.30, down to **0.1 (-20 dB) at 23.36**, held to 23.988, back to 1.0 at 24.000. Measured: the stop beat is 9.4 dB below the 1.3 s before it.
- **The inhale:** G2 D3 G3 in the warm voice, about 1.2 s long, with a low-pass sweeping 250 → 900 Hz and a ^3.5 rise. It has no reverb before it is reversed, so there's no whoosh; there's 15% forward room. Gain 1.1 × 0.38. It lands dead at 24.000.
- **The snap:** at 24.000 everything comes back at once, with the sub hit and the bass lead wide open. Measured: +12.8 dB in the 0.5 s after 24.0 against the stop beat, and +16 dB below 120 Hz. Loudest point 24.118.

### Click bloops (r31: five)
- **Sound:** a dull, low triangle plus 0.35 × a sine an octave below. It glides down into its note (frequency ×(1 + 0.5·e^(-t/20 ms))), with a 4 ms attack, a 60 ms decay time constant and a 20 ms end fade, low-passed at 700 Hz (4th order), 0.25 s long. Gain 0.10, 22% room. No bit-crushing.

  | Time | Note | Chord under it | Picture | Level under the mix |
  |---|---|---|---|---|
  | 2.600 | D3 | Dmaj9 | click into the terminal | -10.9 dB |
  | 19.267 | B2 | Bm11 | Version history | -11.6 dB |
  | 20.267 | F#2 (deeper glide, ×1.8) | Bm11 | oldest entry, the diagram goes grey | -9.3 dB |
  | 22.000 | A2 | Amaj9 | Back to latest | -11.2 dB |
  | 25.400 | G2 | Gmaj9 | Back to the library (after the push-out) | -11.2 dB |

### Ducking
- **Under each click:** the music (not the click itself) dips to **0.85**. It falls from t − 5 ms to t + 30 ms, holds to t + 180 ms, and recovers by t + 500 ms.
- **Elsewhere:** there is no other ducking in the subtle level; the pad-only duck under the ladder belongs to the "present" level, which was not used.

### The motion-following ladder (24.000–26.067)
- **Notes:** seven Gmaj9 tones, **G2 B2 D3 F#3 A3 B3 D4**.
- **Timing:** one per equal step of the camera's ease-in-out cubic radius, from the snap (24.0, where the radius is already 0.24) to the end of the pull-back (26.067). So they're densest right after the hit, where the camera moves fastest, then settle: 24.000, 24.201, 24.360, 24.516, 24.712, 24.992, 26.067.
- **Sound:** `warm_voice(·, 0.7 s, 700 + 500·p)`, with a 6 ms attack and a 0.22 s decay. Gain 0.05 × (0.8 + 0.3·sin πp), panned alternately ±(0.1 + 0.7p), so the image widens as the window is revealed.
- **Level:** 15 dB under the mix.

### The phone-safe octave on the snap's sub
- **Sound:** `tanh(2.5 × sub hit)`, band-passed 160–800 Hz. That's harmonics of a sine, with no noise, so small speakers still hear the drop.
- **Level:** gain 0.42 × 0.25.

---

## 4. Processing chain

1. **Mix, built in this order:**
   1. pad × 30% reverb × pump × 0.8
   2. \+ swells × (0.6 + 0.4·pump)
   3. \+ (box notes, wash, hooks, references, echo, dyad) through the ping-pong echo (0.5 s, feedback 0.3, mix 0.25, damped at 2 kHz) and 20% reverb
   4. \+ bass lead
   5. \+ drums × 12% reverb
   6. × the stop envelope, + the inhale
   7. × the click ducking, + clicks, ladder and phone octave (22% reverb)

   The reverb throughout is a 2.2 s exponentially decaying noise impulse response, damped at 3.8 kHz (seed 11).
2. **Mix saturation (r22c2's gentle version):** `2.78 · tanh(1.0·x) / 1.0`. That's the same small-signal gain as the original `tanh(2.56x)/tanh(1.6)`, with a much softer curve. It cut the intermodulation "static" from 13.5 dB to 24 dB below the mix.
3. **Clean-up:** remove DC, then a 7 kHz low-pass and a 28 Hz high-pass (2nd order).
4. **Into the blanket:** × k1 = 0.465697 and rounded to the 16-bit grid. (The constants k1, the blanket threshold reference 0.965287, and the DC means are stored in `ideas-c/r21-master.json`.)
5. **The r11 "blanket" master,** run on the loop tiled three times:
   1. a **4th-order Butterworth low-pass at 1.1 kHz** (24 dB/oct)
   2. a **low shelf +2 dB at 180 Hz**
   3. **envelope compression:** peak envelope with a 10 ms smoothing, threshold -16 dB re 0.965287, ratio 2.5. It rounds off kick, snare and bass attacks.
   4. **a short dark room:** a 1.2 s impulse response, damped at 1.5 kHz, mixed as 0.9 dry + 0.12 wet
   5. a 28 Hz high-pass
6. **Output:** × gain 0.9925698693244943 (r26c1m-b's level, kept fixed since). Then a transparent look-ahead gain limiter: 4 ms attack, 80 ms hold and release, no waveshaping, at most -0.50 dB, ceiling -1.2 dBFS. Then to 16-bit.

**The r22 noise/static fixes** (the user asked "reduce white noise … is that wash? … or static"). Measured in context by removing parts one at a time:
- **The source:** mostly the reversed reverbs. Each note's 5 ms attack was a broadband burst that excited the noise-based reverb, and backwards that becomes a whoosh. Then the mix softclip's intermodulation.
- **The bass lead was clean:** -70 dB between its harmonics.
- **The fixes:**
  - 40–60 ms attacks and less reverb on the swells and wash
  - a reverb-free tonal inhale
  - a less noisy snare
  - the gentle mix saturation
  - the box notes were left untouched
- **The result:** flatness fell 13% across the loop (34% at 100 ms frames) and about 50% in the inhale, while the loudness was held.

---

## 5. History, r10 → r31

The earlier history (the 120 BPM groove "c2 Rewind groove", reversed notes, no white noise, slower tempo, no shaker) is in `ideas-c/notes.md` and `kit/FEEDBACK.md`.

| Round | What the user said | What changed |
|---|---|---|
| r10 | "i like the grittyness of rewind bass leads, and i like the hook / homage of the melody foreshadowed in early parts" | Bass lead (sub octave, filter opening into the wash) plus a returning two-note hook. The 90 BPM "blend" became the base. |
| r11 | "i like bass lead, round" / "can we make the track come through a blanket / swimming pool?" | The **blanket** master (1.1 kHz, 24 dB/oct, rounded attacks, short dark room). r11c1 was rated **love**. |
| r12–r13 | "no its the 8 note thing…" | Tests of which phrase is "the melody": the eight box notes. |
| r14 | 32 s cut: "the magic is definitely lost, the box notes were special but repeating them loses the magic, i think we need subtle referencing and new voicing" | Rule: the box notes play once; elsewhere only subtle references. |
| r15 | "delete is not sexy, maybe focus on these features: the library, web mcp, version panel" | 24 s timeline (library, WebMCP, version panel). References: retrograde, the turn a fourth lower, the dyad. |
| r16–r17 | | Box timing studies, ending on boxes on straight eighths from 5.333. |
| r18–r19 | | A tenth bar at 16.0 (the sequence-diagram turn, Gmaj9). The Back-to-latest turn was shortened so its C# dies before the G chord. |
| r20 | | First reveal at 24.0: a wide reversed Gmaj9 swell, a bloom, the pad opening. |
| r21 | "i like the pull back but the wash obscures it a bit, i think it needs some more oomph" | Three takes: drop, lift, **stop**. The user picked the stop: "the stop and snap back is nice". |
| r22 | "id just like to reduce white noise, is that wash? ... or static" | Measured the sources; gentle and cleaner takes. The user picked "cleaner is good" (r22c2). |
| r23 | "ending sustain shot should have more breathing room to drive home the epicness" | An 11th held bar (29.333 s loop), in two takes: **ring** (Gmaj9 rings on) and **move** (to A9sus). A warmer blanket was tried and dropped: "lil-run blanketing" turned out to be a visual effect. |
| r24 | wanted lil.run's interesting audio ideas; "the ending audio is almost there, the bass notes just need to resolve in a satisfying way" | Click **bloops**, ducking, the motion-following **ladder** and the phone-safe octave, in **subtle** and **present** levels. Bass **climb** into D at the seam. |
| r25 | "i really like that note progression right at the end … its really cool" / "the video gets cut off" | The climb moved earlier, landing on D at 28.0 inside the video; Dmaj9 rings into the loop. |
| r26 | "move ending is three note right? can we add a final resolving note?" | Two options: (a) a re-struck low D at 28.333, or (b) a four-note climb **A B C# D** with a long, accented D. **r26c1m-b** (subtle, move, b) was chosen. |
| r27 | | A click at 22.6 (the header's Back arrow). Superseded. |
| r28 | | The 22.0 click removed (when Back was on the snap). Superseded. |
| r29 | | Per-picture variants: r29a "pan to share" (click at 26.4) and r29b "simple" (24 s, version panel cut). |
| r30 | | r26c1m-b + a Back click at 25.0. |
| **r31** | final picture A5; "the user is thrilled" | **r26c1m-b + one click at 25.4** (G2): the cursor reaches Back as the push-out completes (about 25.07), rests, then clicks. **Final.** |

---

## 6. Vocabulary

- **Box notes:** the eight short reversed single notes (A4 B4 D5 E5 F#5 E5 F#5 A5) that land one per diagram box. They are the score's signature and are heard in full once only.
- **Reversed notes / swells:** sounds rendered forwards with reverb and played backwards, so they swell in and stop dead on the beat. The user loves these; they called them the "almost reversed" sounds.
- **Wash / colour wash:** the long reversed Amaj9 chord landing at 13.333 as the diagram floods with colour; the key moment. ("Wash" can also mean the white-noise wash the user hated; the score has none.)
- **Bloom:** the forward chord that sustains after a wash or snap.
- **Blanket:** the master treatment from r11 (1.1 kHz 24 dB/oct low-pass, low shelf, rounded attacks, short dark room): "the track through a blanket".
- **Bass lead:** the gritty but round synth bass that carries the groove and the melody of the low end.
- **Star melody / star figure:** originally the reversed C#5+E5 dyad on the tag-and-star moment. The user later clarified that "the melody" they meant was the box notes.
- **References:** subtle recalls of the box phrase in another voice, register or order (retrograde, a fourth lower, a stacked dyad), never the phrase itself.
- **Hole:** the thinned bar before the wash (bar 4), with the bass climb E–F#–G# into it.
- **Grey:** the version-history bars, where the music drains (pad closed, bass and drums dimmed) as the diagram goes grey.
- **Stop:** the silent beat 23.36–24.0, when the whole band drops to -20 dB with only the low inhale.
- **Inhale:** the warm, low G chord that swells (reverb-free) into the snap.
- **Snap (snap back):** the moment at 24.0 when everything slams back in with the sub hit.
- **Reveal:** the bar after the snap, while the camera pulls back to show the whole Eos window.
- **Ladder:** the reveal chord's tones placed at equal steps of the camera's ease-in-out motion.
- **Bloop:** a click sound: a dull low triangle that glides down into a chord tone.
- **Ducking:** the music dipping briefly so a sound effect carries.
- **Phone octave:** the soft saturated upper octave on the sub hit, so phone speakers hear the drop.
- **Held bar:** the 11th bar, where the reveal breathes before the loop.
- **Ring / move:** the two held-bar takes. In **ring** the Gmaj9 rings on; in **move** the chord moves once to A9sus, then to D. r31 is **move**.
- **Climb:** a bass run on sixteenths into an arrival. In the final, **A B C# D**, landing on the long D at 28.0.
- **Subtle / present:** the two levels of the r24 sound design. r31 uses **subtle**.
- **Light / full bars:** the person's sections (fewer kicks, softer snare, bass at -1.4 dB) and the agent's sections (full groove).
- **Seam:** the loop point at 29.333/0.

---

## 7. How to reproduce

**Environment.** Python 3.9.6, numpy 2.0.2, scipy 1.13.1. The venv is `scratchpad/music/.venv`. Run everything with `python -I`. Only numpy and scipy are used.

**Files needed in `scratchpad/ideas-c/`:**
- `synthlib.py`: oscillators, ADSR, filters, the swept filter, the `Bus` 3-pass placement, reverb, echo
- `r31.py`: the final script. It descends, by copy, from r20 → r21 → r22 → r23 → r24 → r25 → r26 → r30.
- `r21-master.json`: the fixed master constants
- `r22c2-rewind-90-27s-stop-cleaner-loop.wav`: read for comparison reports only

**Command** (reproduces the file bit for bit; verified, same MD5):
```
cd scratchpad/ideas-c
R30_GAIN=0.9925698693244943 ../music/.venv/bin/python -I r31.py c1 <out.wav> b
```
- `c1` is the subtle level and `b` the four-note climb option.
- `R30_GAIN` fixes the output level to r26c1m-b's.
- Without `R30_GAIN`, the script matches the level to r22c2 over 3–24 s. Nothing in that span changed after r26, so it computes the same value; the variable only pins it.
- `R30_NO_2500=1` leaves out the extra Back click, which re-renders r26c1m-b exactly.
- Rendering takes about 40 s.
- The script prints the checks: length, peak, LUFS, seam, flatness by section, saturation products, the stop and snap, the bass pitch at each note, and click and ladder levels.

**Where the timeline lives in `r31.py`, for adapting to a different cut:**
- **Tempo and grid:** `BAR = 8/3` (90 BPM) and `S16 = BAR/16`. `LOOP = 88/3` with eleven bars.
- **Chords:** `SEC`, a list of (start time, chord), with chord voicings `D9 Bm E9 A9 G9 A9s D9_LATE`.
- **Boxes and wash:** `BOXES` (the eight box times; keep the box notes once), `WASH` (13.333) and `CLIMB_BAR` (the bar whose last beat climbs into the wash).
- **Per-bar groove:** `BARS`, one dict per bar:
  - `skip`: bass sixteenths to rest
  - `bg`: bass level
  - `k` / `s`: kick and snare sixteenths
  - `sg`: snare level
  - `dim`: the grey range
- **Automation:** `PAD_CUT`, `PAD_GAIN` and `BOPEN`, as (time, value) lists.
- **Swells and references:** `SWELLS`, `HOOKS`, `REFS`, `DYAD`.
- **Version-panel times:** `HISTORY`, `EARLIER`, `LATEST`.
- **Reveal, stop and held bar:**
  - `REVEAL` (the snap, 24.0)
  - `MASTER_ENV` (the stop: 23.30 / 23.36 / 23.988 / 24.0)
  - the inhale in `clean_parts`
  - `HOLD` (the held bar) and `DLAND` (where the climb lands)
  - the climb notes in `extend()`
- **Clicks, ladder and phone octave** are in `sound_design()`: the `clicks` list (time, note, glide), the ladder's `a0`/`a1` (the camera move's start and end) and its tones.

**Editing techniques that worked:**
- **Change one thing, keep the rest bit-identical:** sounds added later draw on their own random stream (`S.rng` reseeded), so every other sound keeps its exact oscillator phases. Fix the output gain to the previous version's (re-render it once with the change switched off and read the gain), so nothing else moves. r27–r31 differ from r26c1m-b only around the edit.
- **Cutting bars (`r29b.py`):** splice the dry parts before any echo, reverb or master, by a whole number of bars (2 bars = 256 000 samples). Cut drums and bass on a beat where they rest, and everything else inside a quiet moment (the stop), with an 8 ms crossfade; then render the master on the new loop. The music before the cut stayed bit-identical.
- **Measuring "noise":** spectral flatness in 250–1100 Hz with 25 ms and 100 ms frames. 100 ms frames resolve the bass harmonics, so only real noise stays flat. Find sources by removing parts one at a time through the whole chain, with oscillator phases matched.
- **Measuring a landing:** the pitch of each bass note on the bass part alone (autocorrelation), and the level of each sound against the mix where it lands.

---

## 8. The user's taste, learned the hard way

**Likes**
- "Slightly muffled" (the blanket); warm and dreamy but gritty; effortlessly cool, "good for driving".
- The **gritty, round synth bass lead** as the strength of the track.
- **Reversed sounds**: the short reversed notes and swells that land on the beat.
- The eight **box notes**, heard once ("special").
- **Subtle references and new voicings** rather than repetition.
- A clear key moment (the colour wash), then a **stop and snap back** for the reveal.
- **Climbing bass lines** that resolve: "that note progression right at the end … its really cool", with a clear final note that lands inside the picture.
- Sound tied to the UI when it is dull, low and mellow (bloops), sitting in the texture.
- Calm tempo for a looping product demo (90 BPM, not 120).

**Hard nos**
- **Bells**, and "random bright punchy sounds".
- **White-noise washes**, hiss, "static", and noise swooshes.
- **Hi-hats and shakers.**
- **Chiptune or Mario-like** melodies; bright little "spell" tunes (a grey-to-colour tune was called "cringe").
- **Repeating the box phrase** ("repeating them loses the magic").
- Minor and depressing moods; too sultry (glide); "too much like Stranger Things" (heavy tape wobble); tape-slowed versions in the later rounds.
- Busy arpeggios ("overwhelming"); a detuned "whiny" pad.
- An ending that stops on an unresolved note, or that resolves after the picture has cut.
- Anything that makes the reveal blurry (a second wash over the pull-back).
