import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './app/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';

const container = document.getElementById('root');
if (!container) throw new Error('#root не найден в index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
