export class TrainingManager {
  constructor(prefs) {
    this.prefs = prefs;
    this._counter = 0;
  }

  onWordsRead(count, adjustWpmFn) {
    if (!this.prefs.data.trainingEnabled) return;
    this._counter += count;
    if (this._counter >= this.prefs.data.trainingInterval && adjustWpmFn) {
      this._counter = 0;
      adjustWpmFn(this.prefs.data.trainingIncrement);
    }
  }

  reset() {
    this._counter = 0;
  }
}
