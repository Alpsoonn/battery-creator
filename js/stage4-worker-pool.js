(function () {
  "use strict";

  class Stage4WorkerPool {
    constructor(workerUrl) {
      this.workers = [];
      this.idleWorkers = [];
      this.queue = [];
      this.jobs = new Map();
      this.sequence = 0;
      this.failed = false;
      const logicalProcessors = Math.max(1, Number(navigator.hardwareConcurrency) || 2);
      this.logicalProcessors = logicalProcessors;
      this.requestedWorkerCount = Math.max(1, logicalProcessors - 1);
      if (typeof Worker !== "function") { this.failed = true; return; }
      for (let index = 0; index < this.requestedWorkerCount; index++) {
        try {
          let worker;
          try {
            worker = new Worker(workerUrl, { name: `stage4-compute-${index + 1}` });
          } catch (namedWorkerError) {
            // Starsze silniki obsługują klasyczne Workery, ale nie przyjmują
            // jeszcze obiektu WorkerOptions z nazwą wątku.
            worker = new Worker(workerUrl);
          }
          worker.addEventListener("message", event => this.finish(worker, event.data));
          worker.addEventListener("error", event => this.fail(worker, event.error || new Error(event.message || "Błąd Web Workera")));
          this.workers.push(worker);
          this.idleWorkers.push(worker);
        } catch (error) {
          // Gdy przeglądarka lub system ogranicza liczbę wątków, zachowujemy
          // już uruchomioną część puli zamiast wyłączać wielowątkowość w całości.
          break;
        }
      }
      if (!this.workers.length) this.failed = true;
    }

    get size() { return this.failed ? 0 : this.workers.length; }

    run(type, payload) {
      if (!this.size) return Promise.reject(new Error("Pula Web Workerów jest niedostępna."));
      return new Promise((resolve, reject) => {
        this.queue.push({ id: ++this.sequence, type, payload, resolve, reject });
        this.pump();
      });
    }

    pump() {
      while (this.idleWorkers.length && this.queue.length) {
        const worker = this.idleWorkers.pop(), job = this.queue.shift();
        worker.__stage4JobId = job.id;
        this.jobs.set(job.id, job);
        worker.postMessage({ id: job.id, type: job.type, payload: job.payload });
      }
    }

    finish(worker, message) {
      const job = this.jobs.get(message?.id);
      if (!job) return;
      this.jobs.delete(job.id);
      worker.__stage4JobId = null;
      this.idleWorkers.push(worker);
      if (message.ok) job.resolve(message.result);
      else job.reject(new Error(message.error || "Worker odrzucił zadanie."));
      this.pump();
    }

    fail(worker, error) {
      const jobId = worker.__stage4JobId, job = this.jobs.get(jobId);
      if (job) { this.jobs.delete(jobId); job.reject(error); }
      this.failed = true;
      this.destroy(error);
    }

    destroy(reason = new Error("Pula Web Workerów została zamknięta.")) {
      this.workers.forEach(worker => worker.terminate());
      this.workers = [];
      this.idleWorkers = [];
      this.jobs.forEach(job => job.reject(reason));
      this.jobs.clear();
      this.queue.splice(0).forEach(job => job.reject(reason));
    }
  }

  window.Stage4WorkerPool = Stage4WorkerPool;
})();
