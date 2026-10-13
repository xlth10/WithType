import { useEffect, useRef, useState } from "react";
import { Check, ClipboardText, PaperPlaneTilt, X } from "@phosphor-icons/react";
import { VoiceMotion } from "../voice/VoiceMotion.jsx";

/** A shared reading surface for answers and explicitly reviewed Skill output. */
export function AnswerCard({ card, onClose, onFollowup }) {
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const conversationRef = useRef("");
  const generationRef = useRef(0);
  const contentRef = useRef(null);
  const followScrollRef = useRef(true);
  const copyTimerRef = useRef(null);
  const isSkill = card?.kind === "skill";
  const streaming = busy || Boolean(card?.streaming);
  const latestAnswer = [...turns].reverse().find((turn) => turn.answer)?.answer || "";
  const close = () => { generationRef.current += 1; onClose(); };

  useEffect(() => {
    if (!card) return;
    const id = card.requestId || card.question;
    if (conversationRef.current !== id) {
      conversationRef.current = id; generationRef.current += 1;
      followScrollRef.current = Boolean(card.streaming);
      if (contentRef.current) contentRef.current.scrollTop = 0;
      setTurns([{ question: card.question, answer: card.answer }]);
      setDraft(""); setBusy(false); setError(""); setCopied(false);
    } else {
      setTurns((current) => current.length ? [{ ...current[0], answer: card.answer }, ...current.slice(1)] : [{ question: card.question, answer: card.answer }]);
    }
  }, [card?.requestId, card?.question, card?.answer]);

  useEffect(() => { setError(card?.error || ""); }, [card?.error]);

  useEffect(() => {
    if (followScrollRef.current && contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight;
  }, [turns]);
  useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);
  useEffect(() => () => { generationRef.current += 1; clearTimeout(copyTimerRef.current); }, []);

  if (!card) return null;
  const submit = async (event) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || streaming || isSkill) return;
    const previous = turns.filter((turn) => turn.answer);
    const generation = ++generationRef.current;
    followScrollRef.current = true;
    setDraft(""); setError(""); setBusy(true); setCopied(false);
    setTurns((current) => [...current, { question, answer: "" }]);
    try {
      const answer = await onFollowup({ turns: previous, question, onDelta: (text) => {
        if (generation !== generationRef.current) return;
        setTurns((current) => current.map((turn, i) => i === current.length - 1 ? { ...turn, answer: text } : turn));
      } });
      if (generation === generationRef.current) setTurns((current) => current.map((turn, i) => i === current.length - 1 ? { ...turn, answer } : turn));
    } catch (failure) {
      if (generation === generationRef.current) setError(String(failure?.message || failure));
    } finally { if (generation === generationRef.current) setBusy(false); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(latestAnswer);
      setCopied(true); clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch { setError("复制失败，请选中文字手动复制。"); }
  };

  return <main className="answer-shell">
    <section className="answer-card" aria-label={isSkill ? "技能整理结果" : "随便问的回答"}>
      <header data-tauri-drag-region>
        <div className="answer-heading" data-tauri-drag-region><VoiceMotion state={streaming ? "processing" : "idle"} level={0} width={42} height={18} /><div data-tauri-drag-region><strong data-tauri-drag-region>{card.title || (isSkill ? "整理结果" : "随便问")}</strong><small data-tauri-drag-region>{streaming ? "正在回答" : isSkill ? "整理完成 · 核对后再使用" : "留一点空间，把问题想清楚"}</small></div></div>
        <button className="icon-button" onClick={close} aria-label="关闭回答" title="关闭 · Esc"><X size={18} /></button>
      </header>
      <div className="answer-content" ref={contentRef} onScroll={() => { const el = contentRef.current; followScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64; }} aria-live={streaming ? "polite" : "off"} aria-busy={streaming}>
        {turns.map((turn, index) => <article className="answer-turn" key={index}><div className="answer-question"><span>{isSkill ? "口述内容" : index ? "继续追问" : "你的问题"}</span><p>{turn.question}</p></div><div className="answer-response"><span className="answer-response-label">{isSkill ? "整理结果" : "回答"}</span><p className="answer-text">{turn.answer || (streaming && index === turns.length - 1 ? "正在想…" : "")}</p></div></article>)}
        {error && <p className="answer-error" role="alert">{error}</p>}
      </div>
      {!isSkill && <form className="answer-followup" onSubmit={submit}><textarea rows={1} aria-label="继续追问" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} placeholder="输入追问…（Enter 发送）" maxLength={2000} disabled={streaming} /><button type="submit" aria-label="发送追问" disabled={!draft.trim() || streaming}><PaperPlaneTilt size={18} weight="fill" /></button></form>}
      <footer><span>{isSkill ? "结果已保留在历史中" : "不会输入当前窗口"}</span><button onClick={copy} disabled={!latestAnswer}>{copied ? <Check size={16} /> : <ClipboardText size={16} />}{copied ? "已复制" : isSkill ? "复制结果" : "复制回答"}</button></footer>
    </section>
  </main>;
}
