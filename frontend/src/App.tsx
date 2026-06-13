import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { TenantProvider } from "./context/TenantContext";
import Dashboard from "./pages/Dashboard";
import FilterPage from "./pages/FilterPage";
import EtlPage from "./pages/EtlPage";
import ObjectListPage from "./pages/ObjectListPage";

export default function App() {
  return (
    <TenantProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/filter" element={<FilterPage />} />
          <Route path="/etl" element={<EtlPage />} />
          <Route path="/objects/:key" element={<ObjectListPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </TenantProvider>
  );
}
