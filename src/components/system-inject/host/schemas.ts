import * as z from 'zod'

export const nameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => value !== '.' && value !== '..', 'name 不能为 . 或 ..')

const selectionSchema = z.object({ name: nameSchema.nullable() }).strict()

const snapshotSchema = z
  .object({
    display_name: z.string().min(1).max(120),
    description: z.string().max(500),
    body: z
      .string()
      .min(1)
      .max(200_000)
      .refine((value) => !!value.trim(), '正文不能为空'),
  })
  .strict()

const injectStateSchema = selectionSchema.extend({ snapshot: snapshotSchema.optional() })

export const promptSchema = snapshotSchema
  .extend({
    name: nameSchema,
    display_name: z.string().max(120).default(''),
    description: z.string().max(500).default(''),
  })
  .transform((value) => ({ ...value, display_name: value.display_name || value.name }))

const sourceSchema = z.enum(['session', 'parent', 'none'])

export const frozenSchema = z
  .object({
    version: z.literal(1),
    state: injectStateSchema.refine(
      (state) => (state.name === null ? state.snapshot === undefined : !!state.snapshot),
      '冻结状态缺少正文或明确选择',
    ),
    frozen_at: z.string().datetime(),
    source: sourceSchema,
    inherited_from: z.string().optional(),
  })
  .strict()

const id = z.string().min(1).max(4096)
const revision = z.string().min(1)

export const routeSchema = z.object({ provider: id, model: id }).strict()

export const rpcSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('select'), sessionId: id, state: selectionSchema }).strict(),
  z
    .object({
      type: z.literal('acknowledge-error'),
      sessionId: id,
      noticeId: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('save-template'),
      revision,
      scope: z.enum(['user', 'workspace']),
      file: id.optional(),
      template: promptSchema,
      confirmed: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('delete-template'),
      revision,
      file: id,
      confirmed: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal('whitelist'), revision, routes: z.array(routeSchema) }).strict(),
  z.object({ type: z.literal('parse-markdown'), markdown: z.string().max(220_000) }).strict(),
  z.object({ type: z.literal('format-markdown'), template: promptSchema }).strict(),
])
