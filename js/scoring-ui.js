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

  // Japanese translations for raters
  const WORDS_JA = {
    hongos: 'きのこ', reloj: '時計', tijeras: 'はさみ',
    sandia: 'スイカ', cuaderno: 'ノート', ardilla: 'リス',
    cinta: 'テープ', fresas: 'いちご', tiza: 'チョーク',
    caballo: '馬', elote: 'とうもろこし', manzana: 'りんご',
    oso: 'クマ', pato: 'アヒル', grapadora: 'ホチキス',
    loro: 'オウム', cebolla: '玉ねぎ', lechuga: 'レタス',
    lapiz: '鉛筆', conejo: 'ウサギ', gato: '猫',
    naranja: 'オレンジ', basurero: 'ゴミ箱', pez: '魚',
    perro: '犬', tortuga: 'カメ'
  };

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
        const raw = btn.dataset.score;
        const score = raw === 'NR' ? 'NR' : parseFloat(raw);
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
    const refBtnContainer = document.getElementById('reference-audio-container');
    const words = CsvLoader.getWords();
    const english = words[trial.wordNormalized] || '';
    const japanese = WORDS_JA[trial.wordNormalized] || '';

    if (dataset.testType === 'l2_to_l1') {
      wordEl.textContent = trial.word;
      detailsEl.innerHTML = `<span class="expected-answer">正解: <strong>${english}</strong>${japanese ? ` (${japanese})` : ''}</span> <span class="voice-tag">${trial.voice}</span>`;
      refBtnContainer.style.display = 'none';
    } else {
      wordEl.textContent = trial.word;
      detailsEl.innerHTML = `${japanese ? `<span class="ja-translation">${japanese}</span> ` : ''}<span class="expected-answer">English: ${english}</span>`;
      refBtnContainer.style.display = '';
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
    if (score === 'NR') {
      handleOnsetAction('no_speech');
    }
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
      const raw = btn.dataset.score;
      const btnScore = raw === 'NR' ? 'NR' : parseFloat(raw);
      btn.classList.toggle('active', btnScore === score);
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
    if (!active) return null;
    const raw = active.dataset.score;
    return raw === 'NR' ? 'NR' : parseFloat(raw);
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
    let onsetMs = WaveformViewer.getCurrentOnsetMs();

    // NRの場合、onsetMsをnullにする（発話がないため）
    if (accuracy === 'NR') {
      onsetMs = null;
    }

    if (accuracy == null && onsetStatus == null) return;

    State.setScore(_currentParticipant.id, _currentTrial.trial, {
      accuracy,
      onsetMs,
      onsetStatus,
      notes
    });
  }

  function scoreByKey(key) {
    if (key === '9') setAccuracyScore('NR');
    else if (key === '0') setAccuracyScore(0);
    else if (key === '5') setAccuracyScore(0.5);
    else if (key === '1') setAccuracyScore(1);
  }

  function confirmOnset() {
    handleOnsetAction('confirmed');
  }

  // ── Reference Pronunciation (recorded audio with SpeechSynthesis fallback) ──

  let _refAudio = null;

  function playReference() {
    if (!_currentTrial) return;
    // 再生中なら停止してリセット
    if (_refAudio) {
      _refAudio.pause();
      _refAudio.currentTime = 0;
    }
    const word = _currentTrial.wordNormalized || _currentTrial.word;
    _refAudio = new Audio(`data/reference_audio/${word}.mp3`);
    _refAudio.play().catch(() => {
      // フォールバック: 音声ファイルがない場合はSpeechSynthesisを使用
      console.warn('Reference audio not found, falling back to SpeechSynthesis');
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(_currentTrial.word);
      utterance.lang = 'es-ES';
      utterance.rate = 0.85;
      const voices = speechSynthesis.getVoices();
      const esVoice = voices.find(v => v.lang.startsWith('es'));
      if (esVoice) utterance.voice = esVoice;
      speechSynthesis.speak(utterance);
    });
  }

  return {
    init, renderTrial, setAccuracyScore, handleOnsetAction,
    saveCurrentScore, scoreByKey, confirmOnset, getActiveScore, getActiveOnsetStatus,
    playReference
  };
})();
