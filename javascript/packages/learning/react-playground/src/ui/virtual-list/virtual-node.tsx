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

  // Calculate position relative to parent or root
  // If node has a parent, we need to calculate offset from parent's children container
  const parentNode = flatNode.parentId ? flatIndex.get(flatNode.parentId) : null;
  const relativeTop = parentNode
    ? flatNode.absoluteTop - (parentNode.absoluteTop + parentNode.height)
    : flatNode.absoluteTop;

  // If node is not visible, render placeholder with total height
  if (!isVisible) {
    return (
      <div
        className={styles.virtualNodePlaceholder}
        style={{
          height: `${flatNode.totalHeight}px`,
          position: 'absolute',
          top: `${relativeTop}px`,
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
        top: `${relativeTop}px`,
        left: 0,
        right: 0,
        minHeight: `${node.height}px`,
        height: `${node.height}px`,
      }}
      data-node-id={node.id}
    >
      {/* Render the item content */}
      <div
        className={styles.virtualNodeContent}
        style={{ minHeight: `${node.height}px`, height: `${node.height}px` }}
      >
        {renderItem(node, flatNode.depth)}
      </div>

      {/* Render children if they exist */}
      {node.children && node.children.length > 0 && (
        <div
          className={styles.virtualNodeChildren}
          style={{
            position: 'relative',
            height: `${flatNode.totalHeight - flatNode.height}px`,
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
