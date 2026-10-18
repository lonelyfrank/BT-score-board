import { z } from 'zod';
export const environment = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1).default('./data/darts.sqlite'),
  ORGANIZER_TOKEN: z
    .string()
    .min(32)
    .max(512)
    .refine(
      (s) => !s.startsWith('replace-with-'),
      'Replace the example token with a random secret',
    ),
  PUBLIC_READS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((s) => s === 'true'),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10000).default(300),
});
export type Config = z.output<typeof environment>;
export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = environment.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid configuration fields: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  return result.data;
}
