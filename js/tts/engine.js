export class TtsEngine {
  constructor({ onBoundary, onSentenceStart, onSentenceEnd, onEnd, onError } = {}) {
    this._onBoundary = onBoundary;
    this._onSentenceStart = onSentenceStart;
    this._onSentenceEnd = onSentenceEnd;
    this._onEnd = onEnd;
    this._onError = onError;
    this._voice = null;
    this._rate = 1.0;
    this._pitch = 1.0;
    this._sentences = [];
    this._cancelled = false;
    this._currentIndex = -1;
  }

  async loadVoices() {
    const voices = speechSynthesis.getVoices();
    if (voices.length) return voices;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        speechSynthesis.removeEventListener('voiceschanged', finish);
        resolve(speechSynthesis.getVoices());
      };
      speechSynthesis.addEventListener('voiceschanged', finish);
      // Fallback: some browsers fire voiceschanged synchronously or not at all
      setTimeout(finish, 2500);
    });
  }

  setVoice(voice) { this._voice = voice; }
  setRate(rate)   { this._rate = rate; }
  setPitch(pitch) { this._pitch = pitch; }

  speakSentences(sentences, startIndex = 0) {
    this._sentences = sentences;
    this._cancelled = false;
    speechSynthesis.cancel();
    // Android Chrome ignores speak() called synchronously after cancel(); defer one tick.
    setTimeout(() => {
      if (!this._cancelled) this._speakAt(startIndex);
    }, 0);
  }

  _speakAt(index) {
    if (this._cancelled) return;
    if (index >= this._sentences.length) {
      if (this._onEnd) this._onEnd();
      return;
    }
    this._currentIndex = index;
    if (this._onSentenceStart) this._onSentenceStart(index);
    const text = this._sentences[index];
    const utt = new SpeechSynthesisUtterance(text);
    if (this._voice) utt.voice = this._voice;
    utt.rate = this._rate;
    utt.pitch = this._pitch;

    utt.onboundary = (e) => {
      if (e.name === 'word' && this._onBoundary) {
        this._onBoundary({ sentenceIndex: index, charIndex: e.charIndex, charLength: e.charLength || 0 });
      }
    };
    utt.onend = () => {
      if (this._cancelled) return;
      if (this._onSentenceEnd) this._onSentenceEnd(index);
      this._speakAt(index + 1);
    };
    utt.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      console.warn('tts:engine', e.error, e);
      if (this._onError) this._onError(e);
    };
    speechSynthesis.speak(utt);
  }

  pause() {
    speechSynthesis.pause();
  }

  resume() {
    // Some Android/Chrome versions require re-speaking on resume
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
    }
  }

  cancel() {
    this._cancelled = true;
    speechSynthesis.cancel();
    this._currentIndex = -1;
  }

  get speaking()      { return speechSynthesis.speaking && !speechSynthesis.paused; }
  get paused()        { return speechSynthesis.paused; }
  get currentIndex()  { return this._currentIndex; }
}
