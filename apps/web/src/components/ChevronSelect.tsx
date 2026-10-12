import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ChevronSelectOption = { value: string; label: string };

type Props = {
  value: string;
  options: ChevronSelectOption[];
  onChange: (next: string) => void;
  /** 值不在 options 时的展示文案 */
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  triggerClassName?: string;
};

/**
 * 自定义下拉：展开时箭头旋转，收起转回。
 * 菜单 portal 到 body + fixed，避免顶栏 backdrop-filter / 表格 overflow 导致错位裁切。
 */
export function ChevronSelect({
  value,
  options,
  onChange,
  placeholder = "请选择",
  disabled = false,
  title,
  className,
  triggerClassName = "input",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const r = rootRef.current!.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const menuH = Math.min(220, options.length * 32 + 8);
      const openUp = spaceBelow < menuH && r.top > spaceBelow;
      const width = Math.max(r.width, 88);
      let left = r.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      setMenuPos({
        top: openUp ? Math.max(8, r.top - menuH - 2) : r.bottom + 2,
        left,
        width,
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const label =
    options.find((o) => o.value === value)?.label ?? placeholder;

  const menu =
    open && menuPos
      ? createPortal(
          <ul
            ref={menuRef}
            className="op-dd-menu"
            role="listbox"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
            }}
          >
            {options.map((o) => (
              <li key={`${o.value}\0${o.label}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={
                    o.value === value
                      ? "op-dd-option is-active"
                      : "op-dd-option"
                  }
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div
      className={`op-dd${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}${
        className ? ` ${className}` : ""
      }`}
      ref={rootRef}
      title={title}
    >
      <button
        type="button"
        className={`${triggerClassName} op-dd-trigger`.trim()}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
      >
        <span className="op-dd-label">{label}</span>
        <span className="op-dd-caret" aria-hidden />
      </button>
      {menu}
    </div>
  );
}
