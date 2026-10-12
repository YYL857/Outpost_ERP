/** 简易分页条：上一页 / 页码 / 下一页 */
export function PageBar(props: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  busy?: boolean;
  onChange: (page: number) => void;
}) {
  const { page, pageCount, total, pageSize, busy, onChange } = props;
  if (total <= 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="page-bar">
      <span className="muted">
        {from}–{to} / 共 {total} · 第 {page}/{pageCount} 页
      </span>
      <div className="page-bar-actions">
        <button
          type="button"
          className="btn"
          disabled={busy || page <= 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || page >= pageCount}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
