import { NavLink } from "react-router-dom";
import { LayoutDashboard, Filter, Workflow, Database } from "lucide-react";
import { OBJECTS } from "../../lib/objects";

const linkBase =
  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors";
const active = "bg-brand-50 text-brand-600";
const idle = "text-gray-600 hover:bg-gray-100 hover:text-gray-900";

function Item({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <NavLink to={to} end className={({ isActive }) => `${linkBase} ${isActive ? active : idle}`}>
      <Icon className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-gray-200 bg-white lg:flex lg:flex-col">
      <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-white">
          <Database className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-900">CDP 控制台</div>
          <div className="text-xs text-gray-400">圈人 · 多对象</div>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
        <div className="space-y-1">
          <Item to="/" icon={LayoutDashboard} label="概览" />
          <Item to="/filter" icon={Filter} label="统一筛选器" />
          <Item to="/etl" icon={Workflow} label="可视化 ETL" />
        </div>

        <div>
          <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            对象
          </div>
          <div className="space-y-1">
            {OBJECTS.map((o) => (
              <Item key={o.key} to={`/objects/${o.key}`} icon={o.icon} label={o.label} />
            ))}
          </div>
        </div>
      </nav>

      <div className="border-t border-gray-200 px-6 py-4 text-xs text-gray-400">
        sql-engine · DSL 引擎
      </div>
    </aside>
  );
}
