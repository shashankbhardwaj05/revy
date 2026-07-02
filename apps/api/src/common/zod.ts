import { BadRequestException } from "@nestjs/common";
import type { ZodType } from "zod";

export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new BadRequestException(issues);
  }
  return result.data;
}
