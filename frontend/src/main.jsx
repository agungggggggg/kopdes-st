import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { NodesProvider } from './nodes.jsx';
import { ToastProvider } from './components/Toaster.jsx';

// Font Plus Jakarta Sans (400–800) & JetBrains Mono (400/500/700) — self-hosted via @fontsource
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';

import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NodesProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </NodesProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
