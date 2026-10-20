import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const isOld = /^\/old\/?$/.test(window.location.pathname);
const App = lazy(() => import('./App'));
import './styles.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><Suspense fallback={<p>Loading VeoNav…</p>}><App puneDefault={!isOld}/></Suspense></React.StrictMode>);
