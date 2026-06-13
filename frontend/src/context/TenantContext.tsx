import { createContext, useContext, useState, type ReactNode } from "react";

interface TenantCtx {
  tenant: number;
  setTenant: (t: number) => void;
  tenants: number[];
}
const Ctx = createContext<TenantCtx>({ tenant: 1001, setTenant: () => {}, tenants: [1001, 1002] });

export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenant, setTenant] = useState(1001);
  return (
    <Ctx.Provider value={{ tenant, setTenant, tenants: [1001, 1002] }}>
      {children}
    </Ctx.Provider>
  );
}
export const useTenant = () => useContext(Ctx);
