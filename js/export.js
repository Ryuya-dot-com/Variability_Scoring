/**
 * export.js - Per-participant Excel export with auto-download popup
 * Uses SheetJS (XLSX) library.
 */
const Export = (() => {

  // Track which participants have already shown the popup
  const _exportedPopups = new Set();

  /** Strip diacritical marks (matches csv-loader.js stripAccents). */
  function stripAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * For L2-to-L1 trials, compute the corrected playback end time (ms)
   * using pre-analyzed stimulus content durations.
   * Falls back to the original playback_end_ms_rel if correction data unavailable.
   */
  function getCorrectedPlaybackEnd(trial) {
    let corrected = trial.playback_end_ms_rel;
    const stimDurations = App.getStimulusDurations();
    if (stimDurations && trial.stimulus_duration_ms != null) {
      const key = trial.voice + '_' + stripAccents(trial.word || '');
      const contentMs = stimDurations[key];
      if (contentMs != null) {
        const playbackStartRel = trial.playback_end_ms_rel - trial.stimulus_duration_ms;
        corrected = playbackStartRel + contentMs;
      }
    }
    return corrected;
  }

  function generateParticipantRows(participant, dataset, state) {
    return participant.trials.map(trial => {
      const scoreKey = `${participant.id}_${trial.trial}`;
      const score = state.scores[scoreKey] || {};
      const isNR = score.accuracy === 'NR';

      // ── Rater latency (corrected) ──
      let latencyRater = null;
      if (!isNR && score.onsetMs != null) {
        if (dataset.testType === 'l2_to_l1' && trial.playback_end_ms_rel != null) {
          const correctedEnd = getCorrectedPlaybackEnd(trial);
          latencyRater = score.onsetMs - correctedEnd;
        } else if (dataset.testType === 'picture_naming' && trial.image_onset_ms_rel != null) {
          latencyRater = score.onsetMs - trial.image_onset_ms_rel;
        }
      }

      // ── Auto-detected latency (corrected for MP3 padding) ──
      let latencyAuto = trial.latency_ms;
      if (dataset.testType === 'l2_to_l1' && latencyAuto != null) {
        const stimDurations = App.getStimulusDurations();
        if (stimDurations && trial.stimulus_duration_ms != null) {
          const key = trial.voice + '_' + stripAccents(trial.word || '');
          const contentMs = stimDurations[key];
          if (contentMs != null) {
            // Original: latency = onset - playback_end_ms_rel
            // Padding = stimulus_duration_ms - contentMs
            // Corrected: latency + padding
            const paddingMs = trial.stimulus_duration_ms - contentMs;
            latencyAuto = latencyAuto + paddingMs;
          }
        }
      }

      return {
        rater_id: state.raterId,
        dataset: dataset.id,
        timing: dataset.timing,
        test_type: dataset.testType,
        participant_id: participant.id,
        trial: trial.trial,
        word: trial.word,
        word_id: trial.word_id,
        list: trial.list,
        voice: trial.voice || '',
        image_file: trial.imageFile || '',
        accuracy_score: score.accuracy != null ? score.accuracy : '',
        onset_ms_auto: trial.onset_ms_from_recording_start != null ? trial.onset_ms_from_recording_start : '',
        onset_ms_rater: (!isNR && score.onsetMs != null) ? Math.round(score.onsetMs * 1000) / 1000 : '',
        onset_status: score.onsetStatus || '',
        latency_ms_auto: latencyAuto != null ? Math.round(latencyAuto * 1000) / 1000 : '',
        latency_ms_rater: latencyRater != null ? Math.round(latencyRater * 1000) / 1000 : '',
        latency_status_auto: trial.latency_status || '',
        notes: score.notes || '',
        scored_at: score.scoredAt || ''
      };
    }).sort((a, b) => a.trial - b.trial);
  }

  function downloadParticipantExcel(participant, dataset) {
    const state = State.get();
    if (!state) return;

    const rows = generateParticipantRows(participant, dataset, state);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Scoring');

    const filename = `scoring_${state.raterId}_${dataset.id}_${participant.id}.xlsx`;
    XLSX.writeFile(wb, filename);
  }

  function showParticipantExportPopup(participant, dataset) {
    // Don't show popup twice for same participant
    const popupKey = `${participant.id}`;
    if (_exportedPopups.has(popupKey)) return;
    _exportedPopups.add(popupKey);

    const overlay = document.createElement('div');
    overlay.className = 'export-popup-overlay';
    overlay.innerHTML = `
      <div class="export-popup">
        <h3>Participant ${participant.id} 採点完了</h3>
        <p>全${participant.trials.length}試行の採点が完了しました。結果をダウンロードしますか？</p>
        <div class="export-popup-buttons">
          <button class="btn btn-primary export-popup-download">Download .xlsx</button>
          <button class="btn export-popup-skip">スキップ</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('.export-popup-download').addEventListener('click', () => {
      downloadParticipantExcel(participant, dataset);
      overlay.remove();
    });
    overlay.querySelector('.export-popup-skip').addEventListener('click', () => {
      overlay.remove();
    });
  }

  // ── Bulk export (all participants, CSV) ──

  function exportAllCSV(dataset) {
    const state = State.get();
    if (!state) return;

    const headers = [
      'rater_id', 'dataset', 'timing', 'test_type',
      'participant_id', 'trial', 'word', 'word_id', 'list',
      'voice', 'image_file',
      'accuracy_score',
      'onset_ms_auto', 'onset_ms_rater', 'onset_status',
      'latency_ms_auto', 'latency_ms_rater',
      'latency_status_auto',
      'notes', 'scored_at'
    ];

    const csvRows = [headers.join(',')];

    for (const pid of state.assignedParticipants) {
      const cacheKey = `${state.datasetId}/${pid}`;
      // Try to get from CsvLoader cache
      const participant = CsvLoader.getIndex() ? null : null; // Will use cached data
      // Use scores we have
      for (const [scoreKey, score] of Object.entries(state.scores)) {
        if (!scoreKey.startsWith(pid + '_')) continue;
        const trialNum = parseInt(scoreKey.split('_').pop());
        csvRows.push([
          escapeCSV(state.raterId),
          escapeCSV(dataset.id),
          escapeCSV(dataset.timing),
          escapeCSV(dataset.testType),
          escapeCSV(pid),
          trialNum,
          '', '', '', '', '', // word fields - not available without loaded CSV
          score.accuracy != null ? score.accuracy : '',
          '', // auto onset
          (score.accuracy !== 'NR' && score.onsetMs != null) ? score.onsetMs.toFixed(3) : '',
          escapeCSV(score.onsetStatus || ''),
          '', '',
          '',
          escapeCSV(score.notes || ''),
          escapeCSV(score.scoredAt || '')
        ].join(','));
      }
    }

    const csv = csvRows.join('\n');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(csv, `scoring_${state.raterId}_${state.datasetId}_${ts}.csv`, 'text/csv');
  }

  function exportJSON() {
    const state = State.get();
    if (!state) return;
    const json = JSON.stringify({
      exportVersion: '2.0.0',
      exportedAt: new Date().toISOString(),
      raterId: state.raterId,
      datasetId: state.datasetId,
      totalScored: Object.keys(state.scores).length,
      assignedParticipants: state.assignedParticipants,
      scores: state.scores
    }, null, 2);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(json, `scoring_${state.raterId}_${state.datasetId}_${ts}.json`, 'application/json');
  }

  function escapeCSV(val) {
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Manual per-participant export from footer
  function exportCurrentParticipant(dataset) {
    const participant = Navigation.getCurrentParticipant();
    if (participant) {
      downloadParticipantExcel(participant, dataset);
    }
  }

  return {
    showParticipantExportPopup, downloadParticipantExcel,
    exportCurrentParticipant, exportAllCSV, exportJSON
  };
})();
