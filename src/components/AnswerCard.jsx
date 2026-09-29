import { useEffect, useRef, useState } from "react";
import { ClipboardText, PaperPlaneTilt, X } from "@phosphor-icons/react";

/** An answer stays in its own window and can be followed up without pasting. */
export function AnswerCard({ card, onClose, onFollowup }) {
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const conversationRef = useRef("");
  const generationRef = useRef(0);

  useEffect(() => {
    if (!card) return;
    const id = card.requestId || card.question;
    if (conversationRef.current !== id) {
      conversationRef.current = id;
      generationRef.current += 1;
      setTurns([{ question: card.question, answer: card.answer }]);
      setDraft("");
      setBusy(false);
      setError("");
    } else {
      setTurns((current) => current.length ? [{ ...current[0], answer: card.answer }, ...current.slice(1)] : [{ question: card.question, answer: card.answer }]);
    }
  }, [card?.requestId, card?.question, card?.answer]);

  if (!card) return null;
  const submit = async (event) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    const previous = turns.filter((turn) => turn.answer);
    const generation = ++generationRef.current;
    setDraft("");
    setError("");
    setBusy(true);
    setTurns((current) => [...current, { question, answer: "" }]);
    try {
      const answer = await onFollowup({ turns: previous, question, onDelta: (text) => {
        if (generation !== generationRef.current) return;
        setTurns((current) => current.map((turn, index) => index === current.length - 1 ? { ...turn, answer: text } : turn));
      } });
      if (generation === generationRef.current) setTurns((current) => current.map((turn, index) => index === current.length - 1 ? { ...turn, answer } : turn));
    } catch (failure) {
      if (generation === generationRef.current) setError(String(failure?.message || failure));
    } finally {
      if (generation === generationRef.current) setBusy(false);
    }
  };

  return (
    <main className="answer-shell">
      <section className="answer-card" aria-label="随便问的回答">
        <header>
          <div><span>随便问</span><small>可以继续追问</small></div>
          <button onClick={() => { generationRef.current += 1; onClose(); }} aria-label="关闭回答"><X size={17} /></button>
        </header>
        <div className="answer-content">
          {turns.map((turn, index) => <div className="answer-turn" key={index}>
            <p className="answer-question">{turn.question}</p>
            <p className="answer-text">{turn.answer || (busy && index === turns.length - 1 ? "正在回答…" : "")}</p>
          </div>)}
          {error && <p className="answer-error" role="alert">{error}</p>}
        </div>
        <form className="answer-followup" onSubmit={submit}>
          <input aria-label="继续追问" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="继续追问…" maxLength={2000} disabled={busy} />
          <button type="submit" aria-label="发送追问" disabled={!draft.trim() || busy}><PaperPlaneTilt size={16} /></button>
        </form>
        <footer>
          <span>回答不会自动输入到其他窗口</span>
          <button onClick={() => navigator.clipboard.writeText(turns.at(-1)?.answer || "")}><ClipboardText size={16} />复制回答</button>
        </footer>
      </section>
    </main>
  );
}
