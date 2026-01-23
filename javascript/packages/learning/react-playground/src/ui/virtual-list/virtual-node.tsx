import { memo, type ReactNode } from 'react';
import type { VirtualTreeNode } from './types';
import { useVirtualList } from './use-virtual-list';
import styles from './virtual-list.module.css';

export interface VirtualNodeProps<T = unknown> {
  node: VirtualTreeNode<T>;
  renderItem: (node: VirtualTreeNode<T>, depth: number) => ReactNode;
}

function VirtualNodeInner<T>({ node, renderItem }: VirtualNodeProps<T>) {
  const { isNodeVisible, flatIndex } = useVirtualList();
  
  const flatNode = flatIndex.get(node.id);
  const isVisible = isNodeVisible(node.id);

  if (!flatNode) {
    return null;
  }

  // If node is not visible, render placeholder with total height
  if (!isVisible) {
    return (
      <div
        className={styles.virtualNodePlaceholder}
        style={{
          height: `${flatNode.totalHeight}px`,
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
        }}
        data-node-id={node.id}
        data-placeholder="true"
      />
    );
  }

  // Node is visible - render content and children
  return (
    <div
      className={styles.virtualNode}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        minHeight: `${node.height}px`,
      }}
      data-node-id={node.id}
    >
      {/* Render the item content */}
      <div
        className={styles.virtualNodeContent}
        style={{ minHeight: `${node.height}px` }}
      >
        {renderItem(node, flatNode.depth)}
      </div>

      {/* Render children if they exist */}
      {node.children && node.children.length > 0 && (
        <div
          className={styles.virtualNodeChildren}
          style={{
            position: 'relative',
            top: 0,
          }}
        >
          {node.children.map(child => (
            <VirtualNode
              key={child.id}
              node={child}
              renderItem={renderItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Memoize to prevent unnecessary re-renders
export const VirtualNode = memo(VirtualNodeInner, (prev, next) => {
  // Only re-render if node reference or renderItem changes
  return prev.node === next.node && prev.renderItem === next.renderItem;
}) as <T>(props: VirtualNodeProps<T>) => ReactNode;
