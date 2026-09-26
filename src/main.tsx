import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './index.css';
import { applyUiScale, savedUiScale } from './ui/scale';

void applyUiScale(savedUiScale());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
