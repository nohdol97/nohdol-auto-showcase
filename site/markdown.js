function appendText(tokens, value) {
  if (!value) return;
  const previous = tokens.at(-1);
  if (previous?.type === "text") previous.value += value;
  else tokens.push({ type: "text", value });
}

function safeLink(href) {
  try {
    const url = new URL(href);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function parseInline(source) {
  const text = String(source ?? "");
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] === "\\" && index + 1 < text.length) {
      appendText(tokens, text[index + 1]);
      index += 2;
      continue;
    }
    if (text[index] === "\n") {
      tokens.push({ type: "break" });
      index += 1;
      continue;
    }
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > index + 1) {
        tokens.push({ type: "code", value: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    const strongMarker = text.startsWith("**", index) ? "**" : text.startsWith("__", index) ? "__" : null;
    if (strongMarker) {
      const end = text.indexOf(strongMarker, index + 2);
      if (end > index + 2) {
        tokens.push({ type: "strong", children: parseInline(text.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
    }
    if (text[index] === "*" || text[index] === "_") {
      const marker = text[index];
      const end = text.indexOf(marker, index + 1);
      if (end > index + 1) {
        tokens.push({ type: "emphasis", children: parseInline(text.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }
    if (text[index] === "[") {
      const labelEnd = text.indexOf("](", index + 1);
      const hrefEnd = labelEnd >= 0 ? text.indexOf(")", labelEnd + 2) : -1;
      if (labelEnd > index + 1 && hrefEnd > labelEnd + 2) {
        const href = safeLink(text.slice(labelEnd + 2, hrefEnd).trim());
        if (href) {
          tokens.push({ type: "link", href, children: parseInline(text.slice(index + 1, labelEnd)) });
          index = hrefEnd + 1;
          continue;
        }
      }
    }
    appendText(tokens, text[index]);
    index += 1;
  }
  return tokens;
}

function startsBlock(line) {
  return /^\s*$/.test(line)
    || /^\s*```/.test(line)
    || /^#{1,3}\s+/.test(line)
    || /^\s*(?:[-+*]|\d+\.)\s+/.test(line)
    || /^\s*>\s?/.test(line);
}

export function parseMarkdown(source) {
  const lines = String(source ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*$/.test(line)) {
      index += 1;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const content = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        content.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "codeBlock", value: content.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, children: parseInline(heading[2]) });
      index += 1;
      continue;
    }
    const listItem = line.match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
    if (listItem) {
      const ordered = /\d+\./.test(listItem[1]);
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
        if (!match || /\d+\./.test(match[1]) !== ordered) break;
        items.push(parseInline(match[2]));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", children: parseMarkdown(quoted.join("\n")) });
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && !startsBlock(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
  }
  return blocks;
}

function appendInline(document, parent, tokens) {
  for (const token of tokens) {
    if (token.type === "text") parent.append(document.createTextNode(token.value));
    else if (token.type === "break") parent.append(document.createElement("br"));
    else if (token.type === "code") {
      const code = document.createElement("code");
      code.textContent = token.value;
      parent.append(code);
    } else if (token.type === "strong" || token.type === "emphasis") {
      const element = document.createElement(token.type === "strong" ? "strong" : "em");
      appendInline(document, element, token.children);
      parent.append(element);
    } else if (token.type === "link") {
      const link = document.createElement("a");
      link.href = token.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      appendInline(document, link, token.children);
      parent.append(link);
    }
  }
}

function appendBlocks(document, parent, blocks) {
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "heading") {
      const element = document.createElement(block.type === "paragraph" ? "p" : `h${Math.min(block.level + 2, 6)}`);
      appendInline(document, element, block.children);
      parent.append(element);
    } else if (block.type === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const listItem = document.createElement("li");
        appendInline(document, listItem, item);
        list.append(listItem);
      }
      parent.append(list);
    } else if (block.type === "quote") {
      const quote = document.createElement("blockquote");
      appendBlocks(document, quote, block.children);
      parent.append(quote);
    } else if (block.type === "codeBlock") {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = block.value;
      pre.append(code);
      parent.append(pre);
    }
  }
}

export function renderMarkdown(container, source) {
  const document = container.ownerDocument;
  const fragment = document.createDocumentFragment();
  appendBlocks(document, fragment, parseMarkdown(source));
  container.replaceChildren(fragment);
}
