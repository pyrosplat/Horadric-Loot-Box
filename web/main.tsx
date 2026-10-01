// The web trade page (npm run dev:web / build:web): trade-only, on files dropped into the browser.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { WebApp } from '../src/web/App';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '../src/index.css';
import { applyUiScale, savedUiScale, setDefaultUiScale } from '../src/ui/scale';
import { WEB_UI_SCALE } from '../src/web/WebStore';

setDefaultUiScale(WEB_UI_SCALE);
void applyUiScale(savedUiScale());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WebApp />
  </React.StrictMode>,
);
