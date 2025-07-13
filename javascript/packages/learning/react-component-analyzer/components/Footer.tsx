import React from 'react';
import { SocialLinks } from './SocialLinks';
import { SomeExternalComponent } from 'not-real-lib';

export function Footer() {
  return (
    <footer className="footer">
      <p>&copy; 2024 Harwex. All rights reserved.</p>
      <SocialLinks/>
      <SomeExternalComponent/>
    </footer>
  );
} 