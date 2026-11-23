/**
 * Schema and template validation engine for .env files.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOOL_TRUE = new Set(['true', '1', 'yes', 'on']);
const BOOL_FALSE = new Set(['false', '0', 'no', 'off']);

/**
 * @typedef {Object} VariableRule
 * @property {'string'|'number'|'integer'|'boolean'|'url'|'email'|'port'|'json'|'enum'} [type]
 * @property {boolean} [required]
 * @property {string} [default]
 * @property {string} [description]
 * @property {string[]} [enum]
 * @property {string} [pattern]
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [minLength]
 * @property {boolean} [secret]
 * @property {string} [example]
 */

/**
 * @typedef {Object} ValidationIssue
 * @property {'error'|'warning'} severity
 * @property {string} key
 * @property {string} code
 * @property {string} message
 */

/**
 * Validate a single variable value against its schema rule.
 * @param {string} key
 * @param {string | undefined} value
 * @param {VariableRule} rule
 * @returns {ValidationIssue[]}
 */
function validateVariable(key, value, rule) {
  /** @type {ValidationIssue[]} */
  const issues = [];
  const isMissing = value === undefined || value === '';

  if (isMissing) {
    if (rule.required && rule.default === undefined) {
      issues.push({
        severity: 'error',
        key,
        code: 'MISSING_REQUIRED',
        message: `Required variable '${key}' is missing or empty.`
      });
    }
    return issues;
  }

  const type = rule.type || 'string';

  if (type === 'number' || type === 'integer' || type === 'port') {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      issues.push({
        severity: 'error',
        key,
        code: 'INVALID_TYPE',
        message: `'${key}' must be a valid ${type}.`
      });
      return issues;
    }
    if ((type === 'integer' || type === 'port') && !Number.isInteger(num)) {
      issues.push({
        severity: 'error',
        key,
        code: 'INVALID_TYPE',
        message: `'${key}' must be an integer.`
      });
    }
    if (type === 'port' && (num < 1 || num > 65535)) {
      issues.push({
        severity: 'error',
        key,
        code: 'OUT_OF_RANGE',
        message: `'${key}' must be a valid TCP/UDP port (1-65535).`
      });
    }
    if (typeof rule.min === 'number' && num < rule.min) {
      issues.push({
        severity: 'error',
        key,
        code: 'OUT_OF_RANGE',
        message: `'${key}' must be >= ${rule.min}.`
      });
    }
    if (typeof rule.max === 'number' && num > rule.max) {
      issues.push({
        severity: 'error',
        key,
        code: 'OUT_OF_RANGE',
        message: `'${key}' must be <= ${rule.max}.`
      });
    }
  } else if (type === 'boolean') {
    const lower = value.toLowerCase();
    if (!BOOL_TRUE.has(lower) && !BOOL_FALSE.has(lower)) {
      issues.push({
        severity: 'error',
        key,
        code: 'INVALID_TYPE',
        message: `'${key}' must be a boolean (true/false/1/0/yes/no/on/off).`
      });
    }
  } else if (type === 'url') {
    try {
      const parsed = new URL(value);
      if (!parsed.protocol || !parsed.host) {
        throw new Error('Invalid URL');
      }
    } catch {
      issues.push({
        severity: 'error',
        key,
        code: 'INVALID_URL',
        message: `'${key}' must be a valid absolute URL (including protocol).`
      });
    }
  } else if (type === 'email') {
    if (!EMAIL_REGEX.test(value)) {
      issues.push({
        severity: 'error',
        key,
        code: 'INVALID_EMAIL',
        message: `'${key}' must be a valid email address.`
      });
    }
  } else if (type === 'json') {
    try {
      JSON.parse(value);
    } catch {
      issues.push({
        severity: 'error',
        key,
        code: 'INVALID_JSON',
        message: `'${key}' must contain valid JSON.`
      });
    }
  } else if (type === 'enum') {
    if (!Array.isArray(rule.enum) || !rule.enum.includes(value)) {
      issues.push({
        severity: 'error',
        key,
        code: 'INVALID_ENUM',
        message: `'${key}' must be one of: ${(rule.enum || []).join(', ')}.`
      });
    }
  }

  if (Array.isArray(rule.enum) && type !== 'enum' && !rule.enum.includes(value)) {
    issues.push({
      severity: 'error',
      key,
      code: 'INVALID_ENUM',
      message: `'${key}' must be one of: ${rule.enum.join(', ')}.`
    });
  }

  if (typeof rule.minLength === 'number' && value.length < rule.minLength) {
    issues.push({
      severity: 'error',
      key,
      code: 'MIN_LENGTH',
      message: `'${key}' must be at least ${rule.minLength} characters long.`
    });
  }

  if (typeof rule.pattern === 'string') {
    const re = new RegExp(rule.pattern);
    if (!re.test(value)) {
      issues.push({
        severity: 'error',
        key,
        code: 'PATTERN_MISMATCH',
        message: `'${key}' does not match required pattern /${rule.pattern}/.`
      });
    }
  }

  return issues;
}

/**
 * Validate a parsed env object against a JSON schema or an example env map.
 * @param {Record<string, string>} envValues
 * @param {{ schema?: { variables?: Record<string, VariableRule>, strict?: boolean }, example?: Record<string, string>, strict?: boolean }} options
 * @returns {{ ok: boolean, errors: ValidationIssue[], warnings: ValidationIssue[] }}
 */
export function validateEnv(envValues, options = {}) {
  /** @type {ValidationIssue[]} */
  const errors = [];
  /** @type {ValidationIssue[]} */
  const warnings = [];

  const schemaVars = options.schema?.variables || {};
  const exampleVars = options.example || {};
  const strict = Boolean(options.strict || options.schema?.strict);

  const knownKeys = new Set([...Object.keys(schemaVars), ...Object.keys(exampleVars)]);

  // Check schema rules
  for (const [key, rule] of Object.entries(schemaVars)) {
    const issues = validateVariable(key, envValues[key], rule);
    for (const issue of issues) {
      if (issue.severity === 'error') errors.push(issue);
      else warnings.push(issue);
    }
  }

  // Check example template keys not covered by schema
  for (const key of Object.keys(exampleVars)) {
    if (schemaVars[key]) continue;
    if (!(key in envValues)) {
      errors.push({
        severity: 'error',
        key,
        code: 'MISSING_FROM_EXAMPLE',
        message: `Variable '${key}' is present in template but missing in target .env.`
      });
    }
  }

  // Detect undocumented extra keys
  for (const key of Object.keys(envValues)) {
    if (knownKeys.size > 0 && !knownKeys.has(key)) {
      const issue = {
        severity: strict ? /** @type {'error'} */ ('error') : /** @type {'warning'} */ ('warning'),
        key,
        code: 'UNDOCUMENTED_KEY',
        message: `Variable '${key}' is not declared in schema or .env.example.`
      };
      if (strict) errors.push(issue);
      else warnings.push(issue);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}
