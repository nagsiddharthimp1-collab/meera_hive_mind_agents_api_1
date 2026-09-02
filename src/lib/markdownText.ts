const LATEX_ARROW_REPLACEMENTS: Record<string, string> = {
  to: '\u2192',
  rightarrow: '\u2192',
  longrightarrow: '\u27f6',
  Rightarrow: '\u21d2',
  Longrightarrow: '\u27f9',
  leftarrow: '\u2190',
  longleftarrow: '\u27f5',
  Leftarrow: '\u21d0',
  Longleftarrow: '\u27f8',
  leftrightarrow: '\u2194',
  longleftrightarrow: '\u27f7',
  Leftrightarrow: '\u21d4',
  Longleftrightarrow: '\u27fa',
};

const LATEX_ARROW_COMMAND =
  'Longleftrightarrow|longleftrightarrow|Longrightarrow|longrightarrow|Longleftarrow|longleftarrow|Leftrightarrow|leftrightarrow|Rightarrow|rightarrow|Leftarrow|leftarrow|to';

const dollarWrappedArrowPattern = new RegExp(`\\$\\s*(\\\\+(?:${LATEX_ARROW_COMMAND}))\\s*\\$`, 'g');
const parenWrappedArrowPattern = new RegExp(`\\\\\\(\\s*(\\\\+(?:${LATEX_ARROW_COMMAND}))\\s*\\\\\\)`, 'g');
const bracketWrappedArrowPattern = new RegExp(`\\\\\\[\\s*(\\\\+(?:${LATEX_ARROW_COMMAND}))\\s*\\\\\\]`, 'g');
const bareArrowPattern = new RegExp(`\\\\+(${LATEX_ARROW_COMMAND})\\b`, 'g');

const latexCommandToArrow = (command: string): string => {
  const normalizedCommand = command.replace(/^\\+/, '');
  return LATEX_ARROW_REPLACEMENTS[normalizedCommand] || command;
};

const normalizeLatexArrows = (source: string): string =>
  source
    .replace(dollarWrappedArrowPattern, (_match, command: string) => latexCommandToArrow(command))
    .replace(parenWrappedArrowPattern, (_match, command: string) => latexCommandToArrow(command))
    .replace(bracketWrappedArrowPattern, (_match, command: string) => latexCommandToArrow(command))
    .replace(bareArrowPattern, (_match, command: string) => latexCommandToArrow(command));

export const normalizeAssistantMarkdownContent = (source: string): string => {
  const codePattern = /(```[\s\S]*?```|`[^`\n]*`)/g;
  let cursor = 0;
  let normalized = '';
  let match: RegExpExecArray | null;

  while ((match = codePattern.exec(source)) !== null) {
    normalized += normalizeLatexArrows(source.slice(cursor, match.index));
    normalized += match[0];
    cursor = match.index + match[0].length;
  }

  normalized += normalizeLatexArrows(source.slice(cursor));
  return normalized;
};
