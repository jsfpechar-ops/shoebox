// Minimal ICU MessageFormat subset: text, {arg}, {arg, plural, ...} with # and =N, {arg, select, ...}.
// TODO(decision-i18n-lib): replace with an approved ICU library (e.g. intl-messageformat) if the owner approves one.
// Not supported: apostrophe quoting, {arg, number|date|time}, offset:. Use them and parse() throws.

export type Params = Readonly<Record<string, string | number>>;

export type IcuNode =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'arg'; readonly name: string }
  | { readonly kind: 'pound' }
  | {
      readonly kind: 'plural' | 'select';
      readonly name: string;
      readonly options: ReadonlyMap<string, IcuNode[]>;
    };

export class IcuSyntaxError extends Error {
  override readonly name = 'IcuSyntaxError';
}

const ARG_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLURAL_SELECTOR = /^(zero|one|two|few|many|other|=\d+)$/;
const SELECT_SELECTOR = /^[A-Za-z0-9_]+$/;

class Parser {
  readonly src: string;
  pos = 0;

  constructor(src: string) {
    this.src = src;
  }

  fail(reason: string): IcuSyntaxError {
    return new IcuSyntaxError(`${reason} at ${this.pos} in "${this.src}"`);
  }

  nodes(inPlural: boolean): IcuNode[] {
    const out: IcuNode[] = [];
    let text = '';
    while (this.pos < this.src.length) {
      const ch = this.src.charAt(this.pos);
      if (ch === '}') break;
      if (ch === '{' || (ch === '#' && inPlural)) {
        if (text !== '') out.push({ kind: 'text', value: text });
        text = '';
        if (ch === '{') {
          out.push(this.argument(inPlural));
        } else {
          out.push({ kind: 'pound' });
          this.pos++;
        }
      } else {
        text += ch;
        this.pos++;
      }
    }
    if (text !== '') out.push({ kind: 'text', value: text });
    return out;
  }

  // Reads up to (not including) the first of the stop characters; throws at end of input.
  readUntil(stops: string): string {
    const start = this.pos;
    while (this.pos < this.src.length && !stops.includes(this.src.charAt(this.pos))) this.pos++;
    if (this.pos >= this.src.length) throw this.fail('unclosed "{"');
    return this.src.slice(start, this.pos).trim();
  }

  expect(ch: string): void {
    if (this.pos >= this.src.length) throw this.fail('unclosed "{"');
    if (this.src.charAt(this.pos) !== ch) throw this.fail(`expected "${ch}"`);
    this.pos++;
  }

  argument(inPlural: boolean): IcuNode {
    this.expect('{');
    const name = this.readUntil(',}{');
    if (!ARG_NAME.test(name)) throw this.fail(`invalid argument name "${name}"`);
    if (this.src.charAt(this.pos) === '}') {
      this.pos++;
      return { kind: 'arg', name };
    }
    this.expect(',');
    const type = this.readUntil(',}{');
    if (type !== 'plural' && type !== 'select') {
      throw this.fail(`unsupported argument type "${type}"`);
    }
    this.expect(',');
    const selectorPattern = type === 'plural' ? PLURAL_SELECTOR : SELECT_SELECTOR;
    const options = new Map<string, IcuNode[]>();
    for (;;) {
      const selector = this.readUntil('{}');
      if (selector === '' && this.src.charAt(this.pos) === '}') break;
      if (!selectorPattern.test(selector)) throw this.fail(`invalid selector "${selector}"`);
      if (options.has(selector)) throw this.fail(`duplicate selector "${selector}"`);
      this.expect('{');
      options.set(selector, this.nodes(type === 'plural' || inPlural));
      this.expect('}');
    }
    this.pos++;
    if (!options.has('other')) throw this.fail('missing "other" option');
    return { kind: type, name, options };
  }
}

/** Parses an ICU message; throws IcuSyntaxError when it is invalid or uses an unsupported feature. */
export function parse(message: string): IcuNode[] {
  const parser = new Parser(message);
  const nodes = parser.nodes(false);
  if (parser.pos < message.length) throw parser.fail('unexpected "}"');
  return nodes;
}

function param(params: Params, name: string): string | number {
  const value = params[name];
  if (value === undefined) throw new Error(`i18n: missing parameter "${name}"`);
  return value;
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** Renders parsed nodes. Numbers are formatted for the locale (cs: 1,5). */
export function render(
  nodes: readonly IcuNode[],
  locale: string,
  params: Params,
  count?: number,
): string {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += node.value;
        break;
      case 'pound':
        out += count === undefined ? '#' : formatNumber(count, locale);
        break;
      case 'arg': {
        const value = param(params, node.name);
        out += typeof value === 'number' ? formatNumber(value, locale) : value;
        break;
      }
      case 'plural': {
        const value = param(params, node.name);
        if (typeof value !== 'number') {
          throw new TypeError(`i18n: plural argument "${node.name}" must be a number`);
        }
        const branch =
          node.options.get(`=${value}`) ??
          node.options.get(new Intl.PluralRules(locale).select(value)) ??
          node.options.get('other') ??
          [];
        out += render(branch, locale, params, value);
        break;
      }
      case 'select': {
        const value = String(param(params, node.name));
        const branch = node.options.get(value) ?? node.options.get('other') ?? [];
        out += render(branch, locale, params, count);
        break;
      }
    }
  }
  return out;
}

/** Parses and renders one message. */
export function formatMessage(message: string, locale: string, params: Params = {}): string {
  return render(parse(message), locale, params);
}
