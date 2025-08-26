import React from 'react';
import { Logo } from './Logo';

const ShouldBeIgnored2 = () => {
  return <div>ShouldBeIgnored</div>;
};

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