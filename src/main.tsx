import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AdminPage from './AdminPage';
import CarnivalPage from './CarnivalPage';
import './styles.css';

const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
const isCarnivalRoute = window.location.pathname === '/carnival' || window.location.pathname.startsWith('/carnival/');
document.documentElement.classList.toggle('is-admin-route', isAdminRoute);
document.body.classList.toggle('is-admin-route', isAdminRoute);
document.documentElement.classList.toggle('is-carnival-route', isCarnivalRoute);
document.body.classList.toggle('is-carnival-route', isCarnivalRoute);
if (isCarnivalRoute) document.title = '心动游园会 · 心近';

const page = isAdminRoute
  ? <AdminPage />
  : isCarnivalRoute
    ? <CarnivalPage />
    : <App />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {page}
  </StrictMode>,
);
