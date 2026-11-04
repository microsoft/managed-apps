import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { initAppStorage } from './storage';
import { startSettingsEffects } from './settings/settingsStore';

// Storage is opened (and review state loaded) before the first render, so every
// synchronous read in the app sees the stored data.
void initAppStorage().then(() => {
  startSettingsEffects();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
