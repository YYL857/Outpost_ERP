type Props = {
  title: string;
  description: string;
  phase: string;
};

export function ModulePlaceholder({ title, description, phase }: Props) {
  return (
    <div>
      <h1 className="page-title">{title}</h1>
      <p className="page-desc">{description}</p>
      <div className="placeholder">
        <p style={{ margin: 0 }}>
          模块框架已预留（{phase}）。后续按分期接入业务与 NOON 数据。
        </p>
      </div>
    </div>
  );
}
