import { ClipboardText, X } from "@phosphor-icons/react";

/** 提问只展示回答，不向原窗口输入任何文字。 */
export function AnswerCard({ card, onClose }) {
  if (!card) return null;
  return (
    <main className="answer-shell">
      <section className="answer-card" aria-label="随便问的回答">
        <header>
          <div><span>随便问</span><small>本次回答</small></div>
          <button onClick={onClose} aria-label="关闭回答"><X size={17} /></button>
        </header>
        <div className="answer-content">
          <p className="answer-question">{card.question}</p>
          <p className="answer-text">{card.answer}</p>
        </div>
        <footer>
          <span>回答不会自动输入到其他窗口</span>
          <button onClick={() => navigator.clipboard.writeText(card.answer)}><ClipboardText size={16} />复制回答</button>
        </footer>
      </section>
    </main>
  );
}
