/**
 * Copy text for multi-user / LAN deployments.
 * `navigator.clipboard` needs a secure context (HTTPS or localhost);
 * office PCs often open the ERP via http://192.168.x.x — fall back to execCommand.
 */
export async function copyText(text: string): Promise<boolean> {
  const t = String(text ?? "").trim();
  if (!t) return false;

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function" &&
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      /* fall through */
    }
  }

  return copyTextFallback(t);
}

function copyTextFallback(text: string): boolean {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}
