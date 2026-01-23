import { useState, useMemo, useCallback } from 'react';
import { router } from '../router-di';
import {
  VirtualListProvider,
  VirtualListRoot,
  VirtualNode,
  type VirtualTreeNode,
} from '../virtual-list';
import classes from './virtual-list-demo.module.css';

interface TreeItemData {
  title: string;
  description: string;
}

// Generate tree data with variable heights and deep nesting
function generateTreeData(
  count: number,
  maxDepth: number,
  currentDepth: number = 0,
  idPrefix: string = ''
): VirtualTreeNode<TreeItemData>[] {
  const nodes: VirtualTreeNode<TreeItemData>[] = [];
  const itemsAtThisLevel = currentDepth === 0 ? Math.min(count, 100) : Math.min(count, 10);

  for (let i = 0; i < itemsAtThisLevel; i++) {
    const id = `${idPrefix}${i}`;
    const height = 50 + Math.floor(Math.random() * 150); // Variable heights: 50-200px
    const hasChildren = currentDepth < maxDepth && Math.random() > 0.3;

    const node: VirtualTreeNode<TreeItemData> = {
      id,
      height,
      data: {
        title: `Item ${id}`,
        description: `This is item ${id} at depth ${currentDepth} with height ${height}px`,
      },
      children: hasChildren
        ? generateTreeData(
          Math.floor(Math.random() * 8) + 2, // 2-10 children
          maxDepth,
          currentDepth + 1,
          `${id}-`
        )
        : undefined,
    };

    nodes.push(node);
  }

  return nodes;
}

function VirtualListDemo() {
  const [scrollMode, setScrollMode] = useState<'window' | 'container'>('window');
  const [overscan, setOverscan] = useState(3);
  const [itemCount, setItemCount] = useState(10000);
  const [maxDepth, setMaxDepth] = useState(5);

  // Generate tree data
  const treeData = useMemo(() => {
    const data = generateTreeData(itemCount, maxDepth);
    console.log('Generated tree data:', data.length, 'root nodes');
    return data;
  }, [itemCount, maxDepth]);

  // Render function for items
  const renderItem = useCallback((node: VirtualTreeNode<TreeItemData>, depth: number) => {
    return (
      <div
        className={classes.item}
        style={{
          paddingLeft: `${depth * 20}px`,
          backgroundColor: depth % 2 === 0 ? '#f9f9f9' : '#ffffff',
          borderLeft: `4px solid hsl(${depth * 60}, 70%, 60%)`,
        }}
      >
        <div className={classes.itemTitle}>{node.data.title}</div>
        <div className={classes.itemDescription}>{node.data.description}</div>
      </div>
    );
  }, []);

  return (
    <div className={classes.container}>
      {/* Controls */}
      <div className={classes.controls}>
        <h1>Virtual List Demo</h1>

        <div className={classes.controlGroup}>
          <label>
            Scroll Mode:
            <select
              value={scrollMode}
              onChange={(e) => setScrollMode(e.target.value as 'window' | 'container')}
            >
              <option value="window">Window</option>
              <option value="container">Container</option>
            </select>
          </label>

          <label>
            Overscan:
            <input
              type="number"
              value={overscan}
              onChange={(e) => setOverscan(Number(e.target.value))}
              min="0"
              max="20"
            />
          </label>

          <label>
            Items:
            <input
              type="number"
              value={itemCount}
              onChange={(e) => setItemCount(Number(e.target.value))}
              min="100"
              max="50000"
              step="100"
            />
          </label>

          <label>
            Max Depth:
            <input
              type="number"
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
              min="1"
              max="10"
            />
          </label>
        </div>

        <div className={classes.metrics}>
          <div className={classes.metric}>
            <strong>Root Nodes:</strong> {treeData.length}
          </div>
        </div>
      </div>

      {/* Virtual List */}
      <div className={classes.listContainer}>
        {scrollMode === 'container' ? (
          <div className={classes.scrollContainer}>
            <VirtualListProvider
              nodes={treeData}
              scrollMode="container"
              overscan={overscan}
            >
              <VirtualListRoot>
                {treeData.map(node => (
                  <VirtualNode
                    key={node.id}
                    node={node}
                    renderItem={renderItem}
                  />
                ))}
              </VirtualListRoot>
            </VirtualListProvider>
          </div>
        ) : (
          <>
            <div className={classes.spacer}>
              <p>Scroll down to see the virtual list...</p>
            </div>
            <VirtualListProvider
              nodes={treeData}
              scrollMode="window"
              overscan={overscan}
            >
              <VirtualListRoot>
                {treeData.map(node => (
                  <VirtualNode
                    key={node.id}
                    node={node}
                    renderItem={renderItem}
                  />
                ))}
              </VirtualListRoot>
            </VirtualListProvider>
          </>
        )}
      </div>
    </div>
  );
}

router.registerRoute('/virtual-list-demo', VirtualListDemo);

export { VirtualListDemo };
