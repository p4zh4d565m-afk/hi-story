import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { UndoProvider } from './hooks/useUndoManager';
import './styles/index.css';

const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <UndoProvider>
      <App />
    </UndoProvider>
  </React.StrictMode>
);
