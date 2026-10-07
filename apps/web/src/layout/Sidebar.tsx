import { NavLink } from "react-router-dom";
import outpostMark from "../assets/outpost-mark.svg";
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
