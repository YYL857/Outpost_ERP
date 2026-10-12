import {
  forwardRef,
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
  type MouseEvent,
} from "react";

const SKIP_TYPES = new Set([
  "checkbox",
  "radio",
  "file",
  "hidden",
  "range",
  "color",
  "button",
  "submit",
  "reset",
  "image",
]);

function hasContent(value: InputHTMLAttributes<HTMLInputElement>["value"]): boolean {
  if (value == null) return false;
  return String(value).length > 0;
}

export type ClearableInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** 为 false 时退回原生 input（仍保留 className） */
  clearable?: boolean;
};

/**
 * 带清空叉的输入框：有内容时右侧显示 ×，点击清空。
 * 对 file/checkbox 等类型自动退回原生 input。
 */
export const ClearableInput = forwardRef<HTMLInputElement, ClearableInputProps>(
  function ClearableInput(
    {
      className,
      clearable = true,
      disabled,
      readOnly,
      type,
      value,
      onChange,
      style,
      ...rest
    },
    ref,
  ) {
    const reactId = useId();
    const inputType = type ?? "text";
    const skip = !clearable || SKIP_TYPES.has(inputType);
    const showClear =
      !skip && !disabled && !readOnly && hasContent(value) && onChange != null;

    if (skip) {
      return (
        <input
          ref={ref}
          className={className}
          type={inputType}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          onChange={onChange}
          style={style}
          {...rest}
        />
      );
    }

    const wrapClass = [
      "input-clear-wrap",
      showClear ? "has-clear" : "",
      className?.includes("rep-search") ? "is-search" : "",
    ]
      .filter(Boolean)
      .join(" ");

    // 把 width/minWidth/maxWidth 提到外层，避免 wrap 被 input width:100% 撑乱
    const styleObj =
      style && typeof style === "object" && !Array.isArray(style)
        ? (style as Record<string, unknown>)
        : null;
    const wrapStyle =
      styleObj &&
      (styleObj.width != null ||
        styleObj.minWidth != null ||
        styleObj.maxWidth != null)
        ? {
            width: styleObj.width as string | number | undefined,
            minWidth: styleObj.minWidth as string | number | undefined,
            maxWidth: styleObj.maxWidth as string | number | undefined,
          }
        : undefined;
    const inputStyle = styleObj
      ? Object.fromEntries(
          Object.entries(styleObj).filter(
            ([k]) => k !== "width" && k !== "minWidth" && k !== "maxWidth",
          ),
        )
      : style;

    const clear = (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!onChange) return;
      const target = {
        value: "",
        name: rest.name ?? "",
        type: inputType,
        checked: false,
      } as HTMLInputElement;
      onChange({
        ...e,
        target,
        currentTarget: target,
      } as unknown as ChangeEvent<HTMLInputElement>);
    };

    return (
      <div className={wrapClass} style={wrapStyle}>
        <input
          ref={ref}
          className={className}
          type={inputType}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          onChange={onChange}
          style={inputStyle}
          {...rest}
        />
        {showClear ? (
          <button
            type="button"
            className="input-clear-btn"
            aria-label="清空"
            title="清空"
            tabIndex={-1}
            data-clear-for={reactId}
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
          >
            ×
          </button>
        ) : null}
      </div>
    );
  },
);
