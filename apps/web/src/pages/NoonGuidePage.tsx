import { useMemo, useState } from "react";
import {
  NOON_GUIDE_PROMPTS,
  formatPath,
  noonGuideSections,
  searchNoonGuide,
  type NoonGuideEntry,
} from "../lib/noon-seller-guide";
import { ClearableInput } from "../components/ClearableInput";

function GuideCard({ entry }: { entry: NoonGuideEntry }) {
  return (
    <article className="card seller-guide-hit">
      <div className="seller-guide-hit-head">
        <h3>{entry.title}</h3>
        <span
          className={`badge ${entry.status === "confirmed" ? "ok" : "idle"}`}
          title={
            entry.status === "confirmed"
              ? "已用影刀/截图对齐"
              : "侧栏已知，落地页待补图"
          }
        >
          {entry.status === "confirmed" ? "已对齐" : "待补图"}
        </span>
      </div>
      <p className="seller-guide-path" aria-label="菜单路径">
        {entry.menu.map((step) => (
          <span key={`${step.en}-${step.zh}`}>
            <strong>{step.zh}</strong>
            <em>{step.en}</em>
          </span>
        ))}
      </p>
      <p className="muted">{entry.why}</p>
      <ol className="seller-guide-steps">
        {entry.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {entry.landingUrl ? (
        <p className="seller-guide-url muted">落地：{entry.landingUrl}</p>
      ) : null}
      {entry.note ? <p className="seller-guide-note muted">{entry.note}</p> : null}
    </article>
  );
}

export function NoonGuidePage() {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const hits = useMemo(() => searchNoonGuide(trimmed), [trimmed]);
  const sections = useMemo(() => noonGuideSections(), []);

  return (
    <div className="seller-guide">
      <h1 className="page-title">Noon 卖家后台向导</h1>
      <p className="page-desc">
        路径中英对照：中文方便理解，括号里的英文是后台要点的原文。标「已对齐」的已用影刀核实；「待补图」只知道侧栏名，落地页还要补采。
      </p>

      <div className="card seller-guide-search">
        <label className="field">
          <span>要办什么</span>
          <ClearableInput
            className="input"
            value={query}
            placeholder="例如：改价格、添加商品、导出表格、入仓"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="seller-guide-chips">
          {NOON_GUIDE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className={`btn-ghost${query === prompt ? " is-on" : ""}`}
              onClick={() => setQuery(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {trimmed ? (
        hits.length > 0 ? (
          <div className="seller-guide-results">
            {hits.map((hit) => (
              <GuideCard key={hit.entry.id} entry={hit.entry} />
            ))}
          </div>
        ) : (
          <div className="card">
            <h3>没有对上的入口</h3>
            <p className="muted">
              换个说法试试，例如「改价」「添加商品」「导出」「入仓」。也可先浏览下方分组。
            </p>
          </div>
        )
      ) : (
        <div className="seller-guide-map">
          {[0, 1].map((column) => (
            <div key={column} className="seller-guide-col">
              {sections
                .map((group, index) => ({ group, index }))
                .filter(({ index }) => index % 2 === column)
                .map(({ group, index }) => (
                  <section
                    key={group.section}
                    className="card"
                    style={{ order: index }}
                  >
                    <h3>{group.section}</h3>
                    <ul className="seller-guide-index">
                      {group.entries.map((entry) => (
                        <li key={entry.id}>
                          <button type="button" onClick={() => setQuery(entry.title)}>
                            {entry.title}
                            <span
                              className={`badge ${entry.status === "confirmed" ? "ok" : "idle"}`}
                            >
                              {entry.status === "confirmed" ? "已对齐" : "待补图"}
                            </span>
                          </button>
                          <span className="muted">{formatPath(entry.menu)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
