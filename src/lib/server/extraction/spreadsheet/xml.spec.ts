import { describe, expect, it } from "vitest";
import {
  childElements,
  decodeEntities,
  decodeXmlBytes,
  firstChild,
  parseXml,
  scanXml,
} from "./xml.js";

/** The small XML reader for workbook parts (006 S4.1). */

describe("parseXml", () => {
  it("drops namespace prefixes and namespace declarations", () => {
    const root = parseXml(
      `<?xml version="1.0"?><x:workbook xmlns:x="urn:a" xmlns:r="urn:r"><x:sheet name="One" r:id="rId1"/></x:workbook>`,
    );
    expect(root.name).toBe("workbook");
    expect(root.attrs).toEqual({});
    expect(firstChild(root, "sheet")?.attrs).toEqual({
      name: "One",
      id: "rId1",
    });
  });

  it("decodes entities and character references in text and attributes", () => {
    const root = parseXml(
      `<a title="&quot;x&quot; &amp; y"><t>1 &lt; 2 &#x41;&#66; &apos;ok&apos;</t></a>`,
    );
    expect(root.attrs.title).toBe('"x" & y');
    expect(firstChild(root, "t")?.children).toEqual(["1 < 2 AB 'ok'"]);
  });

  it("passes CDATA through and skips comments and instructions", () => {
    const root = parseXml(
      `<a><!-- note --><?pi x?><![CDATA[<raw> & text]]></a>`,
    );
    expect(root.children).toEqual(["<raw> & text"]);
  });

  it("reads single-quoted attributes, spaces around = and empty tags", () => {
    const root = parseXml(`<a><b k = 'v' /><b/><c></c></a>`);
    expect(childElements(root, "b").map((b) => b.attrs)).toEqual([
      { k: "v" },
      {},
    ]);
    expect(childElements(root).map((e) => e.name)).toEqual(["b", "b", "c"]);
  });

  it("refuses a document type, so no entity can be defined or pulled in", () => {
    expect(() =>
      parseXml(
        `<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>`,
      ),
    ).toThrow(/document type/);
  });

  it("refuses an entity it does not know", () => {
    expect(() => decodeEntities("&nbsp;")).toThrow(/unknown entity/);
  });

  it("does not take a name every object has for an entity or a repeated attribute", () => {
    for (const name of ["constructor", "toString", "hasOwnProperty"]) {
      expect(() => decodeEntities(`a&${name};b`)).toThrow(/unknown entity/);
    }
    const root = parseXml(`<a constructor="x" __proto__="y" toString="z"/>`);
    expect(root.attrs.constructor).toBe("x");
    expect(root.attrs.__proto__).toBe("y");
    expect(root.attrs.toString).toBe("z");
  });

  it("cuts a long name short in its error", () => {
    const name = "a".repeat(10_000);
    expect(() => parseXml(`<${name}`)).toThrow(/^.{0,200}$/);
  });

  it("refuses mismatched and unclosed tags", () => {
    expect(() => parseXml(`<a><b></a>`)).toThrow(/does not match/);
    expect(() => parseXml(`<a><b>`)).toThrow(/never closed/);
    expect(() => parseXml(`<a b="1`)).toThrow(/never closed/);
  });
});

describe("scanXml", () => {
  it("calls back in document order, with a close after an empty tag", () => {
    const events: string[] = [];
    scanXml(`<r><c a="1"/>t</r>`, {
      open: (name, attrs, selfClosing) =>
        events.push(`open ${name} ${JSON.stringify(attrs)} ${selfClosing}`),
      close: (name) => events.push(`close ${name}`),
      text: (text) => events.push(`text ${text}`),
    });
    expect(events).toEqual([
      "open r {} false",
      'open c {"a":"1"} true',
      "close c",
      "text t",
      "close r",
    ]);
  });
});

describe("decodeXmlBytes", () => {
  it("reads UTF-8 and UTF-16 with a byte order mark", () => {
    expect(decodeXmlBytes(Buffer.from("<a>é</a>", "utf8"))).toBe("<a>é</a>");
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("<a>é</a>", "utf16le"),
    ]);
    expect(decodeXmlBytes(utf16)).toBe("<a>é</a>");
  });
});
