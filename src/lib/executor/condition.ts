import type {
  ConditionOperator,
  ConditionResult,
  JsonObject,
  JsonValue,
} from "@/lib/types";

function getByDotPath(source: JsonValue, path: string): JsonValue | undefined {
  if (!path) return source;
  const parts = path.split(".").filter(Boolean);
  let current: JsonValue | undefined = source;

  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as JsonObject)[part];
  }

  return current;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

export function evaluateCondition(options: {
  data: JsonValue;
  field?: string;
  operator: ConditionOperator;
  value?: unknown;
  trueLabel?: string;
  falseLabel?: string;
}): ConditionResult {
  const {
    data,
    field,
    operator,
    value,
    trueLabel = "true_path",
    falseLabel = "false_path",
  } = options;

  const resolved = field ? getByDotPath(data, field) : data;
  let matched = false;

  switch (operator) {
    case "exists":
      matched = resolved !== undefined && resolved !== null;
      break;
    case "eq":
      matched = resolved === value || String(resolved) === String(value);
      break;
    case "neq":
      matched = !(resolved === value || String(resolved) === String(value));
      break;
    case "contains": {
      const haystack =
        typeof resolved === "string"
          ? resolved
          : resolved === undefined || resolved === null
            ? ""
            : JSON.stringify(resolved);
      matched = haystack.includes(String(value ?? ""));
      break;
    }
    case "not_contains": {
      const haystack =
        typeof resolved === "string"
          ? resolved
          : resolved === undefined || resolved === null
            ? ""
            : JSON.stringify(resolved);
      matched = !haystack.includes(String(value ?? ""));
      break;
    }
    case "gt": {
      const left = asNumber(resolved);
      const right = asNumber(value);
      matched = left !== null && right !== null && left > right;
      break;
    }
    case "lt": {
      const left = asNumber(resolved);
      const right = asNumber(value);
      matched = left !== null && right !== null && left < right;
      break;
    }
    default:
      matched = false;
  }

  return {
    matched,
    label: matched ? trueLabel : falseLabel,
    details: {
      field: field ?? null,
      operator,
      expected: (value as JsonValue) ?? null,
      actual: (resolved as JsonValue) ?? null,
      matched,
      path: matched ? trueLabel : falseLabel,
    },
  };
}
