import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { DocumentsPage } from './pages/DocumentsPage';
import { ReviewPage } from './pages/ReviewPage';
import { ActivityPage } from './pages/ActivityPage';
import './styles.css';

function LegacyDocumentRedirect() {
  const { id } = useParams();
  return <Navigate to={`/documents/${id}/review`} replace />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/documents/activity" element={<ActivityPage />} />
        <Route path="/documents/:id" element={<LegacyDocumentRedirect />} />
        <Route path="/documents/:id/:view" element={<ReviewPage />} />
        <Route path="*" element={<Navigate to="/documents" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
