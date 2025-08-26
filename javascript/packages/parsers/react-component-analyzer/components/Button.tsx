import React from 'react';
import { Icon } from './Icon';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}

export function Button({ children, onClick, variant = 'primary' }: ButtonProps) {
  return (
    <button 
      className={`btn btn-${variant}`} 
      onClick={onClick}
    >
      <Icon name="arrow-right" />
      {children}
    </button>
  );
} 