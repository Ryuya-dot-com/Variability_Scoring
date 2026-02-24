/**
 * csv-loader.js - Browser-side CSV loading and parsing
 * Replaces manifest.json with direct CSV reads per participant.
 */
const CsvLoader = (() => {
  let _index = null;          // participants.json data
  const _cache = new Map();   // "datasetId/pid" -> { id, trials, trialCount }

  async function loadIndex() {
    const resp = await fetch('data/participants.json');
    if (!resp.ok) throw new Error('Failed to load participants.json');
    _index = await resp.json();
    return _index;
  }

  function getIndex() { return _index; }

  function getDataset(datasetId) {
    if (!_index) return null;
    return _index.datasets.find(d => d.id === datasetId);
  }

  function getWords() {
    return _index ? _index.words : {};
  }

  /**
   * Load and parse a single participant's CSV.
   * Returns { id, trials, trialCount }.
   */
  async function loadParticipant(datasetId, participantId) {
    const cacheKey = `${datasetId}/${participantId}`;
    if (_cache.has(cacheKey)) return _cache.get(cacheKey);

    const ds = getDataset(datasetId);
    if (!ds) throw new Error(`Dataset not found: ${datasetId}`);

    const csvUrl = `data/${ds.csvPath}/${participantId}/results_${participantId}.csv`;
    const resp = await fetch(csvUrl);
    if (!resp.ok) throw new Error(`Failed to load CSV: ${csvUrl}`);
    const text = await resp.text();

    const rows = parseCSV(text);
    const processFn = ds.testType === 'l2_to_l1' ? buildL2toL1Trial : buildPictureNamingTrial;
    const trials = rows.map(row => processFn(row, participantId, ds)).sort((a, b) => a.trial - b.trial);

    const participant = { id: participantId, trials, trialCount: trials.length };
    _cache.set(cacheKey, participant);
    return participant;
  }

  function evict(datasetId, participantId) {
    _cache.delete(`${datasetId}/${participantId}`);
  }

  function clearCache() {
    _cache.clear();
  }

  // ── CSV Parsing ──

  function parseCSV(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim());
    return lines.slice(1).map(line => {
      const values = line.split(',');
      const row = {};
      headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
      return row;
    });
  }

  function safeFloat(val) {
    if (val === '' || val === undefined || val === null) return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }

  function stripAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Resolve audio filename:
   * - Fix participant ID mismatch in prefix
   * - Strip accents
   * - Change .wav → .mp3
   */
  function resolveAudioFilename(csvRecordingFile, participantId) {
    if (!csvRecordingFile) return '';
    let filename = csvRecordingFile;
    // Fix participant ID prefix mismatch (e.g. CSV says "60_trial..." but dir is participant "74")
    const match = filename.match(/^(\d+)(_.+)/);
    if (match && match[1] !== participantId) {
      filename = participantId + match[2];
    }
    // Strip accents and change extension
    return stripAccents(filename).normalize('NFC').replace(/\.wav$/i, '.mp3');
  }

  function buildL2toL1Trial(row, participantId, dataset) {
    return {
      trial: parseInt(row.trial),
      word: row.word,
      wordNormalized: stripAccents(row.word || ''),
      word_id: parseInt(row.word_id),
      list: parseInt(row.list),
      voice: row.voice,
      audioFile: row.recording_file,
      audioFileNormalized: resolveAudioFilename(row.recording_file, participantId),
      playback_end_ms_rel: safeFloat(row.playback_end_ms_rel),
      stimulus_duration_ms: safeFloat(row.stimulus_duration_ms),
      onset_ms_from_recording_start: safeFloat(row.onset_ms_from_recording_start),
      latency_ms: safeFloat(row.latency_ms_from_playback_end),
      latency_status: row.latency_status,
      latency_note: row.latency_note || '',
      _audioPath: dataset.audioPath
    };
  }

  function buildPictureNamingTrial(row, participantId, dataset) {
    return {
      trial: parseInt(row.trial),
      word: row.word,
      wordNormalized: stripAccents(row.word || ''),
      word_id: parseInt(row.word_id),
      list: parseInt(row.list),
      imageFile: row.image_file,
      audioFile: row.recording_file,
      audioFileNormalized: resolveAudioFilename(row.recording_file, participantId),
      image_onset_ms_rel: safeFloat(row.image_onset_ms_rel),
      onset_ms_from_recording_start: safeFloat(row.onset_ms_from_recording_start),
      latency_ms: safeFloat(row.latency_ms_from_image_onset),
      latency_status: row.latency_status,
      latency_note: row.latency_note || '',
      _audioPath: dataset.audioPath
    };
  }

  return { loadIndex, getIndex, getDataset, getWords, loadParticipant, evict, clearCache };
})();
