import * as z from 'zod'
import { isSideSession } from './side-session.ts'

export const permissionSchema = z.enum(['read', 'follow'])
const scope = { parent: z.string().min(1) }
const target = { ...scope, id: z.string().refine(isSideSession) }
export const commandSchema = z.discriminatedUnion('action', [
  z.object({ ...scope, action: z.literal('draft') }),
  z.object({
    ...scope,
    action: z.literal('create'),
    key: z.uuid(),
    tabKey: z.string().min(1).max(2048).optional(),
    text: z.string().refine((text) => !!text.trim()),
    permission: permissionSchema,
    createdAt: z.number(),
  }),
  z.object({ ...target, action: z.literal('open') }),
  z.object({ ...target, action: z.literal('permission'), permission: permissionSchema }),
  z.object({ ...target, action: z.literal('delete'), confirmed: z.literal(true) }),
])

export type SideCommand = z.infer<typeof commandSchema>
export type Permission = z.infer<typeof permissionSchema>
