/**
 * M12 §4.10: when the delivered `labels.json` differs from the schema, fix it here, never by
 * relaxing the schema or the metric code. An adapter takes the parsed JSON and returns JSON.
 */
export type LabelsAdapter = (raw: unknown) => unknown;

/** golden-v1 as committed matches the M12 schema, so v1 changes nothing. */
export const v1Adapter: LabelsAdapter = (raw) => raw;
