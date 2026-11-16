import React from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <main><h1>MARK-1</h1><p>Customer portal foundation</p></main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
