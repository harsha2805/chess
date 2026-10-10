import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { watchErrors } from './lib/diagnostics';
import { init } from './lib/store';
import './styles.css';

watchErrors();
void init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
