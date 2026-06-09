const NODES_ID = {
  INIT: 0,
  FIRST: 1,
  SECOND: 2,
  THIRD: 3,
  FOUR: 4,
  FIVE: 5,
  SIXTH: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  TEN: 10,
  TARGET: 11,
};

const createGraph = () => {
  const nodes = new Map();

  let i = 1;
  for (const nodeIdKey in NODES_ID) {
    const node = {
      x: 30 * i,
      y: 30 * i,
      radius: 10,
      weight: i === 1 ? 0 : Math.trunc(Math.random() * 100) % 200,
      relations: i === NODES_ID.TARGET ? [] : [i],
      color: ,
    }

    i++;

    nodes.set(NODES_ID[nodeIdKey], node);
  }

  return nodes;
}

const dijkstraGraph = () => {
  const graph = createGraph();
}