/**
 * A small strict XML reader for ISDOC (M02 §4.2, M12 V5.5). Names are local (prefix dropped),
 * values stay strings. A DOCTYPE or ENTITY declaration is refused, so no external entity is ever
 * resolved. Throws `XmlError` on anything that is not well-formed.
 */

export interface XmlElement {
  /** Local name, prefix dropped (`isdoc:Invoice` → `Invoice`). */
  readonly name: string;
  /** Namespace URI of the element, from the nearest matching `xmlns` / `xmlns:p`; '' if none. */
  readonly ns: string;
  /** Attributes by local name. */
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  /** Concatenated character data of this element (not of its children), entities decoded. */
  readonly text: string;
}

export class XmlError extends Error {
  constructor(detail: string) {
    super(`xml: ${detail}`);
    this.name = 'XmlError';
  }
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function decodeEntities(raw: string): string {
  return raw.replace(/&([^;\s&]*);?/g, (match, body: string) => {
    if (!match.endsWith(';')) throw new XmlError('bare ampersand');
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      if (!Number.isFinite(code)) throw new XmlError('bad character reference');
      return String.fromCodePoint(code);
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code)) throw new XmlError('bad character reference');
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body];
    if (named === undefined) throw new XmlError('unknown entity');
    return named;
  });
}

function localName(qname: string): string {
  const colon = qname.indexOf(':');
  return colon < 0 ? qname : qname.slice(colon + 1);
}

function prefixOf(qname: string): string {
  const colon = qname.indexOf(':');
  return colon < 0 ? '' : qname.slice(0, colon);
}

interface Building {
  qname: string;
  name: string;
  ns: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
  scope: ReadonlyMap<string, string>;
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** Parses a whole XML document and returns its root element. */
export function parseXml(input: string): XmlElement {
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const stack: Building[] = [];
  let root: XmlElement | null = null;
  let i = 0;

  const close = (b: Building): void => {
    const done: XmlElement = {
      name: b.name,
      ns: b.ns,
      attrs: b.attrs,
      children: b.children,
      text: b.text,
    };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(done);
    else if (root === null) root = done;
    else throw new XmlError('more than one root element');
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? src.length : lt;
    if (textEnd > i) {
      const chunk = src.slice(i, textEnd);
      const top = stack[stack.length - 1];
      if (top) top.text += decodeEntities(chunk);
      else if (chunk.trim() !== '') throw new XmlError('text outside the root element');
    }
    if (lt < 0) break;

    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      if (end < 0) throw new XmlError('unclosed processing instruction');
      i = end + 2;
    } else if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) throw new XmlError('unclosed comment');
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      if (end < 0) throw new XmlError('unclosed CDATA');
      const top = stack[stack.length - 1];
      if (!top) throw new XmlError('CDATA outside the root element');
      top.text += src.slice(lt + 9, end);
      i = end + 3;
    } else if (src.startsWith('<!', lt)) {
      // DOCTYPE, ENTITY and friends: never needed by ISDOC, and the door to XXE.
      throw new XmlError('declarations are not allowed');
    } else if (src.startsWith('</', lt)) {
      const end = src.indexOf('>', lt + 2);
      if (end < 0) throw new XmlError('unclosed end tag');
      const qname = src.slice(lt + 2, end).trim();
      const top = stack.pop();
      if (!top || top.qname !== qname) throw new XmlError('mismatched end tag');
      close(top);
      i = end + 1;
    } else {
      const end = findTagEnd(src, lt + 1);
      const selfClosing = src[end - 1] === '/';
      const inner = src.slice(lt + 1, selfClosing ? end - 1 : end);
      const nameMatch = /^[^\s/>]+/.exec(inner);
      if (!nameMatch) throw new XmlError('missing element name');
      const qname = nameMatch[0];
      const parentScope = stack[stack.length - 1]?.scope ?? new Map<string, string>();
      const scope = new Map(parentScope);
      const rawAttrs: [string, string][] = [];
      const rest = inner.slice(qname.length);
      ATTR_RE.lastIndex = 0;
      for (let m = ATTR_RE.exec(rest); m !== null; m = ATTR_RE.exec(rest)) {
        const key = m[1] as string;
        const value = decodeEntities(m[3] ?? m[4] ?? '');
        if (key === 'xmlns') scope.set('', value);
        else if (key.startsWith('xmlns:')) scope.set(key.slice(6), value);
        else rawAttrs.push([key, value]);
      }
      if (rest.replace(ATTR_RE, '').trim() !== '') throw new XmlError('malformed attributes');
      const attrs: Record<string, string> = {};
      for (const [key, value] of rawAttrs) attrs[localName(key)] = value;
      const building: Building = {
        qname,
        name: localName(qname),
        ns: scope.get(prefixOf(qname)) ?? '',
        attrs,
        children: [],
        text: '',
        scope,
      };
      if (stack.length === 0 && root !== null) throw new XmlError('more than one root element');
      if (selfClosing) close(building);
      else stack.push(building);
      i = end + 1;
    }
  }

  if (stack.length > 0) throw new XmlError('unclosed element');
  if (root === null) throw new XmlError('no root element');
  return root;
}

/** Index of the `>` that ends the start tag beginning at `from`, skipping quoted attribute values. */
function findTagEnd(src: string, from: number): number {
  let quote: string | null = null;
  for (let j = from; j < src.length; j++) {
    const c = src[j];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return j;
    } else if (c === '<') {
      throw new XmlError('unexpected < in a tag');
    }
  }
  throw new XmlError('unclosed start tag');
}

/** The first child with this local name, or null. */
export function child(el: XmlElement | null, name: string): XmlElement | null {
  if (el === null) return null;
  return el.children.find((c) => c.name === name) ?? null;
}

/** All children with this local name. */
export function childrenNamed(el: XmlElement | null, name: string): readonly XmlElement[] {
  if (el === null) return [];
  return el.children.filter((c) => c.name === name);
}

/** Follows a path of local names; null when any step is missing. */
export function at(el: XmlElement | null, ...path: readonly string[]): XmlElement | null {
  let cur = el;
  for (const name of path) cur = child(cur, name);
  return cur;
}

/** Trimmed text at a path; '' when the element is missing or empty. */
export function textAt(el: XmlElement | null, ...path: readonly string[]): string {
  return at(el, ...path)?.text.trim() ?? '';
}
