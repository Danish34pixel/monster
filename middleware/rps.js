// Lightweight RPS (requests-per-second) middleware
// Counts incoming requests and maintains a rolling window of per-second counts.
// Export middleware function and a getter for the latest metrics.

const { EventEmitter } = require("events");

class RPSMonitor extends EventEmitter {
  constructor(windowSize = 60) {
    super();
    this.windowSize = windowSize; // seconds of history
    this.buckets = new Array(windowSize).fill(0);
    this.currentSecond = Math.floor(Date.now() / 1000);
    this.total = 0;
    this.started = false;
  }

  _rollIfNeeded() {
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec === this.currentSecond) return;
    const shift = Math.min(this.windowSize, nowSec - this.currentSecond);
    for (let i = 0; i < shift; i++) {
      // drop the oldest bucket and append a zero
      const removed = this.buckets.shift();
      this.total -= removed;
      this.buckets.push(0);
    }
    this.currentSecond = nowSec;
  }

  increment() {
    this._rollIfNeeded();
    this.buckets[this.buckets.length - 1] += 1;
    this.total += 1;
    this.emit("tick");
  }

  getLastSecond() {
    this._rollIfNeeded();
    // last bucket is current second
    return this.buckets[this.buckets.length - 1] || 0;
  }

  getHistory() {
    this._rollIfNeeded();
    // return a shallow copy of the buckets (oldest-first)
    return this.buckets.slice();
  }

  getAverage() {
    this._rollIfNeeded();
    return Math.round(this.total / this.windowSize);
  }
}

const monitor = new RPSMonitor(60);

// Express middleware
function rpsMiddleware(req, res, next) {
  try {
    monitor.increment();
  } catch (e) {
    // don't break the app if metrics fail
    console.warn("RPS middleware error", e && e.message);
  }
  next();
}

module.exports = {
  rpsMiddleware,
  rpsMonitor: monitor,
};
