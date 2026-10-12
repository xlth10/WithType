import { useState } from "react";
export function HistoryCorrection({ item, onTeach }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!editing) return <button className="button secondary small" onClick={() => { setText(item.text); setEditing(true); setMessage(""); }}>纠正并记住</button>;
  return <div className="history-correction">
    <label>改正这段文字，符合条件的短词会加入词库<textarea aria-label="纠正后的文字" value={text} onChange={(e) => setText(e.target.value)} rows={3} /></label>
    <div className="form-actions"><button className="button secondary small" disabled={busy} onClick={() => setEditing(false)}>取消</button><button className="button primary small" disabled={busy || text === item.text || !text.trim()} onClick={async () => {
      setBusy(true);
      try { await onTeach(item, text); setEditing(false); } catch (error) { setMessage(String(error.message || error)); } finally { setBusy(false); }
    }}>{busy ? "正在保存…" : "保存纠正"}</button></div>
    {message && <p role="status">{message}</p>}
  </div>;
}
