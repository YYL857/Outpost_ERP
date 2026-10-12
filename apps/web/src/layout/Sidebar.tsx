import { NavLink } from "react-router-dom";
import outpostMark from "../assets/outpost-mark.png";
import { canAccessModule, MODULES, type AppModule } from "../modules";
import type { UserRole } from "../api";

type Props = {
  onOpen: (mod: AppModule) => void;
  role?: UserRole | null;
  /** @deprecated 用 role；保留兼容 */
  isAdmin?: boolean;
};

export function Sidebar({ onOpen, role, isAdmin }: Props) {
  const effectiveRole =
    role ?? (isAdmin ? ("admin" as UserRole) : ("ops" as UserRole));
  const visible = MODULES.filter((m) => canAccessModule(m, effectiveRole));
  const groups = [...new Set(visible.map((m) => m.group))];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <img
            className="brand-logo"
            src={outpostMark}
            alt=""
            width={30}
            height={30}
            aria-hidden
          />
          <span className="brand-name">慧运营</span>
        </div>
        <div className="brand-sub">跨境经营台</div>
      </div>

      {groups.map((group) => (
        <div className="nav-group" key={group}>
          <div className="nav-group-title">{group}</div>
          {visible
            .filter((m) => m.group === group)
            .map((mod) => (
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
