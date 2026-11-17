import React from 'react';
import { createRoot } from 'react-dom/client';
import { PortalApi } from './api.js';
import { CustomerPortal } from './portal.js';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(
  <React.StrictMode>
    <CustomerPortal api={new PortalApi()} />
  </React.StrictMode>,
);
