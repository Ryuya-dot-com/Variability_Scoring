/**
 * app.js - Main application controller
 * Uses CsvLoader for lazy CSV loading instead of manifest.json.
 */
const App = (() => {
  let _index = null;
  let _loadGeneration = 0;
  let _currentDataset = null;

  async function init() {
    try {
      _index = await CsvLoader.loadIndex();
    } catch (e) {
      document.body.innerHTML = '<div style="padding:40px;color:#e74c3c;">' +
        '<h1>Error loading data</h1><p>Make sure participants.json exists in data/ directory.</p>' +
        '<p>Run: <code>node build/prepare-data.js</code></p></div>';
      return;
    }

    renderSetupScreen();
    setupKeyboardShortcuts();
  }

  function getIndex() { return _index; }

  // ── Setup Screen ──

  let _setupListenersAttached = false;

  function renderSetupScreen() {
    document.getElementById('setup-screen').style.display = '';
    document.getElementById('scoring-screen').style.display = 'none';

    // Dataset selector
    const dsContainer = document.getElementById('dataset-selector');
    dsContainer.innerHTML = '';
    _index.datasets.forEach((ds, i) => {
      const label = document.createElement('label');
      label.innerHTML = `<input type="radio" name="dataset" value="${ds.id}" ${i === 0 ? 'checked' : ''}> ` +
        `<span>${ds.label} (${ds.participants.length} participants)</span>`;
      dsContainer.appendChild(label);
    });

    renderParticipantSelector();

    if (!_setupListenersAttached) {
      _setupListenersAttached = true;

      dsContainer.addEventListener('change', () => {
        renderParticipantSelector();
        checkResume();
      });

      document.getElementById('select-all-btn').addEventListener('click', () => {
        document.querySelectorAll('#participant-selector input').forEach(cb => cb.checked = true);
        updateStartButton();
      });
      document.getElementById('deselect-all-btn').addEventListener('click', () => {
        document.querySelectorAll('#participant-selector input').forEach(cb => cb.checked = false);
        updateStartButton();
      });

      document.getElementById('rater-id').addEventListener('input', () => {
        checkResume();
        updateStartButton();
      });

      document.getElementById('start-btn').addEventListener('click', startScoring);
      document.getElementById('resume-btn').addEventListener('click', resumeScoring);
    }

    checkResume();
  }

  function renderParticipantSelector() {
    const dsId = getSelectedDatasetId();
    const ds = _index.datasets.find(d => d.id === dsId);
    if (!ds) return;

    const container = document.getElementById('participant-selector');
    container.innerHTML = '';

    ds.participants.forEach(pid => {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${pid}" checked> ${pid}`;
      container.appendChild(label);
    });

    document.getElementById('participant-count').textContent = ds.participants.length;

    container.addEventListener('change', updateStartButton);
    updateStartButton();
  }

  function getSelectedDatasetId() {
    const checked = document.querySelector('input[name="dataset"]:checked');
    return checked ? checked.value : null;
  }

  function getSelectedParticipants() {
    return Array.from(document.querySelectorAll('#participant-selector input:checked'))
      .map(cb => cb.value);
  }

  function updateStartButton() {
    const raterId = document.getElementById('rater-id').value.trim();
    const participants = getSelectedParticipants();
    document.getElementById('start-btn').disabled = !raterId || participants.length === 0;
  }

  function checkResume() {
    const raterId = document.getElementById('rater-id').value.trim();
    const dsId = getSelectedDatasetId();
    const resumeSection = document.getElementById('resume-section');

    if (!raterId || !dsId) {
      resumeSection.style.display = 'none';
      return;
    }

    const existing = State.load(raterId, dsId);
    if (existing) {
      const scored = Object.values(existing.scores).filter(s => s.accuracy != null).length;
      document.getElementById('resume-info').textContent =
        `${scored} trials scored across ${existing.assignedParticipants.length} participants. ` +
        `Last saved: ${new Date(existing.lastSaved).toLocaleString()}`;
      resumeSection.style.display = 'block';
    } else {
      resumeSection.style.display = 'none';
    }
  }

  // ── Start / Resume ──

  function startScoring() {
    const raterId = document.getElementById('rater-id').value.trim();
    const dsId = getSelectedDatasetId();
    const participantIds = getSelectedParticipants();

    State.create(raterId, dsId, participantIds);
    enterScoringScreen(dsId, participantIds, 0, 0);
  }

  function resumeScoring() {
    const state = State.get();
    if (!state) return;

    enterScoringScreen(
      state.datasetId,
      state.assignedParticipants,
      state.currentParticipantIndex,
      state.currentTrialIndex
    );
  }

  let _scoringListenersAttached = false;

  function enterScoringScreen(dsId, participantIds, startPIndex, startTIndex) {
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('scoring-screen').style.display = '';

    const dataset = _index.datasets.find(d => d.id === dsId);
    _currentDataset = dataset;

    // Dataset label
    document.getElementById('dataset-label').textContent = dataset.label;

    // Init waveform
    WaveformViewer.init();
    WaveformViewer.onOnsetChanged((ms, source) => {
      ScoringUI.handleOnsetAction(source);
    });

    if (!_scoringListenersAttached) {
      _scoringListenersAttached = true;

      document.getElementById('back-to-setup').addEventListener('click', () => {
        ScoringUI.saveCurrentScore();
        WaveformViewer.destroy();
        CsvLoader.clearCache();
        renderSetupScreen();
      });

      document.getElementById('play-btn').addEventListener('click', () => {
        WaveformViewer.play();
        updatePlayButton();
      });
      document.getElementById('stop-btn').addEventListener('click', () => {
        WaveformViewer.stop();
        updatePlayButton();
      });
      document.getElementById('play-from-onset').addEventListener('click', () => {
        WaveformViewer.playFromOnset();
        updatePlayButton();
      });
      document.getElementById('playback-speed').addEventListener('change', (e) => {
        WaveformViewer.setPlaybackRate(parseFloat(e.target.value));
      });

      // Export buttons
      document.getElementById('export-csv').addEventListener('click', () => Export.exportAllCSV(_currentDataset));
      document.getElementById('export-json').addEventListener('click', () => Export.exportJSON());
      document.getElementById('export-participant').addEventListener('click', () => Export.exportCurrentParticipant(_currentDataset));

      // Reference pronunciation button
      document.getElementById('play-reference').addEventListener('click', () => ScoringUI.playReference());
    }

    // Init scoring UI
    ScoringUI.init(() => {
      Navigation.updateProgress();
      showSaveStatus();
    });

    // Init instructions panel
    Instructions.init();

    // Init navigation with lazy loading
    Navigation.init(dataset, participantIds, (pIndex, tIndex, participant, trial) => {
      loadTrial(dataset, participant, trial);
    });

    // Clamp indices
    const safePIndex = Math.min(startPIndex, participantIds.length - 1);
    const safeTIndex = Math.min(startTIndex, 23);

    Navigation.navigate(safePIndex, safeTIndex);
  }

  async function loadTrial(dataset, participant, trial) {
    const generation = ++_loadGeneration;

    // Render scoring UI
    ScoringUI.renderTrial(trial, participant, dataset);

    // Clear onset display immediately
    WaveformViewer.updateOnsetDisplay(null);

    // Load audio
    const audioUrl = Navigation.getAudioUrl(trial);
    try {
      await WaveformViewer.loadAudio(audioUrl);

      if (generation !== _loadGeneration) return;

      // Set onset marker
      const existingScore = State.getScore(participant.id, trial.trial);
      if (existingScore && existingScore.onsetMs != null) {
        WaveformViewer.setOnsetMarker(existingScore.onsetMs);
      } else if (trial.onset_ms_from_recording_start != null) {
        WaveformViewer.setOnsetMarker(trial.onset_ms_from_recording_start);
      } else {
        WaveformViewer.updateOnsetDisplay(null);
      }

      // Reference marker (playback end for L2-to-L1)
      if (dataset.testType === 'l2_to_l1' && trial.playback_end_ms_rel != null) {
        WaveformViewer.setReferenceMarker(trial.playback_end_ms_rel);
      }
    } catch (e) {
      if (generation === _loadGeneration) {
        console.error('Failed to load audio:', e);
      }
    }

    if (generation === _loadGeneration) updatePlayButton();
  }

  function updatePlayButton() {
    const btn = document.getElementById('play-btn');
    if (btn) btn.textContent = WaveformViewer.isPlaying() ? 'Pause' : 'Play';
  }

  function showSaveStatus() {
    const el = document.getElementById('save-status');
    el.textContent = 'Saving...';
    el.style.color = 'var(--warning)';
    setTimeout(() => {
      el.textContent = 'Saved';
      el.style.color = 'var(--success)';
    }, 600);
  }

  // ── Keyboard Shortcuts ──

  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.key === 'Escape') e.target.blur();
        return;
      }

      if (document.getElementById('scoring-screen').style.display === 'none') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          WaveformViewer.play();
          updatePlayButton();
          break;
        case '0':
          ScoringUI.scoreByKey('0');
          break;
        case '5':
          ScoringUI.scoreByKey('5');
          break;
        case '1':
          ScoringUI.scoreByKey('1');
          break;
        case 'ArrowRight':
        case 'Enter':
          e.preventDefault();
          Navigation.nextTrial();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          Navigation.prevTrial();
          break;
        case 'c':
        case 'C':
          ScoringUI.confirmOnset();
          break;
        case 'r':
        case 'R':
          WaveformViewer.playFromOnset();
          updatePlayButton();
          break;
        case 'n':
        case 'N':
          document.getElementById('trial-notes').focus();
          break;
        case 'i':
        case 'I':
          Instructions.toggle();
          break;
        case '+':
        case '=':
          WaveformViewer.zoomIn();
          break;
        case '-':
          WaveformViewer.zoomOut();
          break;
        case '?':
          toggleShortcutsPanel();
          break;
      }
    });
  }

  function toggleShortcutsPanel() {
    const panel = document.getElementById('shortcuts-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }

  // ── Init ──
  document.addEventListener('DOMContentLoaded', init);

  return { getIndex };
})();
