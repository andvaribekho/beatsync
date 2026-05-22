/**
 * Converts a Beat Saber .dat file to Song1.js format.
 *
 * Beat Saber format:
 *   { _version, _notes: [{ _time, _lineIndex, _lineLayer, _type, _cutDirection }] }
 *
 * Song1.js format:
 *   var SongX_array = [];
 *   SongX_array[i] = [time, lane, flag];
 *   - time: seconds (float)
 *   - lane: 1=leftmost ... 5=rightmost
 *   - flag: 0 = good note
 */

function lineIndexToLane(lineIndex) {
  // Map Beat Saber's 0-3 (4 lanes) to custom 1-5 (5 lanes)
  const map = { 0: 1, 1: 2, 2: 4, 3: 5 };
  return map[lineIndex] || 3;
}

function getZigzagLane(previousLane, targetLane, direction) {
  if (targetLane > previousLane) return { lane: Math.min(5, previousLane + 1), direction: -1 };
  if (targetLane < previousLane) return { lane: Math.max(1, previousLane - 1), direction: 1 };

  let nextDirection = direction;
  if (previousLane <= 1) nextDirection = 1;
  if (previousLane >= 5) nextDirection = -1;

  return {
    lane: previousLane + nextDirection,
    direction: nextDirection * -1,
  };
}

function beatToSeconds(beat, bpm) {
  return beat * 60 / bpm;
}

function convertDatToSongJs(datContent, songIndex, songName, difficultyName, options = {}) {
  const beatmap = JSON.parse(datContent);
  const notes = beatmap._notes || [];
  const bpm = Number(options.bpm || 120);
  const redobleSeconds = Math.max(0, Number(options.redobleMs || 0)) / 1000;
  const zigzagSeconds = Math.max(0, Number(options.zigzagMs || 0)) / 1000;

  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new Error('Invalid BPM for beatmap conversion');
  }

  // Sort by time
  notes.sort((a, b) => a._time - b._time);

  const varName = `Song${songIndex}_array`;
  const lines = [];

  lines.push('//------------------------------------------------');
  lines.push(`// BeatSync - ${songName} (${difficultyName})`);
  lines.push('//------------------------------------------------');
  lines.push(`var ${varName} = [];`);

  let previousTime = null;
  let previousLane = null;
  let zigzagDirection = 1;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const noteTime = beatToSeconds(note._time, bpm);
    const timeStr = parseFloat(noteTime.toFixed(4));
    let lane = lineIndexToLane(note._lineIndex);

    if (previousTime !== null) {
      const delta = noteTime - previousTime;
      if (redobleSeconds > 0 && delta < redobleSeconds) {
        lane = previousLane;
      } else if (zigzagSeconds > 0 && delta < zigzagSeconds) {
        const zigzag = getZigzagLane(previousLane, lane, zigzagDirection);
        lane = zigzag.lane;
        zigzagDirection = zigzag.direction;
      }
    }

    const flag = 0; // always good notes
    lines.push(`    ${varName}[${i}]= [${timeStr},${lane},${flag}];`);
    previousTime = noteTime;
    previousLane = lane;
  }

  return lines.join('\n');
}

module.exports = { convertDatToSongJs };
