// Chiptune tracks for the sequencer in js/core/audio.js. One step = a 16th note.
// Melodic patterns: space-separated tokens, one per step: a note ('C5', 'F#4'),
// '.' rest, '-' hold the previous note. Drums: 'k' kick, 's' snare, 'h' hat, '.' rest.

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const hz = (n) => {
  const m = /^([A-G]#?)(-?\d)$/.exec(n);
  return m ? 440 * Math.pow(2, ((+m[2] + 1) * 12 + NOTE[m[1]] - 69) / 12) : 0;
};

function seq(str) {
  const out = [];
  let last = null;
  for (const t of str.trim().split(/\s+/)) {
    if (t === '.') { out.push(null); last = null; } else if (t === '-') { out.push(null); if (last) last.len++; } else {
      last = { f: hz(t), len: 1 };
      out.push(last);
    }
  }
  return out;
}

const DRUM = { k: { f: 140, vol: 1 }, s: { f: 1400, vol: 0.7 }, h: { f: 9000, vol: 0.35, short: true } };
const drums = (str) => str.trim().split(/\s+/).map((t) => DRUM[t] || null);
const rep = (s, n) => Array(n).fill(s).join(' ');

function track(bpm, channels) {
  const steps = Math.max(...channels.map((c) => c.steps.length));
  return { bpm, steps, channels };
}

export const TRACKS = {
  title: track(120, [
    { wave: 'pulse', duty: 0.25, vol: 0.16, steps: seq(`
      E5 . G5 . C6 - - . B5 . G5 . E5 - D5 .
      C5 . E5 . A5 - - . G5 . E5 . C5 - - .
      A4 . C5 . F5 - - . E5 . C5 . A4 - G4 .
      B4 . D5 . G5 - - . F5 . D5 . B4 - D5 .`) },
    { wave: 'pulse', duty: 0.125, vol: 0.07, steps: seq(`
      ${rep('C4 E4 G4 E4', 4)} ${rep('A3 C4 E4 C4', 4)} ${rep('F3 A3 C4 A3', 4)} ${rep('G3 B3 D4 B3', 4)}`) },
    { wave: 'triangle', vol: 0.22, steps: seq(`
      C3 . C3 . G2 . C3 . C3 . G2 . C3 . G2 .
      A2 . A2 . E2 . A2 . A2 . E2 . A2 . E2 .
      F2 . F2 . C3 . F2 . F2 . C3 . F2 . C3 .
      G2 . G2 . D3 . G2 . G2 . D3 . G2 . B2 .`) },
    { wave: 'noise', vol: 0.12, steps: drums(rep('k . h . s . h . k . h k s . h .', 4)) },
  ]),

  mines: track(96, [
    { wave: 'pulse', duty: 0.25, vol: 0.12, steps: seq(`
      A4 - - - . . E5 - - - . . C5 - B4 -
      A4 - - - . . F4 - - - . . E4 - - -
      D4 - - - . . F4 - A4 - . . D5 - C5 -
      B4 - - - G#4 - - - E4 - - - . . . .`) },
    { wave: 'pulse', duty: 0.125, vol: 0.06, steps: seq(`
      ${rep('A3 . C4 . E4 . C4 .', 2)} ${rep('F3 . A3 . C4 . A3 .', 2)} ${rep('D3 . F3 . A3 . F3 .', 2)} ${rep('E3 . G#3 . B3 . G#3 .', 2)}`) },
    { wave: 'triangle', vol: 0.24, steps: seq(`
      A2 - - - . . A2 . A2 - - - . . E2 .
      F2 - - - . . F2 . F2 - - - . . C3 .
      D2 - - - . . D2 . D2 - - - . . A2 .
      E2 - - - . . E2 . E2 - - - B2 - - -`) },
    { wave: 'noise', vol: 0.1, steps: drums(rep('k . . . . . h . k . . . s . . .', 4)) },
  ]),

  rooftops: track(140, [
    { wave: 'pulse', duty: 0.25, vol: 0.14, steps: seq(`
      E5 . E5 . G5 . E5 . B5 . A5 . G5 . F#5 .
      E5 . E5 . G5 . E5 . C6 . B5 . G5 . E5 .
      D5 . D5 . F#5 . D5 . A5 . G5 . F#5 . E5 .
      D#5 . F#5 . B5 . F#5 . D#5 . B4 . F#5 - - .`) },
    { wave: 'pulse', duty: 0.125, vol: 0.06, steps: seq(`
      ${rep('E4 G4 B4 G4', 4)} ${rep('C4 E4 G4 E4', 4)} ${rep('D4 F#4 A4 F#4', 4)} ${rep('B3 D#4 F#4 D#4', 4)}`) },
    { wave: 'triangle', vol: 0.22, steps: seq(`
      ${rep('E2 . E3 .', 4)} ${rep('C2 . C3 .', 4)} ${rep('D2 . D3 .', 4)} ${rep('B1 . B2 .', 4)}`) },
    { wave: 'noise', vol: 0.12, steps: drums(rep('k . h . s . h . k k h . s . h h', 4)) },
  ]),

  pipepit: track(128, [
    { wave: 'pulse', duty: 0.5, vol: 0.11, steps: seq(`
      D5 . . D5 . . F5 . A5 . . G5 . F5 . E5
      D5 . . D5 . . F5 . A#5 . . A5 . F5 . D5
      C5 . . C5 . . E5 . G5 . . F5 . E5 . C5
      C#5 . . E5 . . A5 . . G5 . E5 . C#5 . .`) },
    { wave: 'pulse', duty: 0.125, vol: 0.06, steps: seq(`
      ${rep('D4 A4', 8)} ${rep('A#3 F4', 8)} ${rep('C4 G4', 8)} ${rep('A3 E4', 8)}`) },
    { wave: 'triangle', vol: 0.24, steps: seq(`
      ${rep('D2 D2 . D2 D3 . D2 .', 2)} ${rep('A#1 A#1 . A#1 A#2 . A#1 .', 2)} ${rep('C2 C2 . C2 C3 . C2 .', 2)} ${rep('A1 A1 . A1 A2 . A1 .', 2)}`) },
    { wave: 'noise', vol: 0.12, steps: drums(rep('k . h k s . h . k . h k s h h .', 4)) },
  ]),
};
