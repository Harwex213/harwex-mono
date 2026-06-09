const renderNode = (ctx, node) => {
  ctx.beginPath();
  ctx.arc(node.x, node.y, node.radius, 0, 2 * Math.PI);
  ctx.strokeStyle = node.color;
  ctx.stroke();
};

const renderRelations = (ctx, graph, initId) => {
  let node = graph.get(initId);

  while (node !== null) {
    for (const relation of node.relations) {
      const relation = graph.get();
    }
  }
};

const renderGraph = (ctx, graph, initId) => {
  ctx.reset();

  const initNode = graph.get(initId);

};

export { renderGraph };
