import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { mountCombatStatsOverlay } from './hud/combatStatsOverlay';
import { mountResponsiveHudScale } from './hud/responsiveHudScale';
import './styles.css';
import './hud-overrides.css';
import './command-controls.css';
import './combat-stats.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

mountCombatStatsOverlay();
const disposeResponsiveHudScale = mountResponsiveHudScale();

if (import.meta.hot) {
  import.meta.hot.dispose(disposeResponsiveHudScale);
}
