import { useState, type FormEvent } from "react";
import { parseReportedSyllables, sendSyllableReport } from "./syllableFeedback";

interface SyllableReportPanelProps {
  /** Words the GM can correct, e.g. the submitted answer and the answer it clashed with. */
  words: string[];
}

type ReportStatus = "idle" | "sending" | "sent" | "failed";

export function SyllableReportPanel({ words }: SyllableReportPanelProps) {
  const uniqueWords = Array.from(
    new Set(words.map((word) => word.trim()).filter(Boolean)),
  );
  const [isOpen, setIsOpen] = useState(false);
  const [selectedWord, setSelectedWord] = useState(uniqueWords[0] ?? "");
  const [draft, setDraft] = useState(uniqueWords[0] ?? "");
  const [status, setStatus] = useState<ReportStatus>("idle");

  if (uniqueWords.length === 0) {
    return null;
  }

  const syllables = parseReportedSyllables(draft);

  function handleSelectWord(word: string) {
    setSelectedWord(word);
    setDraft(word);
    setStatus("idle");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (syllables.length === 0 || status === "sending") {
      return;
    }

    setStatus("sending");
    const recorded = await sendSyllableReport(selectedWord, syllables);
    setStatus(recorded ? "sent" : "failed");
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        className="ghost-button syllable-report-toggle"
        onClick={() => setIsOpen(true)}
      >
        แยกพยางค์ผิด? แจ้งการแยกที่ถูก
      </button>
    );
  }

  return (
    <form className="syllable-report-panel" onSubmit={handleSubmit}>
      {uniqueWords.length > 1 && (
        <div className="syllable-report-words" role="group" aria-label="คำที่แยกผิด">
          {uniqueWords.map((word) => (
            <button
              key={word}
              type="button"
              className="syllable-report-word"
              aria-pressed={word === selectedWord}
              onClick={() => handleSelectWord(word)}
            >
              {word}
            </button>
          ))}
        </div>
      )}
      <label className="syllable-report-label" htmlFor="syllable-report-input">
        เว้นวรรคระหว่างพยางค์ของ “{selectedWord}” ให้ถูก
      </label>
      <input
        id="syllable-report-input"
        className="syllable-report-input"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setStatus("idle");
        }}
        autoComplete="off"
        placeholder="เช่น ส มา คม"
      />
      <p className="syllable-report-preview" aria-live="polite">
        {syllables.join(" | ")}
      </p>
      <div className="syllable-report-actions">
        <button
          type="submit"
          className="primary-button"
          disabled={syllables.length === 0 || status === "sending" || status === "sent"}
        >
          {status === "sending" ? "กำลังส่ง…" : "ส่งการแยกพยางค์"}
        </button>
        <button type="button" className="ghost-button" onClick={() => setIsOpen(false)}>
          ปิด
        </button>
      </div>
      {status === "sent" && <p className="syllable-report-status is-sent">ส่งแล้ว ขอบคุณ</p>}
      {status === "failed" && (
        <p className="syllable-report-status is-failed">
          ส่งไม่สำเร็จ ระบบเก็บคำอาจยังไม่เปิด ลองใหม่ภายหลัง
        </p>
      )}
    </form>
  );
}
