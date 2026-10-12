import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { watchErrors } from './lib/diagnostics';
import { initAccount } from './lib/account';
import { init } from './lib/store';
import './styles.css';

watchErrors();
// The account is checked once the stored games are loaded, so they can be compared.
void init().then(initAccount);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
