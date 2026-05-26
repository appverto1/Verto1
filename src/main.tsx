import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installClarityTracking } from './clarity.ts';

installClarityTracking();

createRoot(document.getElementById('root')!).render(
  <div className="notranslate" translate="no">
    <App />
  </div>,
);
