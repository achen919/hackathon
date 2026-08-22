import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AdminPage from './AdminPage';
import './styles.css';

const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
document.documentElement.classList.toggle('is-admin-route', isAdminRoute);
document.body.classList.toggle('is-admin-route', isAdminRoute);

const page = isAdminRoute
  ? <AdminPage />
  : <App />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {page}
  </StrictMode>,
);
