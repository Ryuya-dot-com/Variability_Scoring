/**
 * state.js - localStorage persistence with shuffle order support
 */
const State = (() => {
  let _state = null;
  let _saveTimeout = null;
  const STORAGE_PREFIX = 'vocabScorer_';

  function key(raterId, datasetId) {
    return `${STORAGE_PREFIX}${raterId}_${datasetId}`;
  }

  function create(raterId, datasetId, participantIds) {
    _state = {
      raterId,
      datasetId,
      assignedParticipants: participantIds,
      currentParticipantIndex: 0,
      currentTrialIndex: 0,
      scores: {},
      shuffleOrders: {},
      lastSaved: new Date().toISOString()
    };
    save();
    return _state;
  }

  function load(raterId, datasetId) {
    try {
      const data = localStorage.getItem(key(raterId, datasetId));
      if (data) {
        const parsed = JSON.parse(data);
        // Migration: add shuffleOrders if missing
        if (!parsed.shuffleOrders) parsed.shuffleOrders = {};
        _state = parsed;
        return _state;
      }
    } catch (e) {
      console.error('Failed to load state:', e);
    }
    return null;
  }

  function get() { return _state; }

  function save() {
    if (!_state) return;
    _state.lastSaved = new Date().toISOString();
    try {
      localStorage.setItem(key(_state.raterId, _state.datasetId), JSON.stringify(_state));
    } catch (e) {
      console.error('Failed to save state:', e);
    }
  }

  function debouncedSave() {
    if (_saveTimeout) clearTimeout(_saveTimeout);
    _saveTimeout = setTimeout(save, 500);
  }

  function setPosition(pIndex, tIndex) {
    if (!_state) return;
    _state.currentParticipantIndex = pIndex;
    _state.currentTrialIndex = tIndex;
    debouncedSave();
  }

  function getScore(participantId, trialNum) {
    if (!_state) return null;
    return _state.scores[`${participantId}_${trialNum}`] || null;
  }

  function setScore(participantId, trialNum, data) {
    if (!_state) return;
    const scoreKey = `${participantId}_${trialNum}`;
    _state.scores[scoreKey] = {
      ...(_state.scores[scoreKey] || {}),
      ...data,
      scoredAt: new Date().toISOString()
    };
    debouncedSave();
  }

  function getTotalScoredCount() {
    if (!_state) return 0;
    return Object.values(_state.scores).filter(s => s.accuracy != null).length;
  }

  function getParticipantScoredCount(participantId, trials) {
    if (!_state || !trials) return 0;
    return trials.filter(t => {
      const s = _state.scores[`${participantId}_${t.trial}`];
      return s && s.accuracy != null;
    }).length;
  }

  function isParticipantComplete(participantId, trials) {
    if (!trials || trials.length === 0) return false;
    return getParticipantScoredCount(participantId, trials) === trials.length;
  }

  // ── Shuffle Orders ──

  function getOrCreateShuffleOrder(participantId, trialCount) {
    if (!_state) return null;
    if (_state.shuffleOrders[participantId]) {
      return _state.shuffleOrders[participantId];
    }
    // Fisher-Yates shuffle
    const order = Array.from({ length: trialCount }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    _state.shuffleOrders[participantId] = order;
    save();
    return order;
  }

  function getShuffleOrder(participantId) {
    if (!_state) return null;
    return _state.shuffleOrders[participantId] || null;
  }

  // ── Session listing ──

  function listSessions() {
    const sessions = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(STORAGE_PREFIX)) {
        try {
          const data = JSON.parse(localStorage.getItem(k));
          sessions.push(data);
        } catch (e) { /* skip */ }
      }
    }
    return sessions;
  }

  return {
    create, load, get, save, debouncedSave, setPosition,
    getScore, setScore, getTotalScoredCount,
    getParticipantScoredCount, isParticipantComplete,
    getOrCreateShuffleOrder, getShuffleOrder,
    listSessions
  };
})();
