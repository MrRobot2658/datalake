import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { TenantProvider } from "./context/TenantContext";
import Dashboard from "./pages/Dashboard";
import FilterPage from "./pages/FilterPage";
import EtlPage from "./pages/EtlPage";
import ObjectListPage from "./pages/ObjectListPage";

// 生产挂在 /console 下，dev 用根路径
const BASENAME = import.meta.env.PROD ? "/console" : "/";

export default function App() {
  return (
    <TenantProvider>
      <BrowserRouter basename={BASENAME}>
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
