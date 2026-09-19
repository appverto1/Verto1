import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installClarityTracking } from './clarity.ts';
import { OnboardingHost } from './components/OnboardingHost.tsx';

installClarityTracking();

createRoot(document.getElementById('root')!).render(
  <div className="notranslate" translate="no">
    <App />
    <OnboardingHost />
  </div>,
);
