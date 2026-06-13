import { Building2, ChevronDown } from "lucide-react";
import { useTenant } from "../../context/TenantContext";

export default function Header({ title }: { title: string }) {
  const { tenant, setTenant, tenants } = useTenant();
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-gray-200 bg-white/90 px-6 backdrop-blur">
      <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <select
            value={tenant}
            onChange={(e) => setTenant(Number(e.target.value))}
            className="appearance-none rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm font-medium text-gray-700 focus:border-brand-400 focus:outline-none"
          >
            {tenants.map((t) => (
              <option key={t} value={t}>
                租户 {t}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-600">
          A
        </div>
      </div>
    </header>
  );
}
