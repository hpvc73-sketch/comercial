import type { Resolver } from 'react-hook-form';
import type { z, ZodTypeAny } from 'zod';

type FieldError = {
  type: string;
  message: string;
};

function setNestedError(target: Record<string, any>, path: (string | number)[], value: FieldError) {
  let current: Record<string, any> = target;
  path.forEach((segment, index) => {
    const key = String(segment);
    if (index === path.length - 1) {
      current[key] = value;
      return;
    }
    if (!current[key]) {
      current[key] = {};
    }
    current = current[key];
  });
}

export function createZodResolver<TSchema extends ZodTypeAny>(schema: TSchema): Resolver<z.infer<TSchema>> {
  return async (values) => {
    const result = schema.safeParse(values);
    if (result.success) {
      return {
        values: result.data,
        errors: {}
      };
    }

    const errors: Record<string, any> = {};
    result.error.issues.forEach((issue) => {
      setNestedError(errors, issue.path, {
        type: issue.code || 'validation',
        message: issue.message
      });
    });

    return {
      values: {},
      errors
    };
  };
}
