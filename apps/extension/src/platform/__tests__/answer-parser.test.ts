import { describe, expect, it } from 'vitest';
import { parseAnswer } from '../answer-parser.js';

describe('answer-parser', () => {
  it('extracts code block and language from markdown response', () => {
    const raw = `
### Approach
We use a hash map to store complements.

\`\`\`python
def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        diff = target - num
        if diff in seen:
            return [seen[diff], i]
        seen[num] = i
    return []
\`\`\`

### Complexity
- Time: O(n)
- Space: O(n)
`;

    const parsed = parseAnswer(raw);
    expect(parsed.hasCodeBlock).toBe(true);
    expect(parsed.language).toBe('python');
    expect(parsed.code).toContain('def two_sum(nums, target):');
    expect(parsed.code).not.toContain('### Approach');
    expect(parsed.code).not.toContain('```');
    expect(parsed.explanation).toContain('### Approach');
    expect(parsed.explanation).toContain('### Complexity');
    expect(parsed.explanation).not.toContain('def two_sum(nums, target):');
  });

  it('handles code block without language tag', () => {
    const raw = 'Here is the solution:\n```\nconsole.log("hello world");\n```\nGood luck!';
    const parsed = parseAnswer(raw);
    expect(parsed.hasCodeBlock).toBe(true);
    expect(parsed.language).toBe('code');
    expect(parsed.code).toBe('console.log("hello world");');
    expect(parsed.explanation).toContain('Here is the solution:');
    expect(parsed.explanation).toContain('Good luck!');
  });

  it('handles plain text answer without code blocks', () => {
    const raw = 'The time complexity of binary search is O(log n) because the search space is halved at each step.';
    const parsed = parseAnswer(raw);
    expect(parsed.hasCodeBlock).toBe(false);
    expect(parsed.language).toBe('text');
    expect(parsed.code).toBe(raw);
    expect(parsed.explanation).toBe(raw);
  });

  it('handles empty or whitespace-only input safely', () => {
    expect(parseAnswer('').hasCodeBlock).toBe(false);
    expect(parseAnswer('   ').code).toBe('');
  });
});
