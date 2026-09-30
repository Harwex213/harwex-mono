// Fast runs of light up the red neon blades. Every blade keeps its own random timer,
// speed and brightness, so the runs never line up; now and then a blade fires twice in a row.

type Run = {
  start: number;
  duration: number;
  strength: number;
};

function random(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

class NeonRuns {
  private readonly runs: Run[];
  private readonly out: Float32Array;

  constructor(count: number, now: number) {
    this.runs = Array.from({ length: count }, () => ({
      start: now + random(0.3, 4),
      duration: random(0.35, 0.6),
      strength: random(0.8, 1.2),
    }));
    this.out = new Float32Array(count * 2);
  }

  // Per blade: head position along the blade (0 bottom, 1 top) and strength; strength 0 when idle.
  update(now: number): Float32Array {
    this.runs.forEach((run, i) => {
      // The head starts a little below the blade and leaves past its top, so the tail fades out too.
      let head = -0.1 + ((now - run.start) / run.duration) * 1.6;
      if (head > 1.5) {
        const again = Math.random() < 0.3;
        run.start = now + (again ? random(0.08, 0.2) : random(1.4, 5));
        run.duration = random(0.35, 0.6);
        run.strength = random(0.8, 1.2);
        head = -1;
      }
      const active = now >= run.start && head <= 1.5;
      this.out[i * 2] = head;
      this.out[i * 2 + 1] = active ? run.strength : 0;
    });
    return this.out;
  }
}

export { NeonRuns };
