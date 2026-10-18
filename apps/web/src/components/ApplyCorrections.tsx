import type { Correction, Message } from "@project-alpha/shared";

export interface ApplyCorrectionsProps {
  corrections: Correction[];
  originalMessages: Message[];
  assistantAnswer: string;
  onRerun: (messages: Message[]) => void;
}

// MUST-FIX applied: rerun now splices the PTM-generated answer into the
// message array before the correction instruction, so the rerun model has
// something concrete to rewrite.
export function ApplyCorrections({
  corrections,
  originalMessages,
  assistantAnswer,
  onRerun,
}: ApplyCorrectionsProps) {
  const instructionText =
    "Please correct the previous answer based on the following issues:\n" +
    corrections
      .map((c, i) => `${i + 1}. [${c.severity}] ${c.issue}${c.explanation ? ` — ${c.explanation}` : ""}`)
      .join("\n");

  const handleClick = () => {
    const rerunMessages: Message[] = [
      ...originalMessages,
      { role: "assistant", content: assistantAnswer },
      { role: "user", content: instructionText },
    ];
    onRerun(rerunMessages);
  };

  return (
    <div className="apply-corrections">
      <p>The verifier suggests replacing this answer.</p>
      <ul>
        {corrections.map((c, i) => (
          <li key={i}>
            <strong>[{c.severity}]</strong> {c.issue}
            {c.explanation ? ` — ${c.explanation}` : ""}
          </li>
        ))}
      </ul>
      <button type="button" onClick={handleClick}>
        Apply Corrections (rerun)
      </button>
    </div>
  );
}
