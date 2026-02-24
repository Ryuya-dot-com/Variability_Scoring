/**
 * scoring-ui.js - Scoring interface component
 * Adapted for CsvLoader (uses CsvLoader.getWords() instead of App.getManifest().words)
 */
const ScoringUI = (() => {
  let _currentTrial = null;
  let _currentParticipant = null;
  let _dataset = null;
  let _onScoreChanged = null;
  let _initialized = false;

  function init(onScoreChanged) {
    _onScoreChanged = onScoreChanged;
    if (!_initialized) {
      _initialized = true;
      setupScoreButtons();
      setupOnsetButtons();
      setupOnsetManualInput();
      setupNotesField();
    }
  }

  function setupScoreButtons() {
    document.querySelectorAll('.btn-score').forEach(btn => {
      btn.addEventListener('click', () => {
        const score = parseFloat(btn.dataset.score);
        setAccuracyScore(score);
      });
    });
  }

  function setupOnsetButtons() {
    document.querySelectorAll('.btn-onset').forEach(btn => {
      btn.addEventListener('click', () => {
        const status = btn.dataset.status;
        handleOnsetAction(status);
      });
    });
  }

  function setupOnsetManualInput() {
    const applyBtn = document.getElementById('onset-ms-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const input = document.getElementById('onset-ms-input');
        const ms = parseFloat(input.value);
        if (!isNaN(ms) && ms >= 0) {
          WaveformViewer.setOnsetMarker(ms);
          setOnsetStatus('manual', ms);
        }
      });
    }
  }

  function setupNotesField() {
    const textarea = document.getElementById('trial-notes');
    if (textarea) {
      textarea.addEventListener('input', () => {
        saveCurrentScore();
      });
    }
  }

  function setOnsetStatus(status, ms) {
    highlightOnsetButton(status);
    saveCurrentScore();
    if (_onScoreChanged) _onScoreChanged();
  }

  function renderTrial(trial, participant, dataset) {
    _currentTrial = trial;
    _currentParticipant = participant;
    _dataset = dataset;

    // Word display
    const wordEl = document.getElementById('trial-word');
    const detailsEl = document.getElementById('trial-details');
    const words = CsvLoader.getWords();
    const english = words[trial.wordNormalized] || '';

    if (dataset.testType === 'l2_to_l1') {
      wordEl.textContent = `${trial.word}`;
      detailsEl.textContent = `Expected: ${english} | Voice: ${trial.voice}`;
    } else {
      wordEl.textContent = `${trial.word}`;
      detailsEl.textContent = `Expected Spanish production | English: ${english}`;
    }

    // Dialect note for manzana/lápiz
    const dialectNote = document.getElementById('dialect-note');
    const wordLower = trial.wordNormalized.toLowerCase();
    dialectNote.style.display = (wordLower === 'manzana' || wordLower === 'lapiz') ? 'block' : 'none';

    // Stimulus image (PictureNaming only)
    const imgContainer = document.getElementById('stimulus-image-container');
    if (dataset.testType === 'picture_naming' && trial.imageFile) {
      const img = document.getElementById('stimulus-image');
      img.src = `data/images/${trial.imageFile}`;
      img.alt = trial.word;
      imgContainer.style.display = 'block';
    } else {
      imgContainer.style.display = 'none';
    }

    // Auto-detected onset info
    const autoOnsetEl = document.getElementById('auto-onset-value');
    autoOnsetEl.textContent = trial.onset_ms_from_recording_start != null
      ? trial.onset_ms_from_recording_start.toFixed(1)
      : 'N/A';

    const statusEl = document.getElementById('latency-status-display');
    statusEl.textContent = trial.latency_status;
    statusEl.style.color = trial.latency_status === 'ok' ? 'var(--success)' : 'var(--warning)';

    // Score hint
    const hintEl = document.getElementById('score-hint');
    if (dataset.testType === 'l2_to_l1') {
      hintEl.textContent = '0.5 is rarely used for L1 translation recall';
    } else {
      hintEl.textContent = '0.5 = missing/incorrect phoneme(s) within a single syllable';
    }

    // Load existing score
    const existingScore = State.getScore(participant.id, trial.trial);
    if (existingScore) {
      highlightScoreButton(existingScore.accuracy);
      highlightOnsetButton(existingScore.onsetStatus);
      document.getElementById('trial-notes').value = existingScore.notes || '';
      document.getElementById('onset-ms-input').value =
        existingScore.onsetMs != null ? existingScore.onsetMs.toFixed(1) : '';
    } else {
      clearScoreButtons();
      clearOnsetButtons();
      document.getElementById('trial-notes').value = '';
      document.getElementById('onset-ms-input').value =
        trial.onset_ms_from_recording_start != null ? trial.onset_ms_from_recording_start.toFixed(1) : '';
    }

    // Onset click-to-set mode
    WaveformViewer.enableClickToSet(false);
  }

  function setAccuracyScore(score) {
    highlightScoreButton(score);
    saveCurrentScore();
    if (_onScoreChanged) _onScoreChanged();
  }

  function handleOnsetAction(status) {
    highlightOnsetButton(status);

    if (status === 'confirmed') {
      WaveformViewer.enableClickToSet(false);
    } else if (status === 'corrected') {
      WaveformViewer.enableClickToSet(false);
    } else if (status === 'manual') {
      WaveformViewer.enableClickToSet(true);
    } else if (status === 'no_speech') {
      WaveformViewer.enableClickToSet(false);
    }

    saveCurrentScore();
    if (_onScoreChanged) _onScoreChanged();
  }

  function highlightScoreButton(score) {
    document.querySelectorAll('.btn-score').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.score) === score);
    });
  }

  function highlightOnsetButton(status) {
    document.querySelectorAll('.btn-onset').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === status);
    });
  }

  function clearScoreButtons() {
    document.querySelectorAll('.btn-score').forEach(btn => btn.classList.remove('active'));
  }

  function clearOnsetButtons() {
    document.querySelectorAll('.btn-onset').forEach(btn => btn.classList.remove('active'));
  }

  function getActiveScore() {
    const active = document.querySelector('.btn-score.active');
    return active ? parseFloat(active.dataset.score) : null;
  }

  function getActiveOnsetStatus() {
    const active = document.querySelector('.btn-onset.active');
    return active ? active.dataset.status : null;
  }

  function saveCurrentScore() {
    if (!_currentTrial || !_currentParticipant) return;

    const accuracy = getActiveScore();
    const onsetStatus = getActiveOnsetStatus();
    const notes = document.getElementById('trial-notes').value;
    const onsetMs = WaveformViewer.getCurrentOnsetMs();

    if (accuracy == null && onsetStatus == null) return;

    State.setScore(_currentParticipant.id, _currentTrial.trial, {
      accuracy,
      onsetMs,
      onsetStatus,
      notes
    });
  }

  function scoreByKey(key) {
    if (key === '0') setAccuracyScore(0);
    else if (key === '5') setAccuracyScore(0.5);
    else if (key === '1') setAccuracyScore(1);
  }

  function confirmOnset() {
    handleOnsetAction('confirmed');
  }

  return {
    init, renderTrial, setAccuracyScore, handleOnsetAction,
    saveCurrentScore, scoreByKey, confirmOnset, getActiveScore, getActiveOnsetStatus
  };
})();
