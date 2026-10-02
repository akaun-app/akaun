/**
 * A small XML reader for the parts of an `.xlsx` workbook (006 S4.1). It reads
 * the tags, attributes and text a workbook uses, and nothing more:
 *
 * - Namespace prefixes are dropped, so `<x:row>` and `<row>` are both `row`,
 *   and `r:id` is `id`. A workbook never uses one name twice with different
 *   prefixes on one element, so nothing is lost.
 * - The five XML entities and numeric character references are decoded. Any
 *   other entity fails, because only a document type can define one.
 * - A document type (`<!DOCTYPE`) is refused outright. It is how XML files
 *   pull in outside files or expand a few bytes into gigabytes, and no real
 *   workbook has one.
 *
 * `scanXml` calls back for each tag and run of text without building anything,
 * for a worksheet that can be large. `parseXml` builds a tree, for the small
 * parts (workbook, relationships, styles).
 */

import { SpreadsheetError, brief } from "./types.js";

export type XmlAttributes = Record<string, string>;

export interface XmlHandlers {
  open?(name: string, attrs: XmlAttributes, selfClosing: boolean): void;
  close?(name: string): void;
  text?(text: string): void;
}

export interface XmlElement {
  name: string;
  attrs: XmlAttributes;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

function malformed(detail: string): SpreadsheetError {
  return new SpreadsheetError(
    `The file is damaged and cannot be read (${detail}). Open it in Excel, save it again and upload the new copy.`,
  );
}

/** The name without its namespace prefix: `x:row` gives `row`. */
function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

/** Text with its entities and character references turned back into characters. */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g,
    (_, ref: string) => {
      if (ref[0] === "#") {
        const code =
          ref[1] === "x"
            ? parseInt(ref.slice(2), 16)
            : parseInt(ref.slice(1), 10);
        if (!(code >= 0 && code <= 0x10ffff))
          throw malformed(
            `a character reference &${brief(ref)}; is out of range`,
          );
        return String.fromCodePoint(code);
      }
      // Only the five own keys count: a name such as `constructor` is on
      // every object, and must fail like any other unknown entity.
      if (!Object.hasOwn(NAMED_ENTITIES, ref))
        throw malformed(`it uses an unknown entity &${brief(ref)};`);
      return NAMED_ENTITIES[ref];
    },
  );
}

/** Whether `code` is XML white space. */
function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/**
 * Goes through the XML once, calling `open` for each start or empty tag,
 * `close` for each end tag (and after `open` for an empty tag), and `text` for
 * each run of text, already decoded. Processing instructions and comments are
 * skipped. CDATA is passed on as text, as it is.
 */
export function scanXml(xml: string, handlers: XmlHandlers): void {
  const { open, close, text } = handlers;
  const length = xml.length;
  let i = xml.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (i < length) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      text?.(decodeEntities(xml.slice(i)));
      break;
    }
    if (lt > i) text?.(decodeEntities(xml.slice(i, lt)));

    const next = xml.charCodeAt(lt + 1);
    if (next === 0x3f /* ? */) {
      const end = xml.indexOf("?>", lt + 2);
      if (end === -1) throw malformed("an instruction is never closed");
      i = end + 2;
      continue;
    }
    if (next === 0x21 /* ! */) {
      if (xml.startsWith("<!--", lt)) {
        const end = xml.indexOf("-->", lt + 4);
        if (end === -1) throw malformed("a comment is never closed");
        i = end + 3;
        continue;
      }
      if (xml.startsWith("<![CDATA[", lt)) {
        const end = xml.indexOf("]]>", lt + 9);
        if (end === -1) throw malformed("a CDATA section is never closed");
        text?.(xml.slice(lt + 9, end));
        i = end + 3;
        continue;
      }
      throw new SpreadsheetError(
        "The file declares an XML document type, which is never read, for safety. Open it in Excel, save it again and upload the new copy.",
      );
    }
    if (next === 0x2f /* / */) {
      const end = xml.indexOf(">", lt + 2);
      if (end === -1) throw malformed("a tag is never closed");
      close?.(localName(xml.slice(lt + 2, end).trim()));
      i = end + 1;
      continue;
    }

    // A start tag or an empty tag: its name, then its attributes.
    let j = lt + 1;
    while (j < length) {
      const code = xml.charCodeAt(j);
      if (isSpace(code) || code === 0x2f || code === 0x3e) break;
      j++;
    }
    const name = localName(xml.slice(lt + 1, j));
    if (!name) throw malformed("a tag has no name");
    // No prototype, so an attribute named `constructor` or `__proto__` is
    // kept like any other instead of colliding with what every object has.
    const attrs: XmlAttributes = Object.create(null) as XmlAttributes;
    let selfClosing = false;
    for (;;) {
      while (j < length && isSpace(xml.charCodeAt(j))) j++;
      if (j >= length)
        throw malformed(`the tag <${brief(name)}> is never closed`);
      const code = xml.charCodeAt(j);
      if (code === 0x3e /* > */) {
        j++;
        break;
      }
      if (code === 0x2f /* / */) {
        if (xml.charCodeAt(j + 1) !== 0x3e)
          throw malformed(`the tag <${brief(name)}> is malformed`);
        selfClosing = true;
        j += 2;
        break;
      }
      const nameStart = j;
      while (j < length) {
        const c = xml.charCodeAt(j);
        if (c === 0x3d /* = */ || isSpace(c) || c === 0x3e || c === 0x2f) break;
        j++;
      }
      const attrName = xml.slice(nameStart, j);
      while (j < length && isSpace(xml.charCodeAt(j))) j++;
      if (xml.charCodeAt(j) !== 0x3d)
        throw malformed(`an attribute of <${brief(name)}> has no value`);
      j++;
      while (j < length && isSpace(xml.charCodeAt(j))) j++;
      const quote = xml[j];
      if (quote !== '"' && quote !== "'")
        throw malformed(`an attribute of <${brief(name)}> is not quoted`);
      const valueEnd = xml.indexOf(quote, j + 1);
      if (valueEnd === -1)
        throw malformed(`an attribute of <${brief(name)}> is never closed`);
      // Namespace declarations say nothing about the cells, and with the
      // prefixes dropped they would only get in the way.
      if (attrName !== "xmlns" && !attrName.startsWith("xmlns:")) {
        const key = localName(attrName);
        if (!Object.hasOwn(attrs, key))
          attrs[key] = decodeEntities(xml.slice(j + 1, valueEnd));
      }
      j = valueEnd + 1;
    }
    open?.(name, attrs, selfClosing);
    if (selfClosing) close?.(name);
    i = j;
  }
}

/** The whole document as a tree, for a small part. Returns the root element. */
export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: "", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  scanXml(xml, {
    open(name, attrs) {
      const element: XmlElement = { name, attrs, children: [] };
      stack[stack.length - 1].children.push(element);
      stack.push(element);
    },
    close(name) {
      if (stack.length <= 1 || stack[stack.length - 1].name !== name) {
        throw malformed(`the end tag </${brief(name)}> does not match`);
      }
      stack.pop();
    },
    text(value) {
      stack[stack.length - 1].children.push(value);
    },
  });
  if (stack.length !== 1)
    throw malformed(`<${brief(stack[stack.length - 1].name)}> is never closed`);
  const element = root.children.find(
    (child): child is XmlElement => typeof child !== "string",
  );
  if (!element) throw malformed("a part holds no XML");
  return element;
}

/** The element's child elements, optionally only those with this name. */
export function childElements(
  element: XmlElement,
  name?: string,
): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement =>
      typeof child !== "string" && (name === undefined || child.name === name),
  );
}

/** The first child element with this name, if there is one. */
export function firstChild(
  element: XmlElement,
  name: string,
): XmlElement | undefined {
  return childElements(element, name)[0];
}

/**
 * A part's bytes as text. Workbook parts are UTF-8, or UTF-16 when they start
 * with a byte order mark.
 */
export function decodeXmlBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes);
}
