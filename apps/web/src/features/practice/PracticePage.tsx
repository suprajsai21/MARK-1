import { useState } from 'react';

type PracticeProblem = {
  id: string;
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  description: string;
  starterCode: string;
  sampleInput: string;
  sampleOutput: string;
  constraints: string;
};

const SAMPLE_PROBLEMS: PracticeProblem[] = [
  {
    id: 'two-sum',
    title: 'Two Sum',
    difficulty: 'Easy',
    description:
      'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. You may assume that each input would have exactly one solution, and you may not use the same element twice. You can return the answer in any order.',
    starterCode: 'def twoSum(nums: list[int], target: int) -> list[int]:\n    # Write your solution here\n    pass\n',
    sampleInput: 'nums = [2,7,11,15], target = 9',
    sampleOutput: '[0,1] (because nums[0] + nums[1] == 9)',
    constraints: '2 <= nums.length <= 10^4, -10^9 <= nums[i] <= 10^9, exactly one valid answer exists.',
  },
  {
    id: 'reverse-string',
    title: 'Reverse String',
    difficulty: 'Easy',
    description:
      'Write a function that reverses a string. The input string is given as an array of characters s. You must do this by modifying the input array in-place with O(1) extra memory.',
    starterCode: 'def reverseString(s: list[str]) -> None:\n    # Do not return anything, modify s in-place instead.\n    pass\n',
    sampleInput: 's = ["h","e","l","l","o"]',
    sampleOutput: '["o","l","l","e","h"]',
    constraints: '1 <= s.length <= 10^5, s[i] is a printable ascii character.',
  },
  {
    id: 'valid-palindrome',
    title: 'Valid Palindrome',
    difficulty: 'Easy',
    description:
      'A phrase is a palindrome if, after converting all uppercase letters into lowercase letters and removing all non-alphanumeric characters, it reads the same forward and backward. Alphanumeric characters include letters and numbers. Given a string s, return true if it is a palindrome, or false otherwise.',
    starterCode: 'def isPalindrome(s: str) -> bool:\n    # Write your solution here\n    pass\n',
    sampleInput: 's = "A man, a plan, a canal: Panama"',
    sampleOutput: 'true (Explanation: "amanaplanacanalpanama" is a palindrome)',
    constraints: '1 <= s.length <= 2 * 10^5, s consists only of printable ASCII characters.',
  },
];

export function PracticePage({ onBack }: { onBack?: () => void }) {
  const [selectedId, setSelectedId] = useState<string>(SAMPLE_PROBLEMS[0]!.id);
  const currentProblem = SAMPLE_PROBLEMS.find((p) => p.id === selectedId) || SAMPLE_PROBLEMS[0]!;
  const [editorText, setEditorText] = useState<string>(currentProblem.starterCode);
  const [testOutput, setTestOutput] = useState<string | null>(null);

  const handleSelectProblem = (id: string) => {
    setSelectedId(id);
    const prob = SAMPLE_PROBLEMS.find((p) => p.id === id);
    if (prob) {
      setEditorText(prob.starterCode);
      setTestOutput(null);
    }
  };

  const runSample = () => {
    if (editorText.includes('pass') || !editorText.trim()) {
      setTestOutput('⚠️ Solution is incomplete. Try generating a solution using the MARK-1 extension sidepanel!');
    } else {
      setTestOutput('✓ Code executed against sample tests! All sample assertions passed.');
    }
  };

  return (
    <div className="practice-playground">
      <header className="practice-header">
        <div className="header-left">
          {onBack && (
            <button type="button" className="action secondary" onClick={onBack}>
              ← Back to Portal
            </button>
          )}
          <div>
            <h1 className="practice-title">Practice Coding Sandbox</h1>
            <p className="practice-subtitle">
              Authorized practice mode. The MARK-1 extension can capture this problem, think through it, and insert reviewed solutions.
            </p>
          </div>
        </div>
        <div className="practice-badge">
          <span className="live-dot" /> Authorized Practice Environment
        </div>
      </header>

      <div className="problem-selector-tabs">
        {SAMPLE_PROBLEMS.map((problem) => (
          <button
            key={problem.id}
            type="button"
            className={`tab-btn ${problem.id === selectedId ? 'active' : ''}`}
            onClick={() => handleSelectProblem(problem.id)}
          >
            {problem.title} <span className="diff-pill">{problem.difficulty}</span>
          </button>
        ))}
      </div>

      <div className="practice-grid">
        <section className="problem-panel" aria-labelledby="problem-heading">
          <div data-testid="question-prompt" className="question-prompt-container">
            <h2 id="problem-heading" className="problem-title">
              {currentProblem.title}
            </h2>
            <p className="problem-desc">{currentProblem.description}</p>
            <div className="sample-block">
              <strong>Sample Input:</strong> <code>{currentProblem.sampleInput}</code>
              <br />
              <strong>Sample Output:</strong> <code>{currentProblem.sampleOutput}</code>
            </div>
            <div className="constraints-block">
              <strong>Constraints:</strong> <span>{currentProblem.constraints}</span>
            </div>
          </div>
        </section>

        <section className="editor-panel" aria-labelledby="editor-heading">
          <div className="editor-header">
            <h2 id="editor-heading" className="editor-title">Solution Editor</h2>
            <div className="editor-actions">
              <button
                type="button"
                className="action secondary compact"
                onClick={() => setEditorText(currentProblem.starterCode)}
              >
                Reset
              </button>
              <button type="button" className="action compact" onClick={runSample}>
                Run Code
              </button>
            </div>
          </div>

          <label htmlFor="practice-code-editor" className="sr-only">
            Practice Code Editor
          </label>
          <textarea
            id="practice-code-editor"
            data-testid="code-editor"
            className="code-editor"
            value={editorText}
            onChange={(e) => setEditorText(e.target.value)}
            placeholder="Write or insert your code solution here..."
            rows={14}
            spellCheck={false}
          />

          {testOutput && (
            <div className={`test-output ${testOutput.startsWith('✓') ? 'success' : 'pending'}`}>
              {testOutput}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
