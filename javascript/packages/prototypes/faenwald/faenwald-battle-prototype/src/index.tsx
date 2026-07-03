import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installDefaultInterceptors } from '@/api/interceptors';
import { installMockAdapter } from '@/api/mock';
import { App } from '@/ui/App';

// API layer setup: register interceptors and serve canned data via the mock
// transport. Drop `installMockAdapter()` to talk to a real backend instead.
installDefaultInterceptors();
installMockAdapter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
