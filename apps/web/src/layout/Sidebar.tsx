import { NavLink } from "react-router-dom";
import { MODULES, type AppModule } from "../modules";

const groups = [...new Set(MODULES.map((m) => m.group))];

type Props = {
  onOpen: (mod: AppModule) => void;
};

export function Sidebar({ onOpen }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <span className="brand-logo" aria-hidden />
          <span className="brand-name">前哨</span>
        </div>
        <div className="brand-sub">Outpost · 跨境经营台</div>
      </div>

      {groups.map((group) => (
        <div className="nav-group" key={group}>
          <div className="nav-group-title">{group}</div>
          {MODULES.filter((m) => m.group === group).map((mod) => (
            <NavLink
              key={mod.key}
              to={mod.path}
              className={({ isActive }) =>
                `nav-item${isActive ? " active" : ""}`
              }
              onClick={() => onOpen(mod)}
            >
              <span>{mod.title}</span>
              <span className="nav-phase">{mod.phase}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </aside>
  );
}
