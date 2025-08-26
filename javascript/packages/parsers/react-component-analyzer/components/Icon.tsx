import React from 'react';

interface IconProps {
  name: string;
  size?: 'small' | 'medium' | 'large';
}

export function Icon({ name, size = 'medium' }: IconProps) {
  return (
    <span className={`icon icon-${name} icon-${size}`}>
      {name}
    </span>
  );
} 