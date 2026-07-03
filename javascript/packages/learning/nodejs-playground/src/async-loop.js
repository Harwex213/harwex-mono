async function withConcurrency(
  items,
  limit,
  worker,
) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (cursor < items.length) {
      const index = cursor++;

      console.log("Started", index);

      results[index] = await worker(items[index], index);

      console.log("Finished", index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runner),
  );
  return results;
}

const tasks = [
  ["B", 200],
  ["A", 2000],
  ["C", 200],
  ["C", 200],
];

const processTask = ([v, ms]) => new Promise((res) => setTimeout(() => res(v), ms));

await withConcurrency(tasks, 2, (task) => processTask(task));