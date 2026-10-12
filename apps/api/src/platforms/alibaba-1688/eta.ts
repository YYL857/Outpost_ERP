/**
 * 从物流文案解析预计送达日；判定「今日强关注」状态。
 */

const ATTENTION_RE =
  /派送中|派件中|今日达|今天送达|预计今日|即将送达|已签收|已收货|本人签收|代签收|正在派送|上门投递|已送达|派件成功/;

export function shanghaiToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 从物流/状态文案尽量抠出 YYYY-MM-DD（须有送达语境，避免把下单日当 ETA） */
export function parseEtaDate(
  text: string,
  now = new Date(),
): string | null {
  const s = text || "";
  if (/今日达|今天送达|预计今日|今日到达/.test(s)) {
    return shanghaiToday(now);
  }
  // 无「预计/送达/派送」等词时，不把正文里的日期（常为下单日）当 ETA
  if (!/预计|送达|派送|到达|明日|后天/.test(s)) {
    return null;
  }
  const iso = s.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  }
  const md = s.match(/(\d{1,2})月(\d{1,2})日/);
  if (md) {
    const y = shanghaiToday(now).slice(0, 4);
    return `${y}-${md[1]!.padStart(2, "0")}-${md[2]!.padStart(2, "0")}`;
  }
  return null;
}

export function isAttentionTransit(
  transitStatus: string,
  orderStatus: string,
  etaDate: string | null,
  today = shanghaiToday(),
): boolean {
  const blob = `${transitStatus} ${orderStatus}`;
  if (ATTENTION_RE.test(blob)) return true;
  if (etaDate && etaDate === today) return true;
  return false;
}

/** 规范化列表状态 / 物流摘要用于回填 */
export function pickTransitStatus(
  orderStatus: string,
  logisticsText: string,
): string {
  const log = (logisticsText || "").trim();
  // 轨迹摘要优先（运输中/派送中…），否则才用订单状态栏
  if (log) {
    const logHit = log.match(
      /派送中|派件中|正在派送|运输中|已揽收|已签收|已收货|本人签收|代签收|已送达|上门投递|已发货|部分发货|待揽收/,
    );
    if (logHit?.[0]) return logHit[0];
  }
  const status = (orderStatus || "").trim();
  if (status) return status.slice(0, 64);
  if (!log) return "";
  const hit = log.match(
    /等待买家收货|待付款|待发货|待收货|待评价|退款中|交易成功|交易关闭/,
  );
  return hit?.[0] ?? "";
}

export function extractTrackingNo(text: string): string {
  const s = text || "";
  // 勿用裸「单号」——会误匹配「订单号」后的订单 ID
  const labeled = s.match(
    /(?:运单号|快递单号|物流单号|承运单号)[：:\s]*([A-Za-z0-9]{8,32})/,
  );
  if (labeled?.[1]) {
    const v = labeled[1];
    // 1688 订单号多为 18–19 位；运单常见 12–15 位纯数字
    if (!/^\d{18,22}$/.test(v)) return v;
  }
  const loose = s.match(
    /\b([A-Z]{2}\d{10,14}|[A-Z]{1,3}\d{12,18})\b/,
  );
  if (loose?.[1]) return loose[1];
  // 纯数字运单：12–17 位；排除 18–22 位订单号
  const digits = s.match(/\b(\d{12,17})\b/);
  if (digits?.[1] && !/^\d{18,22}$/.test(digits[1])) return digits[1];
  return "";
}
