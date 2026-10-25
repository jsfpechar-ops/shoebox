import { t } from '@shoebox/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
} from '../src/index';
import { cleanup, render } from './render';

afterEach(cleanup);

// Any catalog strings: tests never use literal JSX text (lint rule no-jsx-literal-text).
const word = t('doc.confirm');
const other = t('manual.add');

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false, undefined, 'b', null)).toBe('a b');
  });
});

describe('Button', () => {
  it('is a type=button with token classes, 44 px and a focus ring', () => {
    const { container } = render(<Button>{word}</Button>);
    const button = container.querySelector('button');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.textContent).toBe(word);
    const cls = button?.className ?? '';
    expect(cls).toContain('bg-primary');
    expect(cls).toContain('min-h-11');
    expect(cls).toContain('focus-visible:ring-ring');
    expect(cls).toContain('motion-reduce:transition-none');
  });

  it('has a destructive variant and an icon size', () => {
    const { container } = render(
      <Button variant="destructive" size="icon" aria-label={word} type="submit" />,
    );
    const button = container.querySelector('button');
    expect(button?.className).toContain('bg-destructive');
    expect(button?.className).toContain('size-11');
    expect(button?.getAttribute('type')).toBe('submit');
  });
});

describe('Input and Label', () => {
  it('label points at the input', () => {
    const { container } = render(
      <>
        <Label htmlFor="f1">{word}</Label>
        <Input id="f1" />
      </>,
    );
    expect(container.querySelector('label')?.getAttribute('for')).toBe('f1');
    const input = container.querySelector('input');
    expect(input?.getAttribute('type')).toBe('text');
    expect(input?.className).toContain('border-input');
  });
});

describe('Radix controls', () => {
  it('Select renders a combobox trigger', () => {
    const { container } = render(
      <Select>
        <SelectTrigger aria-label={word}>
          <SelectValue placeholder={word} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">{word}</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = container.querySelector('[role="combobox"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('RadioGroup renders radios with the default checked', () => {
    const { container } = render(
      <RadioGroup defaultValue="a" aria-label={word}>
        <RadioGroupItem value="a" aria-label={word} />
        <RadioGroupItem value="b" aria-label={other} />
      </RadioGroup>,
    );
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(2);
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
    expect(radios[1]?.getAttribute('aria-checked')).toBe('false');
  });

  it('Checkbox and Switch expose their state', () => {
    const { container } = render(
      <>
        <Checkbox aria-label={word} defaultChecked />
        <Switch aria-label={other} />
      </>,
    );
    expect(container.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  });

  it('Tabs render a tablist with the active tab and its panel', () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList aria-label={word}>
          <TabsTrigger value="a">{word}</TabsTrigger>
          <TabsTrigger value="b">{other}</TabsTrigger>
        </TabsList>
        <TabsContent value="a">{word}</TabsContent>
        <TabsContent value="b">{other}</TabsContent>
      </Tabs>,
    );
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toBe(word);
  });
});

describe('static primitives', () => {
  it('Card, Badge, Alert and Table use tokens and real semantics', () => {
    const { container } = render(
      <>
        <Card>
          <CardHeader>
            <CardTitle>{word}</CardTitle>
          </CardHeader>
          <CardContent>{other}</CardContent>
        </Card>
        <Badge tone="success">{word}</Badge>
        <Alert tone="destructive">
          <AlertTitle>{word}</AlertTitle>
          <AlertDescription>{other}</AlertDescription>
        </Alert>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{word}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>{other}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </>,
    );
    expect(container.querySelector('[data-slot="card"]')?.className).toContain('rounded-card');
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.getAttribute('data-tone')).toBe('success');
    expect(badge?.className).toContain('text-success');
    expect(container.querySelector('[role="alert"]')?.className).toContain('text-destructive');
    expect(container.querySelector('table th')?.textContent).toBe(word);
    expect(container.querySelector('table td')?.textContent).toBe(other);
  });

  it('Badge defaults to the neutral tone', () => {
    const { container } = render(<Badge>{word}</Badge>);
    expect(container.querySelector('[data-slot="badge"]')?.getAttribute('data-tone')).toBe(
      'neutral',
    );
  });
});

describe('overlays', () => {
  it('an open Dialog renders a titled dialog with a labelled close button', () => {
    render(
      <Dialog open>
        <DialogContent closeLabel={other}>
          <DialogTitle>{word}</DialogTitle>
          <DialogDescription>{other}</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(word);
    expect(dialog?.querySelector(`button[aria-label="${other}"]`)).not.toBeNull();
  });

  it('an open Sheet renders on the chosen side', () => {
    render(
      <Sheet open>
        <SheetContent side="bottom" closeLabel={other}>
          <SheetTitle>{word}</SheetTitle>
          <SheetDescription>{other}</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const sheet = document.body.querySelector('[data-slot="sheet-content"]');
    expect(sheet?.getAttribute('role')).toBe('dialog');
    expect(sheet?.getAttribute('data-side')).toBe('bottom');
    expect(sheet?.className).toContain('bottom-0');
  });

  it('Toaster renders a labelled live region', () => {
    render(<Toaster label={word} />);
    const region = document.body.querySelector('section[aria-live]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-label')?.startsWith(word)).toBe(true);
  });
});
