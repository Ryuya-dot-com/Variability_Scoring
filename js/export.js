/**
 * export.js - Per-participant Excel export with auto-download popup
 * Uses SheetJS (XLSX) library.
 */
const Export = (() => {

  // Track which participants have already shown the popup
  const _exportedPopups = new Set();

  function generateParticipantRows(participant, dataset, state) {
    return participant.trials.map(trial => {
      const scoreKey = `${participant.id}_${trial.trial}`;
      const score = state.scores[scoreKey] || {};

      // Recalculate rater latency
      let latencyRater = null;
      if (score.onsetMs != null) {
        if (dataset.testType === 'l2_to_l1' && trial.playback_end_ms_rel != null) {
          latencyRater = score.onsetMs - trial.playback_end_ms_rel;
        } else if (dataset.testType === 'picture_naming' && trial.image_onset_ms_rel != null) {
          latencyRater = score.onsetMs - trial.image_onset_ms_rel;
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
        onset_ms_rater: score.onsetMs != null ? Math.round(score.onsetMs * 1000) / 1000 : '',
        onset_status: score.onsetStatus || '',
        latency_ms_auto: trial.latency_ms != null ? trial.latency_ms : '',
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
          score.onsetMs != null ? score.onsetMs.toFixed(3) : '',
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
