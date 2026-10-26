// The undo job (M01 §6, brief 0215): soft-deletes the documents of one spreadsheet import that were not
// touched since. Runs in the worker because `undoImport` needs the tenant transaction.
import { type TenantTx, undoImport } from '@shoebox/db';
import type { Clock } from '@shoebox/domain';
import type { ImportSpreadsheetUndoPayload } from '@shoebox/pipeline';
import type { Logger } from '@shoebox/platform';
import type { TenantHandler } from '../registry';

export interface ImportUndoDeps {
  readonly undo?: (
    tx: TenantTx,
    input: { orgId: string; importId: string; now: Date },
  ) => Promise<{ removed: number; kept: number } | null>;
  readonly clock: Clock;
  readonly logger?: Pick<Logger, 'info' | 'warn'>;
}

export function createImportUndoHandler(
  deps: ImportUndoDeps,
): TenantHandler<ImportSpreadsheetUndoPayload> {
  const undo = deps.undo ?? undoImport;
  return async (payload, ctx) => {
    const result = await undo(ctx.tx, {
      orgId: payload.orgId,
      importId: payload.importId,
      now: new Date(deps.clock.now()),
    });
    if (result === null) {
      deps.logger?.warn({ importId: payload.importId }, 'import.spreadsheet.undo skipped');
      return;
    }
    deps.logger?.info(
      { importId: payload.importId, removed: result.removed, kept: result.kept },
      'import.spreadsheet.undo done',
    );
  };
}
