import { parseLegalDate } from '@shoebox/domain';
import { t } from '@shoebox/i18n';
import axe from 'axe-core';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
  LegalDateText,
  MoneyText,
  RadioGroup,
  RadioGroupItem,
  SecondaryStatusBadge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  StatusBadge,
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

// Catalog strings only: tests never use literal JSX text (lint rule no-jsx-literal-text).
const word = t('doc.confirm');
const other = t('manual.add');

function Showcase() {
  return (
    <main>
      <Button>{word}</Button>
      <Label htmlFor="a11y-input">{word}</Label>
      <Input id="a11y-input" />
      <Select>
        <SelectTrigger aria-label={word}>
          <SelectValue placeholder={word} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">{word}</SelectItem>
        </SelectContent>
      </Select>
      <RadioGroup defaultValue="a" aria-label={word}>
        <RadioGroupItem value="a" aria-label={word} />
        <RadioGroupItem value="b" aria-label={other} />
      </RadioGroup>
      <Checkbox aria-label={word} />
      <Switch aria-label={other} />
      <Tabs defaultValue="a">
        <TabsList aria-label={word}>
          <TabsTrigger value="a">{word}</TabsTrigger>
          <TabsTrigger value="b">{other}</TabsTrigger>
        </TabsList>
        <TabsContent value="a">{word}</TabsContent>
        <TabsContent value="b">{other}</TabsContent>
      </Tabs>
      <Card>
        <CardHeader>
          <CardTitle>{word}</CardTitle>
        </CardHeader>
        <CardContent>{other}</CardContent>
      </Card>
      <Badge tone="info">{word}</Badge>
      <Alert tone="warning">
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
            <TableCell>
              <MoneyText value="1234.56" currency="CZK" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <StatusBadge status="received" cls="unknown" />
      <StatusBadge status="ready" cls="received_invoice" />
      <StatusBadge status="duplicate" cls="received_invoice" originalHref="/doklady/1" />
      <StatusBadge status="failed" cls="unknown" purgeOn={parseLegalDate('2026-11-17')} />
      <SecondaryStatusBadge kind="not_tax_document" />
      <SecondaryStatusBadge kind="missing_document" />
      <LegalDateText date={parseLegalDate('2026-10-18')} />
      <Toaster label={word} />
    </main>
  );
}

async function violations(): Promise<string[]> {
  // Radix focus guards (data-radix-focus-guard) sit outside an open modal and are aria-hidden by
  // design; they only bounce Tab back into the dialog. Excluded by orchestrator decision (0015c-fix-1).
  const result = await axe.run(
    { include: [document], exclude: [['[data-radix-focus-guard]']] },
    {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      // happy-dom has no stylesheet or layout; contrast is checked by Playwright + axe (P0-UI-03).
      rules: { 'color-contrast': { enabled: false } },
      resultTypes: ['violations'],
    },
  );
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

for (const theme of ['light', 'dark'] as const) {
  describe(`axe, ${theme} theme`, () => {
    function setPage(): void {
      document.documentElement.lang = 'cs';
      document.documentElement.dataset.theme = theme;
      document.title = word;
    }

    it('primitives and status components have 0 violations', async () => {
      setPage();
      render(<Showcase />);
      expect(await violations()).toEqual([]);
    });

    it('an open Dialog has 0 violations', async () => {
      setPage();
      render(
        <Dialog open>
          <DialogContent closeLabel={other}>
            <DialogTitle>{word}</DialogTitle>
            <DialogDescription>{other}</DialogDescription>
          </DialogContent>
        </Dialog>,
      );
      expect(await violations()).toEqual([]);
    });

    it('an open bottom Sheet has 0 violations', async () => {
      setPage();
      render(
        <Sheet open>
          <SheetContent side="bottom" closeLabel={other}>
            <SheetTitle>{word}</SheetTitle>
            <SheetDescription>{other}</SheetDescription>
          </SheetContent>
        </Sheet>,
      );
      expect(await violations()).toEqual([]);
    });
  });
}
