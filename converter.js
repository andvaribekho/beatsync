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

function convertDatToSongJs(datContent, songIndex, songName, difficultyName, options = {}) {
  const beatmap = JSON.parse(datContent);
  const notes = beatmap._notes || [];
  const redobleSeconds = Math.max(0, Number(options.redobleMs || 0)) / 1000;

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

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const timeStr = parseFloat(note._time.toFixed(4));
    let lane = lineIndexToLane(note._lineIndex);

    if (previousTime !== null && redobleSeconds > 0 && (note._time - previousTime) < redobleSeconds) {
      lane = previousLane;
    }

    const flag = 0; // always good notes
    lines.push(`    ${varName}[${i}]= [${timeStr},${lane},${flag}];`);
    previousTime = note._time;
    previousLane = lane;
  }

  return lines.join('\n');
}

module.exports = { convertDatToSongJs };
