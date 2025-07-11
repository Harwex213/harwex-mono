import React from 'react';
import { Logo } from './Logo';

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="header">
      <Logo />
      <h1>{title}</h1>
    </header>
  );
} 