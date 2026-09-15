import React from "react";

const LIST = /^\s*[-•*]\s+/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+/;

const isHeading = (line: string, hasFollowing: boolean) => {
  const text = line.trim();
  return (
    text.length > 0 &&
    text.length <= 80 &&
    text.split(/\s+/).length <= 10 &&
    !/[.!?,;:]$/.test(text) &&
    !/^[a-z]/.test(text) &&
    !LIST.test(text) &&
    !NUMBERED.test(text) &&
    // A lone short line is a heading only when more content follows it.
    hasFollowing
  );
};

/**
 * Renders author and AI-written plain text as readable content: blank lines split
 * paragraphs, "- " lines become lists, "1." lines numbered lists, and a short line
 * without closing punctuation that introduces more text becomes a heading.
 */
export default function RichText({ text }: { text: string }) {
  const blocks = (text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.split("\n").filter((line) => line.trim()))
    .filter((lines) => lines.length);
  const nodes: React.ReactNode[] = [];
  blocks.forEach((lines, b) => {
    let i = 0;
    while (i < lines.length) {
      const key = `${b}-${i}`;
      if (LIST.test(lines[i]) || NUMBERED.test(lines[i])) {
        const numbered = NUMBERED.test(lines[i]);
        const pattern = numbered ? NUMBERED : LIST;
        const rows: string[] = [];
        while (i < lines.length && pattern.test(lines[i])) rows.push(lines[i++].replace(pattern, ""));
        const List = numbered ? "ol" : "ul";
        nodes.push(
          <List key={key}>
            {rows.map((row, n) => (
              <li key={n}>{row}</li>
            ))}
          </List>
        );
        continue;
      }
      const hasFollowing = i < lines.length - 1 || b < blocks.length - 1;
      if (i === 0 && isHeading(lines[i], hasFollowing)) {
        nodes.push(<h2 key={key}>{lines[i].trim()}</h2>);
        i++;
        continue;
      }
      const para: string[] = [];
      while (i < lines.length && !LIST.test(lines[i]) && !NUMBERED.test(lines[i])) para.push(lines[i++]);
      nodes.push(
        <p key={key}>
          {para.map((line, n) => (
            <React.Fragment key={n}>
              {n > 0 && <br />}
              {line}
            </React.Fragment>
          ))}
        </p>
      );
    }
  });
  return <>{nodes}</>;
}
