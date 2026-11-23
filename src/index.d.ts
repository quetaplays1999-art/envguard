export interface EnvEntry {
  key: string;
  value: string;
  line: number;
  exported: boolean;
}

export interface ParseResult {
  values: Record<string, string>;
  entries: EnvEntry[];
  warnings: Array<{ line: number; message: string }>;
}

export type VariableType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'url'
  | 'email'
  | 'port'
  | 'json'
  | 'enum';

export interface VariableRule {
  type?: VariableType;
  required?: boolean;
  default?: string;
  description?: string;
  enum?: string[];
  pattern?: string;
  min?: number;
  max?: number;
  minLength?: number;
  secret?: boolean;
  example?: string;
}

export interface EnvSchema {
  title?: string;
  strict?: boolean;
  variables: Record<string, VariableRule>;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  key: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface SecretFinding {
  ruleId: string;
  ruleName: string;
  severity: 'high' | 'medium';
  file: string;
  line: number;
  matchMasked: string;
}

export function parseEnv(content: string): ParseResult;
export function maskValue(value: string): string;
export function validateEnv(
  envValues: Record<string, string>,
  options?: { schema?: EnvSchema; example?: Record<string, string>; strict?: boolean }
): ValidationResult;
export function shannonEntropy(str: string): number;
export function scanTextForSecrets(content: string, fileLabel?: string): SecretFinding[];
export function scanPathForSecrets(
  targetPath: string,
  options?: { ignoreDirs?: string[]; maxFileSizeBytes?: number }
): { scannedFiles: number; findings: SecretFinding[] };
export function diffEnv(
  left: Record<string, string>,
  right: Record<string, string>,
  options?: { revealValues?: boolean }
): {
  onlyInLeft: string[];
  onlyInRight: string[];
  changed: Array<{ key: string; left: string; right: string }>;
  unchanged: string[];
};
export function generateExample(envValues: Record<string, string>, schema?: EnvSchema): string;
export function generateMarkdownDocs(schema: EnvSchema): string;
