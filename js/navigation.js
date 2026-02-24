/**
 * navigation.js - Trial/participant navigation with randomized trial order
 * and lazy CSV loading per participant.
 */
const Navigation = (() => {
  let _dataset = null;
  let _participantIds = [];
  let _participantData = new Map(); // pid -> { id, trials, trialCount }
  let _pIndex = 0;
  let _tIndex = 0;
  let _shuffleOrder = null;
  let _onNavigate = null;
  let _audioCache = new Map();

  function init(dataset, participantIds, onNavigate) {
    _dataset = dataset;
    _participantIds = participantIds;
    _participantData.clear();
    _pIndex = 0;
    _tIndex = 0;
    _shuffleOrder = null;
    _onNavigate = onNavigate;

    document.getElementById('prev-trial').addEventListener('click', prevTrial);
    document.getElementById('next-trial').addEventListener('click', nextTrial);
    document.getElementById('prev-participant').addEventListener('click', prevParticipant);
    document.getElementById('next-participant').addEventListener('click', nextParticipant);
    document.getElementById('jump-unscored').addEventListener('click', jumpToUnscored);
  }

  function setPosition(pIndex, tIndex) {
    _pIndex = pIndex;
    _tIndex = tIndex;
  }

  /**
   * Navigate to a specific participant + trial (shuffled position).
   * Handles lazy CSV loading.
   */
  async function navigate(pIndex, tIndex) {
    _pIndex = pIndex;
    _tIndex = tIndex;

    const pid = _participantIds[_pIndex];

    // Lazy load participant CSV if not cached
    if (!_participantData.has(pid)) {
      const participant = await CsvLoader.loadParticipant(_dataset.id, pid);
      _participantData.set(pid, participant);
    }

    const participant = _participantData.get(pid);

    // Get or create shuffle order
    _shuffleOrder = State.getOrCreateShuffleOrder(pid, participant.trials.length);

    // Save position
    State.setPosition(_pIndex, _tIndex);
    updateIndicators();

    // Get the actual trial via shuffle mapping
    const originalIdx = _shuffleOrder[_tIndex];
    const trial = participant.trials[originalIdx];

    if (_onNavigate) {
      _onNavigate(_pIndex, _tIndex, participant, trial);
    }

    // Preload audio for this participant
    preloadParticipantAudio(participant);

    // Preload next participant in background
    if (_pIndex + 1 < _participantIds.length) {
      const nextPid = _participantIds[_pIndex + 1];
      if (!_participantData.has(nextPid)) {
        CsvLoader.loadParticipant(_dataset.id, nextPid).then(p => {
          _participantData.set(nextPid, p);
        }).catch(() => {});
      }
    }
  }

  function nextTrial() {
    ScoringUI.saveCurrentScore();
    const participant = getCurrentParticipant();
    if (!participant) return;

    if (_tIndex < participant.trials.length - 1) {
      navigate(_pIndex, _tIndex + 1);
    } else if (_pIndex < _participantIds.length - 1) {
      // Check if current participant is complete before moving
      if (State.isParticipantComplete(participant.id, participant.trials)) {
        Export.showParticipantExportPopup(participant, _dataset);
      }
      navigate(_pIndex + 1, 0);
    }
  }

  function prevTrial() {
    ScoringUI.saveCurrentScore();
    if (_tIndex > 0) {
      navigate(_pIndex, _tIndex - 1);
    } else if (_pIndex > 0) {
      const prevPid = _participantIds[_pIndex - 1];
      const prevP = _participantData.get(prevPid);
      const lastIdx = prevP ? prevP.trials.length - 1 : 23;
      navigate(_pIndex - 1, lastIdx);
    }
  }

  function nextParticipant() {
    ScoringUI.saveCurrentScore();
    const participant = getCurrentParticipant();
    if (participant && State.isParticipantComplete(participant.id, participant.trials)) {
      Export.showParticipantExportPopup(participant, _dataset);
    }
    if (_pIndex < _participantIds.length - 1) {
      navigate(_pIndex + 1, 0);
    }
  }

  function prevParticipant() {
    ScoringUI.saveCurrentScore();
    if (_pIndex > 0) {
      navigate(_pIndex - 1, 0);
    }
  }

  function jumpToUnscored() {
    ScoringUI.saveCurrentScore();
    // Search from current position forward
    const startP = _pIndex;
    const startT = _tIndex + 1;

    for (let pi = startP; pi < _participantIds.length; pi++) {
      const pid = _participantIds[pi];
      const p = _participantData.get(pid);
      if (!p) { navigate(pi, 0); return; } // Not loaded yet, go there

      const shuffleOrder = State.getOrCreateShuffleOrder(pid, p.trials.length);
      const tStart = (pi === startP) ? startT : 0;

      for (let ti = tStart; ti < p.trials.length; ti++) {
        const originalIdx = shuffleOrder[ti];
        const trial = p.trials[originalIdx];
        const score = State.getScore(pid, trial.trial);
        if (!score || score.accuracy == null) {
          navigate(pi, ti);
          return;
        }
      }
    }

    // Wrap around from beginning
    for (let pi = 0; pi <= startP; pi++) {
      const pid = _participantIds[pi];
      const p = _participantData.get(pid);
      if (!p) { navigate(pi, 0); return; }

      const shuffleOrder = State.getOrCreateShuffleOrder(pid, p.trials.length);
      const tEnd = (pi === startP) ? _tIndex : p.trials.length;

      for (let ti = 0; ti < tEnd; ti++) {
        const originalIdx = shuffleOrder[ti];
        const trial = p.trials[originalIdx];
        const score = State.getScore(pid, trial.trial);
        if (!score || score.accuracy == null) {
          navigate(pi, ti);
          return;
        }
      }
    }
  }

  function getCurrentParticipant() {
    const pid = _participantIds[_pIndex];
    return _participantData.get(pid) || null;
  }

  function getCurrentTrial() {
    const p = getCurrentParticipant();
    if (!p || !_shuffleOrder) return null;
    const originalIdx = _shuffleOrder[_tIndex];
    return p.trials[originalIdx];
  }

  function updateIndicators() {
    const p = getCurrentParticipant();
    const trialCount = p ? p.trials.length : 24;
    document.getElementById('trial-indicator').textContent = `Trial ${_tIndex + 1}/${trialCount}`;
    document.getElementById('participant-indicator').textContent =
      `P ${_participantIds[_pIndex]} (${_pIndex + 1}/${_participantIds.length})`;
    updateProgress();
  }

  function updateProgress() {
    const totalTrials = _participantIds.length * 24;
    const scored = State.getTotalScoredCount();
    const pct = totalTrials > 0 ? (scored / totalTrials * 100) : 0;
    document.getElementById('progress-bar').style.width = `${pct}%`;
    document.getElementById('progress-text').textContent = `${scored} / ${totalTrials} scored`;
  }

  // ── Audio Preloading ──

  function getAudioUrl(trial) {
    const cached = _audioCache.get(trial.audioFileNormalized);
    if (cached) return cached;
    const pid = _participantIds[_pIndex];
    return `data/${trial._audioPath}/${pid}/${trial.audioFileNormalized}`;
  }

  async function preloadParticipantAudio(participant) {
    // Revoke old blob URLs
    for (const [, url] of _audioCache) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    _audioCache.clear();

    const pid = participant.id;
    const ds = _dataset;

    for (const trial of participant.trials) {
      const url = `data/${trial._audioPath}/${pid}/${trial.audioFileNormalized}`;
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const blob = await resp.blob();
          _audioCache.set(trial.audioFileNormalized, URL.createObjectURL(blob));
        }
      } catch (e) {
        // Silent fail for preload
      }
    }
  }

  return {
    init, setPosition, navigate, nextTrial, prevTrial,
    nextParticipant, prevParticipant, jumpToUnscored,
    getCurrentParticipant, getCurrentTrial,
    updateIndicators, updateProgress, getAudioUrl
  };
})();
